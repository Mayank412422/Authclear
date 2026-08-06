const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

const { env } = require("../config/env");
const { log } = require("../utils/logger");

const EMBEDDING_DIMENSION = 768;

let embeddings;

function getEmbeddingsClient() {
  if (!embeddings) {
    if (!env.geminiApiKey) {
      console.error("[EMBEDDING] Missing GEMINI_API_KEY — cannot initialize embeddings client.");
      const error = new Error("GEMINI_API_KEY is not configured.");
      error.code = "MISSING_API_KEY";
      throw error;
    }

    console.log(`[EMBEDDING] Initializing embeddings client (model=${env.geminiEmbeddingModel}, targetDimensionality=${EMBEDDING_DIMENSION})...`);
    embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: env.geminiApiKey,
      model: env.geminiEmbeddingModel,
      // Pass this just in case future Langchain versions support it natively
      outputDimensionality: EMBEDDING_DIMENSION,
    });
    console.log("[EMBEDDING] Client initialized.");
  }

  return embeddings;
}

async function embedQuery(text) {
  log("INFO", "embedding.query.start", {
    model: env.geminiEmbeddingModel,
    textLength: String(text || "").length,
  });

  try {
    let vector = await getEmbeddingsClient().embedQuery(text);
    
    // GUARANTEED FIX: Manually slice the array to exactly 768 dimensions
    if (vector.length > EMBEDDING_DIMENSION) {
      vector = vector.slice(0, EMBEDDING_DIMENSION);
    }

    console.log(`[EMBEDDING] Generation success — query embedding dimension=${vector.length}.`);

    if (vector.length !== EMBEDDING_DIMENSION) {
      console.error(`[EMBEDDING] DIMENSION MISMATCH — expected ${EMBEDDING_DIMENSION}, got ${vector.length}.`);
    }

    return vector;
  } catch (error) {
    console.error(`[EMBEDDING] embedQuery failed: ${error.message}`);
    log("ERROR", "embedding.query.failed", {
      model: env.geminiEmbeddingModel,
    }, error);
    throw error;
  }
}

async function embedPolicyChunks(chunks) {
  log("INFO", "embedding.documents.start", {
    model: env.geminiEmbeddingModel,
    chunkCount: chunks.length,
  });

  try {
    let vectors = await getEmbeddingsClient().embedDocuments(chunks);
    
    // GUARANTEED FIX: Manually slice all vectors to exactly 768 dimensions
    vectors = vectors.map(v => v.length > EMBEDDING_DIMENSION ? v.slice(0, EMBEDDING_DIMENSION) : v);

    console.log(`[EMBEDDING] Generation success — produced ${vectors.length} document embedding(s), dimension=${vectors[0]?.length ?? "unknown"}.`);
    return vectors;
  } catch (error) {
    console.error(`[EMBEDDING] embedDocuments failed: ${error.message}`);
    log("ERROR", "embedding.documents.failed", {
      model: env.geminiEmbeddingModel,
      chunkCount: chunks.length,
    }, error);
    throw error;
  }
}

async function probeEmbeddingService() {
  try {
    await embedQuery("AuthClear embedding health probe");
    return {
      ready: true,
      provider: "gemini",
      model: env.geminiEmbeddingModel,
      dimension: EMBEDDING_DIMENSION,
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
      dimension: EMBEDDING_DIMENSION,
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