const { HumanMessage } = require("@langchain/core/messages");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const { env } = require("../config/env");
const { claimExtractionSchema } = require("../utils/validator");

const EXTRACTION_PROMPT = `
You are processing a handwritten medical prescription for insurance pre-authorization.

Extract exactly these fields and return valid JSON only:
- patientId: string
- diagnosis: string
- symptomDuration: integer number of months
- requestedProcedure: string
- age: integer
- confidence: number between 0 and 1

Rules:
- Use best-effort extraction from the image only.
- If the handwriting is partially unclear, still provide the best structured guess and reduce confidence.
- symptomDuration must be in months as an integer.
- age must be an integer.
- Do not include markdown, comments, or any text outside the JSON object.
`.trim();

let extractor;

const FALLBACK_CONFIDENCE = 0.1;
const EXTRACTION_PROVIDER = "gemini";
const MAX_REASON_LENGTH = 220;
const FALLBACK_REASON_CODES = new Set([
  "missing_api_key",
  "quota_exceeded",
  "rate_limited",
  "timeout",
  "network_error",
  "model_unavailable",
  "provider_unavailable",
]);

function resolveGeminiTextModel(modelName) {
  return modelName;
}

function trimReason(reason) {
  if (!reason) {
    return null;
  }

  const normalized = String(reason).replace(/\s+/g, " ").trim();

  if (normalized.length <= MAX_REASON_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_REASON_LENGTH - 3)}...`;
}

function createExtractionMeta({
  mode,
  degraded,
  reasonCode = null,
  reason = null,
}) {
  return {
    mode,
    degraded,
    provider: EXTRACTION_PROVIDER,
    reasonCode,
    reason: trimReason(reason),
  };
}

function createMissingApiKeyError() {
  const error = new Error("GEMINI_API_KEY is not configured.");
  error.code = "MISSING_API_KEY";
  return error;
}

function classifyExtractionError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();

  if (
    code === "missing_api_key" ||
    message.includes("gemini_api_key is not configured")
  ) {
    return "missing_api_key";
  }

  if (
    message.includes("quota exceeded") ||
    message.includes("current quota") ||
    message.includes("free tier") ||
    message.includes("billing details")
  ) {
    return "quota_exceeded";
  }

  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("retry in")
  ) {
    return "rate_limited";
  }

  if (
    code.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("deadline exceeded") ||
    message.includes("etimedout") ||
    message.includes("timeout")
  ) {
    return "timeout";
  }

  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket hang up") ||
    code === "enotfound" ||
    code === "econnreset" ||
    code === "econnrefused"
  ) {
    return "network_error";
  }

  if (
    message.includes("model not found") ||
    message.includes("unknown model") ||
    message.includes("unsupported model")
  ) {
    return "model_unavailable";
  }

  if (
    message.includes("service unavailable") ||
    message.includes("temporarily unavailable") ||
    message.includes("unavailable") ||
    message.includes("internal server error") ||
    message.includes("503")
  ) {
    return "provider_unavailable";
  }

  if (name === "zoderror" || message.includes("invalid json")) {
    return "invalid_response";
  }

  return "unknown";
}

function getExtractor() {
  if (!extractor) {
    if (!env.geminiApiKey) {
      throw createMissingApiKeyError();
    }

    const model = new ChatGoogleGenerativeAI({
      apiKey: env.geminiApiKey,
      model: resolveGeminiTextModel(env.geminiTextModel),
      temperature: 0,
      maxRetries: 2,
    });

    extractor = model.withStructuredOutput(claimExtractionSchema, {
      name: "extract_medical_claim",
      method: "jsonSchema",
    });
  }

  return extractor;
}

function toInteger(value) {
  if (typeof value === "number") {
    return Math.trunc(value);
  }

  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : value;
}

function toConfidence(value) {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : value;
}

function normalizeStructuredExtraction(result) {
  return {
    ...result,
    patientId: String(result?.patientId ?? "").trim(),
    diagnosis: String(result?.diagnosis ?? "").trim(),
    symptomDuration: toInteger(result?.symptomDuration),
    requestedProcedure: String(result?.requestedProcedure ?? "").trim(),
    age: toInteger(result?.age),
    confidence: toConfidence(result?.confidence),
  };
}

function createUnavailableExtraction() {
  return {
    patientId: "Unknown patient",
    diagnosis: "Unknown diagnosis",
    symptomDuration: 0,
    requestedProcedure: "Unknown procedure",
    age: 0,
    confidence: FALLBACK_CONFIDENCE,
  };
}

async function extractClaimData({ buffer, mimeType }) {
  try {
    const result = await getExtractor().invoke([
      new HumanMessage({
        content: [
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
          {
            type: "media",
            mimeType,
            data: buffer.toString("base64"),
          },
        ],
      }),
    ]);

    console.log("[Gemini Raw Response]", result);

    return {
      data: claimExtractionSchema.parse(normalizeStructuredExtraction(result)),
      meta: createExtractionMeta({
        mode: "gemini",
        degraded: false,
      }),
    };
  } catch (error) {
    const reasonCode = classifyExtractionError(error);

    if (env.allowDegradedAiFallback && FALLBACK_REASON_CODES.has(reasonCode)) {
      const meta = createExtractionMeta({
        mode: "fallback-unavailable",
        degraded: true,
        reasonCode,
        reason: error.message,
      });

      console.warn("[AuthClear] Gemini extraction unavailable.", {
        provider: EXTRACTION_PROVIDER,
        model: resolveGeminiTextModel(env.geminiTextModel),
        mode: meta.mode,
        reasonCode: meta.reasonCode,
        reason: meta.reason,
      });

      return {
        data: createUnavailableExtraction(),
        meta,
      };
    }

    const wrapped = new Error("Gemini extraction failed or returned invalid JSON.");
    wrapped.statusCode = 502;
    wrapped.details = {
      provider: EXTRACTION_PROVIDER,
      model: resolveGeminiTextModel(env.geminiTextModel),
      reasonCode,
      error: trimReason(error.message),
    };
    throw wrapped;
  }
}

module.exports = {
  classifyExtractionError,
  extractClaimData,
};
