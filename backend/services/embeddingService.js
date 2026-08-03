const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

const { env } = require("../config/env");
const { log } = require("../utils/logger");

const EMBEDDING_DIMENSION = 768;

let embeddings;

function getEmbeddingsClient() {
  if (!embeddings) {
    if (!env.geminiApiKey) {
      const error = new Error("GEMINI_API_KEY is not configured.");
      error.code = "MISSING_API_KEY";
      throw error;
    }

    embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: env.geminiApiKey,
      model: env.geminiEmbeddingModel,
      // gemini-embedding-001 defaults to 3072 dims; pin to 768 to match the
      // existing Pinecone index dimension (uses MRL truncation).
      outputDimensionality: EMBEDDING_DIMENSION,
    });
  }

  return embeddings;
}

async function embedQuery(text) {
  log("INFO", "embedding.query.start", {
    model: env.geminiEmbeddingModel,
    textLength: String(text || "").length,
  });
  return getEmbeddingsClient().embedQuery(text);
}

async function embedPolicyChunks(chunks) {
  log("INFO", "embedding.documents.start", {
    model: env.geminiEmbeddingModel,
    chunkCount: chunks.length,
  });
  return getEmbeddingsClient().embedDocuments(chunks);
}

async function probeEmbeddingService() {
  try {
    await embedQuery("AuthClear embedding health probe");
    return {
      ready: true,
      provider: "gemini",
      model: env.geminiEmbeddingModel,
      error: null,
    };
  } catch (error) {
    log("ERROR", "embedding.health.failed", {
      model: env.geminiEmbeddingModel,
    }, error);

    return {
      ready: false,
      provider: "gemini",
      model: env.geminiEmbeddingModel,
      error: error.message,
    };
  }
}

module.exports = {
  EMBEDDING_DIMENSION,
  embedPolicyChunks,
  embedQuery,
  probeEmbeddingService,
};
