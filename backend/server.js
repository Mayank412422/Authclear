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

    res.json({
      status: startup.ready ? "ok" : "degraded",
      service: "AuthClear API",
      timestamp: new Date().toISOString(),
      degradedMode: startup.degraded,
      retrieval: {
        ready: startup.dependencies.retrieval.ready,
        mode: startup.dependencies.retrieval.mode,
        indexExists: startup.dependencies.retrieval.indexExists,
        vectorCount: startup.dependencies.retrieval.vectorCount,
      },
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
