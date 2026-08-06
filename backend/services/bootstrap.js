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
    errorCode: retrieval.lastErrorCode,
    mode: retrieval.mode,
    indexExists: retrieval.indexExists,
    vectorCount: retrieval.vectorCount,
    namespace: retrieval.namespace,
    indexName: retrieval.indexName,
  };
  startupState.dependencies.pinecone = {
    ready: retrieval.mode === "pinecone",
    connected: retrieval.indexExists,
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

/**
 * dependency = "pinecone" is special-cased: retrieval failures are ALWAYS
 * fatal ("failed"), regardless of ALLOW_DEGRADED_AI_FALLBACK. That flag
 * only ever softens Gemini extraction/generation failures, never the
 * Pinecone/RAG retrieval path.
 */
function markFailure(error, dependency) {
  const isPineconeFailure = dependency === "pinecone";
  startupState.status = !isPineconeFailure && env.allowDegradedAiFallback ? "degraded" : "failed";
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

      // --- Pinecone / RAG retrieval: NO silent fallback, ever. -----------
      // This block intentionally ignores ALLOW_DEGRADED_AI_FALLBACK. If
      // Pinecone cannot be reached, the index is missing/misconfigured, or
      // the sync doesn't end in "pinecone" mode, startup fails hard.
      let syncResult;
      try {
        syncResult = await syncPolicyCatalog();
      } catch (retrievalError) {
        updateRetrievalDependency();
        markFailure(retrievalError, "pinecone");
        console.error(`[PINECONE] FATAL — startup cannot continue: ${retrievalError.message}`);
        log("ERROR", "startup.pinecone.failed", { code: retrievalError.code || null }, retrievalError);
        throw retrievalError;
      }

      updateRetrievalDependency();

      if (syncResult.mode !== "pinecone" || !syncResult.ready) {
        const hardError = new Error(
          syncResult.error || `Pinecone retrieval is not ready (mode="${syncResult.mode}").`
        );
        hardError.code = syncResult.errorCode || "RETRIEVAL_NOT_READY";
        markFailure(hardError, "pinecone");
        console.error(`[PINECONE] FATAL — retrieval mode is "${syncResult.mode}", expected "pinecone".`);
        log("ERROR", "startup.pinecone.not_ready", { mode: syncResult.mode }, hardError);
        throw hardError;
      }

      console.log(
        `[PINECONE] Startup sync OK — index="${env.pineconeIndexName}" ` +
        `namespace="${env.pineconeNamespace}" vectors=${startupState.dependencies.retrieval.vectorCount}`
      );

      // --- Embeddings & LLM: still governed by ALLOW_DEGRADED_AI_FALLBACK
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

      const isPineconeFailure = startupState.dependencies.retrieval.mode !== "pinecone";
      markFailure(error, error.code === "MISSING_API_KEY" && isPineconeFailure ? "pinecone" : (isPineconeFailure ? "pinecone" : "startup"));

      // Pinecone/retrieval failures are ALWAYS fatal. ALLOW_DEGRADED_AI_FALLBACK
      // is only ever applied to Gemini extraction/generation, never to retrieval.
      if (!env.allowDegradedAiFallback || isPineconeFailure) {
        log("ERROR", "startup.failed", { fatal: true }, error);
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
