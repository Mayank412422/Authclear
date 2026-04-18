const express = require("express");
const cors = require("cors");

const { env } = require("./config/env");
const claimRoutes = require("./routes/claim");
const { getStartupStatus } = require("./services/bootstrap");

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
      dependencies: startup,
    });
  });

  app.use("/api", claimRoutes);

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || 500;

    console.error(
      `[AuthClear] ${statusCode} ${error.message}`,
      error.details ? { details: error.details } : ""
    );

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

  await new Promise((resolve, reject) => {
    const server = app.listen(env.port, () => {
      console.log(`[AuthClear] Backend listening on port ${env.port}`);
      resolve(server);
    });

    server.on("error", reject);
  });
}

startServer().catch((error) => {
  console.error("[AuthClear] Failed to start backend", error.message);
  process.exit(1);
});
