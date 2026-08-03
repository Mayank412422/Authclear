const { initializeDatabase } = require("../db");
const { env } = require("../config/env");
const { probeEmbeddingService } = require("./embeddingService");
const { probeGenerationService } = require("./ragGenerator");
const { getRetrievalStatus, syncPolicyCatalog } = require("./retriever");
const { log } = require("../utils/logger");

const startupState = {
  status: "pending",
  lastReadyAt: null,
  lastError: null,
  degraded: false,
  dependencies: {
    database: { ready: false, error: null },
    pinecone: { ready: false, error: null },
    embeddings: { ready: false, error: null },
    llm: { ready: false, error: null },
    retrieval: {
      ready: false,
      error: null,
      mode: "uninitialized",
      indexExists: false,
      vectorCount: 0,
      namespace: env.pineconeNamespace,
      indexName: env.pineconeIndexName,
    },
  },
  warmupPromise: null,
};

function updateRetrievalDependency() {
  const retrieval = getRetrievalStatus();
  startupState.dependencies.retrieval = {
    ready: retrieval.ready,
    error: retrieval.lastError,
    mode: retrieval.mode,
    indexExists: retrieval.indexExists,
    vectorCount: retrieval.vectorCount,
    namespace: retrieval.namespace,
    indexName: retrieval.indexName,
  };
  startupState.dependencies.pinecone = {
    ready: retrieval.indexExists,
    error: retrieval.lastError,
  };
}

function getStartupStatus() {
  return {
    status: startupState.status,
    ready: startupState.status === "ready",
    degraded: startupState.degraded,
    lastReadyAt: startupState.lastReadyAt,
    lastError: startupState.lastError,
    dependencies: startupState.dependencies,
  };
}

function markFailure(error, dependency) {
  startupState.status = env.allowDegradedAiFallback ? "degraded" : "failed";
  startupState.degraded = true;
  startupState.lastError = {
    dependency,
    message: error.message,
    code: error.code || null,
  };
}

async function warmupDependencies() {
  if (startupState.warmupPromise) {
    return startupState.warmupPromise;
  }

  startupState.status = "initializing";
  startupState.degraded = false;
  startupState.lastError = null;

  startupState.warmupPromise = (async () => {
    try {
      await initializeDatabase();
      startupState.dependencies.database = { ready: true, error: null };

      const syncResult = await syncPolicyCatalog();
      updateRetrievalDependency();

      if (syncResult.mode !== "pinecone") {
        throw new Error(syncResult.error || "Pinecone retrieval is not ready.");
      }

      const embeddingStatus = await probeEmbeddingService();
      startupState.dependencies.embeddings = embeddingStatus;

      if (!embeddingStatus.ready) {
        throw new Error(embeddingStatus.error || "Embedding service is unavailable.");
      }

      const generationStatus = await probeGenerationService();
      startupState.dependencies.llm = generationStatus;

      if (!generationStatus.ready) {
        throw new Error(generationStatus.error || "LLM service is unavailable.");
      }

      startupState.status = "ready";
      startupState.degraded = false;
      startupState.lastReadyAt = new Date().toISOString();

      log("INFO", "startup.ready", {
        retrievalMode: startupState.dependencies.retrieval.mode,
        vectorCount: startupState.dependencies.retrieval.vectorCount,
      });

      return getStartupStatus();
    } catch (error) {
      updateRetrievalDependency();
      markFailure(error, "startup");

      if (!env.allowDegradedAiFallback) {
        log("ERROR", "startup.failed", {}, error);
        throw error;
      }

      log("WARN", "startup.degraded", {
        error: error.message,
      });

      return getStartupStatus();
    } finally {
      startupState.warmupPromise = null;
    }
  })();

  return startupState.warmupPromise;
}

async function ensureDependenciesReady() {
  await warmupDependencies();
  const state = getStartupStatus();

  if (!state.ready && !env.allowDegradedAiFallback) {
    const wrapped = new Error("Backend dependencies are unavailable.");
    wrapped.statusCode = 503;
    wrapped.details = state.lastError;
    throw wrapped;
  }
}

module.exports = {
  ensureDependenciesReady,
  getStartupStatus,
  warmupDependencies,
};
