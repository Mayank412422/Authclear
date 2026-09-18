const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { evaluateClaim } = require("../../backend/services/decisionEngine");

const casesPath = path.join(__dirname, "smokeCases.json");
const resultsPath = path.join(__dirname, "smokeResults.json");
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

function expectedDecision(smokeCase) {
  return evaluateClaim(smokeCase.expectedExtractedData, smokeCase.policy);
}

function imageBuffer(smokeCase) {
  const escapedText = smokeCase.clinicalText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="220"><rect width="100%" height="100%" fill="white"/><text x="20" y="60" font-size="22">${escapedText}</text></svg>`;
  return Buffer.from(svg);
}

function missingConfiguration() {
  const missing = [];
  if (!String(process.env.DATABASE_URL || "").trim()) missing.push("DATABASE_URL");

  const degraded = String(process.env.ALLOW_DEGRADED_AI_FALLBACK || "false").toLowerCase() === "true";
  if (!degraded && !String(process.env.GEMINI_API_KEY || "").trim()) missing.push("GEMINI_API_KEY");
  if (!degraded && !String(process.env.PINECONE_API_KEY || "").trim()) missing.push("PINECONE_API_KEY");
  return missing;
}

function baseResult(smokeCase) {
  return {
    caseId: smokeCase.caseId,
    category: smokeCase.category,
    input: {
      fileName: smokeCase.fileName,
      mimeType: smokeCase.mimeType,
      clinicalText: smokeCase.clinicalText,
    },
    expectedDecision: expectedDecision(smokeCase),
    actualDecision: null,
    pass: null,
    extractedData: null,
    extractionConfidence: null,
    retrievedPolicy: null,
    decisionReason: null,
    decisionRule: "evaluateClaim rule order: procedure, diagnosis, duration, age",
    degradedOrFallbackMode: null,
    latencyMs: null,
    error: null,
  };
}

async function run() {
  const results = cases.map(baseResult);
  const missing = missingConfiguration();

  if (missing.length > 0) {
    for (const result of results) {
      result.error = {
        type: "configuration_missing",
        message: `Real pipeline was not executed because required configuration is missing: ${missing.join(", ")}.`,
        missing,
      };
      result.degradedOrFallbackMode = "not-executed";
    }
    writeResults({
      executionMode: "direct-production-pipeline",
      measured: false,
      totalCases: cases.length,
      executedCases: 0,
      results,
      runError: `Missing configuration: ${missing.join(", ")}`,
    });
    console.log(`Smoke execution blocked before pipeline invocation. Missing: ${missing.join(", ")}`);
    return;
  }

  const { processClaim } = require("../../backend/services/pipeline");

  for (const [index, smokeCase] of cases.entries()) {
    const result = results[index];
    const started = performance.now();
    try {
      const response = await processClaim({
        buffer: imageBuffer(smokeCase),
        mimeType: smokeCase.mimeType,
        fileName: smokeCase.fileName,
      });
      result.actualDecision = response.decision?.status || null;
      result.pass = result.actualDecision === result.expectedDecision.status;
      result.extractedData = response.extractedData || null;
      result.extractionConfidence = response.metadata?.confidence ?? response.extractedData?.confidence ?? null;
      result.retrievedPolicy = response.policy || null;
      result.decisionReason = response.decision?.reason || null;
      result.degradedOrFallbackMode = response.metadata || null;
    } catch (error) {
      result.error = {
        type: error.code || error.name || "pipeline_error",
        message: error.message,
        details: error.details || null,
      };
      result.degradedOrFallbackMode = "pipeline-error";
    } finally {
      result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
    }
  }

  writeResults({
    executionMode: "direct-production-pipeline",
    measured: true,
    totalCases: cases.length,
    executedCases: cases.length,
    results,
    runError: null,
  });
  console.log(`Executed ${cases.length} smoke cases through the production pipeline.`);
}

function writeResults(payload) {
  fs.writeFileSync(resultsPath, `${JSON.stringify({ ...payload, generatedAt: new Date().toISOString() }, null, 2)}\n`);
}

run().catch((error) => {
  const results = cases.map((smokeCase) => ({
    ...baseResult(smokeCase),
    degradedOrFallbackMode: "runner-error",
    error: { type: error.code || error.name || "runner_error", message: error.message },
  }));
  writeResults({
    executionMode: "direct-production-pipeline",
    measured: false,
    totalCases: cases.length,
    executedCases: 0,
    results,
    runError: error.message,
  });
  console.error(error);
  process.exitCode = 1;
});