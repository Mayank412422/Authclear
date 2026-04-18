const { initializeDatabase } = require("../db");
const { syncPolicyCatalog } = require("./retriever");

const startupState = {
  status: "pending",
  lastReadyAt: null,
  lastError: null,
  warmupPromise: null,
};

function formatDependencyError(error) {
  return {
    message: error.message,
    code: error.code || null,
    hint:
      error.code === "ENOTFOUND"
        ? "Verify the PostgreSQL or Pinecone host in your environment configuration."
        : "Verify DATABASE_URL, GEMINI_API_KEY, PINECONE_API_KEY, and network access.",
  };
}

function getStartupStatus() {
  return {
    status: startupState.status,
    ready: startupState.status === "ready",
    lastReadyAt: startupState.lastReadyAt,
    lastError: startupState.lastError,
  };
}

async function warmupDependencies() {
  if (startupState.warmupPromise) {
    return startupState.warmupPromise;
  }

  startupState.status = "initializing";
  startupState.lastError = null;

  startupState.warmupPromise = (async () => {
    try {
      await initializeDatabase();
      await syncPolicyCatalog();

      startupState.status = "ready";
      startupState.lastReadyAt = new Date().toISOString();
      return getStartupStatus();
    } catch (error) {
      startupState.status = "degraded";
      startupState.lastError = formatDependencyError(error);
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
      "Backend dependencies are unavailable. Check PostgreSQL and Pinecone connectivity."
    );
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
