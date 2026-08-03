const { performance } = require("node:perf_hooks");
const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const { env } = require("../config/env");
const { log } = require("../utils/logger");

const ragAnswerSchema = z.object({
  finalAnswer: z.string().min(10),
});

let answerGenerator;

function createMissingApiKeyError() {
  const error = new Error("GEMINI_API_KEY is not configured.");
  error.code = "MISSING_API_KEY";
  return error;
}

function getAnswerGenerator() {
  if (!answerGenerator) {
    if (!env.geminiApiKey) {
      throw createMissingApiKeyError();
    }

    const model = new ChatGoogleGenerativeAI({
      apiKey: env.geminiApiKey,
      model: env.geminiTextModel,
      temperature: 0.1,
      maxRetries: 2,
    });

    answerGenerator = model.withStructuredOutput(ragAnswerSchema, {
      name: "rag_claim_answer",
      method: "jsonSchema",
    });
  }

  return answerGenerator;
}

function buildPolicyContext(topMatches) {
  return topMatches
    .map((match, index) => {
      return [
        `Document ${index + 1}`,
        `Policy ID: ${match.id}`,
        `Procedure: ${match.procedure}`,
        `Similarity score: ${match.score}`,
        `Clause: ${match.clause}`,
        `Chunk: ${match.chunkText || match.clause}`,
      ].join("\n");
    })
    .join("\n\n");
}

async function generateRagAnswer({ extractedData, policy, deterministicDecision }) {
  const generationStarted = performance.now();
  const context = buildPolicyContext(policy.topMatches || []);

  log("INFO", "llm.generation.start", {
    model: env.geminiTextModel,
    retrievedDocumentCount: (policy.topMatches || []).length,
  });

  const response = await getAnswerGenerator().invoke([
    [
      "system",
      "You are an insurance prior-authorization assistant. Use only the provided policy context. If context is insufficient, explicitly say so.",
    ],
    [
      "human",
      [
        "Medical request:",
        `Patient ID: ${extractedData.patientId}`,
        `Diagnosis: ${extractedData.diagnosis}`,
        `Requested procedure: ${extractedData.requestedProcedure}`,
        `Symptom duration (months): ${extractedData.symptomDuration}`,
        `Age: ${extractedData.age}`,
        "",
        "Policy retrieval context:",
        context,
        "",
        "Deterministic adjudication status:",
        deterministicDecision.status,
        "",
        "Write the final decision explanation grounded in the retrieved policy context and include why the request is approved or denied.",
      ].join("\n"),
    ],
  ]);

  log("INFO", "llm.generation.complete", {
    model: env.geminiTextModel,
    latencyMs: Math.round(performance.now() - generationStarted),
  });

  return response.finalAnswer;
}

async function probeGenerationService() {
  try {
    const response = await getAnswerGenerator().invoke([
      ["system", "Return a short health response."],
      ["human", "Respond with: AuthClear generation service is ready."],
    ]);

    return {
      ready: Boolean(response.finalAnswer),
      provider: "gemini",
      model: env.geminiTextModel,
      error: null,
    };
  } catch (error) {
    log("ERROR", "llm.health.failed", {
      model: env.geminiTextModel,
    }, error);

    return {
      ready: false,
      provider: "gemini",
      model: env.geminiTextModel,
      error: error.message,
    };
  }
}

module.exports = {
  generateRagAnswer,
  probeGenerationService,
};
