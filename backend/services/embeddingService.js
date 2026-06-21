const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

const { env } = require("../config/env");

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
  return getEmbeddingsClient().embedQuery(text);
}

async function embedPolicyChunks(chunks) {
  return getEmbeddingsClient().embedDocuments(chunks);
}

module.exports = {
  EMBEDDING_DIMENSION,
  embedPolicyChunks,
  embedQuery,
};
