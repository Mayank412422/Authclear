const { initializeDatabase } = require("../db");
const { syncPolicyCatalog } = require("./retriever");
const { env } = require("../config/env");

const startupState = {
  status: "pending",
  lastReadyAt: null,
  lastError: null,
  warnings: [],
  dependencies: {
    database: "pending",
    retrieval: "pending",
  },
  warmupPromise: null,
};

function formatDependencyError(error, dependency) {
  return {
    dependency,
    message: error.message,
    code: error.code || null,
    hint:
      error.code === "ENOTFOUND"
        ? "Verify the PostgreSQL or Pinecone host in your environment configuration."
        : "Verify DATABASE_URL, GEMINI_API_KEY, PINECONE_API_KEY, and network access.",
  };
}

function createSyncFailure(result) {
  const error = new Error(
    result.error || "Policy indexing could not initialize Pinecone retrieval."
  );
  error.code = result.errorCode || null;
  return error;
}

function getStartupStatus() {
  return {
    status: startupState.status,
    ready: startupState.status === "ready",
    degraded: startupState.status === "degraded",
    lastReadyAt: startupState.lastReadyAt,
    lastError: startupState.lastError,
    warnings: startupState.warnings,
    dependencies: startupState.dependencies,
  };
}

async function warmupDependencies() {
  if (startupState.warmupPromise) {
    return startupState.warmupPromise;
  }

  startupState.status = "initializing";
  startupState.lastError = null;
  startupState.warnings = [];
  startupState.dependencies = {
    database: "pending",
    retrieval: "pending",
  };

  startupState.warmupPromise = (async () => {
    try {
      await initializeDatabase();
      startupState.dependencies.database = "ready";
      const syncResult = await syncPolicyCatalog();

      if (syncResult.mode !== "pinecone") {
        const optionalError = createSyncFailure(syncResult);

        startupState.dependencies.retrieval = env.allowDegradedAiFallback
          ? "degraded"
          : "failed";

        if (!env.allowDegradedAiFallback) {
          throw optionalError;
        }

        startupState.status = "degraded";
        startupState.lastReadyAt = new Date().toISOString();
        startupState.warnings = [
          formatDependencyError(optionalError, "retrieval"),
        ];
        return getStartupStatus();
      }

      startupState.status = "ready";
      startupState.lastReadyAt = new Date().toISOString();
      startupState.dependencies.retrieval = "ready";
      return getStartupStatus();
    } catch (error) {
      if (startupState.dependencies.database !== "ready") {
        startupState.dependencies.database = "failed";
        startupState.dependencies.retrieval = "pending";
        startupState.lastError = formatDependencyError(error, "database");
      } else {
        startupState.lastError = formatDependencyError(error, "retrieval");
      }

      startupState.status = "degraded";
      throw error;
    } finally {
      startupState.warmupPromise = null;
    }
  })();

  return startupState.warmupPromise;
}

async function ensureDependenciesReady() {
  try {
    await warmupDependencies();
  } catch (_error) {
    const state = getStartupStatus();
    const wrapped = new Error(
      "Backend dependencies are unavailable. Check PostgreSQL connectivity and AI provider configuration."
    );
    wrapped.statusCode = 503;
    wrapped.details = state.lastError;
    throw wrapped;
  }
};
module.exports = {
  ensureDependenciesReady,
  getStartupStatus,
  warmupDependencies,
};
