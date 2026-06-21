const path = require("path");
const dotenv = require("dotenv");
const { z } = require("zod");

dotenv.config({
  path: path.resolve(__dirname, "..", ".env"),
});

function parseBooleanEnv(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return value;
}

function normalizeOptionalSecret(value) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function splitConnectionUrl(rawUrl) {
  const schemeMatch = rawUrl.match(/^(postgres(?:ql)?):\/\//i);

  if (!schemeMatch) {
    return null;
  }

  const scheme = schemeMatch[1].toLowerCase();
  const remainder = rawUrl.slice(schemeMatch[0].length);
  const pathStart = remainder.search(/[/?#]/);
  const authority =
    pathStart === -1 ? remainder : remainder.slice(0, pathStart);
  const suffix = pathStart === -1 ? "" : remainder.slice(pathStart);
  const lastAtIndex = authority.lastIndexOf("@");

  if (lastAtIndex === -1) {
    return {
      scheme,
      authority,
      hostPort: authority,
      suffix,
      username: "",
      password: "",
    };
  }

  const userInfo = authority.slice(0, lastAtIndex);
  const hostPort = authority.slice(lastAtIndex + 1);
  const colonIndex = userInfo.indexOf(":");

  if (colonIndex === -1) {
    return {
      scheme,
      authority,
      hostPort,
      suffix,
      username: userInfo,
      password: "",
    };
  }

  return {
    scheme,
    authority,
    hostPort,
    suffix,
    username: userInfo.slice(0, colonIndex),
    password: userInfo.slice(colonIndex + 1),
  };
}

function normalizeDatabaseUrl(rawUrl) {
  const trimmedUrl = String(rawUrl || "").trim();
  const parsedParts = splitConnectionUrl(trimmedUrl);

  if (!parsedParts) {
    throw new Error(
      "DATABASE_URL must start with postgres:// or postgresql://."
    );
  }

  const baseUrl = new URL(`postgresql://${parsedParts.hostPort}${parsedParts.suffix}`);

  if (parsedParts.username) {
    baseUrl.username = decodeURIComponent(parsedParts.username);
  }

  if (parsedParts.password) {
    baseUrl.password = decodeURIComponent(parsedParts.password);
  }

  return baseUrl.toString();
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  GEMINI_API_KEY: z.string().optional().default(""),
  PINECONE_API_KEY: z.string().optional().default(""),
  CLIENT_ORIGIN: z
    .string()
    .min(1)
    .default("http://localhost:5173,https://authclear.vercel.app"),
  MANUAL_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  POLICY_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  PINECONE_INDEX_NAME: z.string().default("insurance-policies"),
  PINECONE_NAMESPACE: z.string().default("authclear-policies"),
  GEMINI_TEXT_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  PINECONE_CLOUD: z.string().default("aws"),
  PINECONE_REGION: z.string().default("us-east-1"),
  ALLOW_DEGRADED_AI_FALLBACK: z
    .preprocess(parseBooleanEnv, z.boolean())
    .default(true),
}).superRefine((data, context) => {
  if (data.ALLOW_DEGRADED_AI_FALLBACK) {
    return;
  }

  if (!String(data.GEMINI_API_KEY || "").trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GEMINI_API_KEY"],
      message:
        "GEMINI_API_KEY is required when ALLOW_DEGRADED_AI_FALLBACK is false.",
    });
  }

  if (!String(data.PINECONE_API_KEY || "").trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PINECONE_API_KEY"],
      message:
        "PINECONE_API_KEY is required when ALLOW_DEGRADED_AI_FALLBACK is false.",
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => issue.message)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

const env = {
  port: parsed.data.PORT,
  databaseUrl: normalizeDatabaseUrl(parsed.data.DATABASE_URL),
  geminiApiKey: normalizeOptionalSecret(parsed.data.GEMINI_API_KEY),
  pineconeApiKey: normalizeOptionalSecret(parsed.data.PINECONE_API_KEY),
  clientOrigin: normalizeOrigins(parsed.data.CLIENT_ORIGIN),
  manualReviewThreshold: parsed.data.MANUAL_REVIEW_THRESHOLD,
  policyMatchThreshold: parsed.data.POLICY_MATCH_THRESHOLD,
  pineconeIndexName: parsed.data.PINECONE_INDEX_NAME,
  pineconeNamespace: parsed.data.PINECONE_NAMESPACE,
  geminiTextModel: parsed.data.GEMINI_TEXT_MODEL,
  geminiEmbeddingModel: parsed.data.GEMINI_EMBEDDING_MODEL,
  pineconeCloud: parsed.data.PINECONE_CLOUD,
  pineconeRegion: parsed.data.PINECONE_REGION,
  allowDegradedAiFallback: parsed.data.ALLOW_DEGRADED_AI_FALLBACK,
};

module.exports = {
  env,
};
