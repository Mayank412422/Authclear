const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

const { env } = require("../config/env");

const EMBEDDING_DIMENSION = 768;

let embeddings;

function getEmbeddingsClient() {
  if (!embeddings) {
    embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: env.geminiApiKey,
      model: env.geminiEmbeddingModel,
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
