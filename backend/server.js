const express = require("express");
const cors = require("cors");

const { env } = require("./config/env");
const claimRoutes = require("./routes/claim");
const { getStartupStatus, warmupDependencies } = require("./services/bootstrap");
const { log } = require("./utils/logger");

async function startServer() {
  const app = express();

  app.use(
    cors({
      origin: env.clientOrigin,
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    const startup = getStartupStatus();
    const retrieval = startup.dependencies.retrieval;
    const pinecone = startup.dependencies.pinecone;

    const retrievalReady = retrieval.ready && retrieval.mode === "pinecone";
    const pineconeConnected = Boolean(pinecone.ready);

    res.json({
      status: startup.ready ? "ok" : "degraded",
      service: "AuthClear API",
      timestamp: new Date().toISOString(),

      // Strict, top-level fields required by the health contract.
      retrieval: retrievalReady ? "ready" : "not_ready",
      pinecone: pineconeConnected ? "connected" : "disconnected",
      policy: {
        retrievalMode: retrieval.mode,
        indexName: retrieval.indexName,
        namespace: retrieval.namespace,
        vectorCount: retrieval.vectorCount,
        indexExists: retrieval.indexExists,
      },
      metadata: {
        degraded: startup.degraded,
        processingMode: startup.degraded ? "degraded" : "full-ai",
      },

      // Full diagnostic detail, preserved for debugging/observability.
      degradedMode: startup.degraded,
      dependencies: startup.dependencies,
      startup: {
        status: startup.status,
        lastReadyAt: startup.lastReadyAt,
        lastError: startup.lastError,
      },
    });
  });

  app.use("/api", claimRoutes);

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || 500;

    log("ERROR", "request.failed", {
      statusCode,
      message: error.message,
      details: error.details || null,
    }, error);

    if (error.name === "MulterError") {
      return res.status(400).json({
        message: error.message,
      });
    }

    return res.status(statusCode).json({
      message: error.message || "Unexpected server error.",
      details: error.details || undefined,
    });
  });

  await warmupDependencies();

  await new Promise((resolve, reject) => {
    const server = app.listen(env.port, () => {
      log("INFO", "server.started", {
        port: env.port,
      });
      resolve(server);
    });

    server.on("error", reject);
  });
}

startServer().catch((error) => {
  log("ERROR", "server.start.failed", {}, error);
  process.exit(1);
});