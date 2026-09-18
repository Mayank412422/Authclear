const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const casesPath = path.join(__dirname, "data", "e2eCases.json");
const resultsPath = path.join(__dirname, "data", "e2eResults.json");
const casesFile = JSON.parse(fs.readFileSync(casesPath, "utf8"));

function missingConfiguration() {
  return ["DATABASE_URL", "GEMINI_API_KEY", "PINECONE_API_KEY"]
    .filter((key) => !String(process.env[key] || "").trim());
}

function renderClinicalInput(e2eCase) {
  const escaped = e2eCase.rawClinicalInput
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="240"><rect width="100%" height="100%" fill="white"/><text x="20" y="70" font-size="22">${escaped}</text></svg>`
  );
}

function emptyResult(e2eCase) {
  return {
    caseId: e2eCase.caseId,
    sourceBenchmarkCaseId: e2eCase.sourceBenchmarkCaseId,
    category: e2eCase.category,
    rawClinicalInput: e2eCase.rawClinicalInput,
    policyId: e2eCase.policyId,
    expectedAuthorization: e2eCase.expectedAuthorization,
    actualAuthorization: null,
    extractedData: null,
    extractionConfidence: null,
    retrievedPolicy: null,
    decisionReason: null,
    latencyMs: null,
    pipelineStatus: "not_executed",
    error: null,
    result: null,
  };
}

function classifyError(error) {
  const stage = String(error?.details?.stage || error?.stage || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (stage.includes("extraction") || message.includes("gemini extraction")) return "AI extraction error";
  if (message.includes("zod") || message.includes("validation")) return "validation error";
  if (stage.includes("pinecone") || message.includes("retrieval") || message.includes("pinecone")) return "policy retrieval error";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (stage.includes("storage") || message.includes("postgres")) return "database/runtime error";
  return "other pipeline error";
}

function makeBlockedResults(reason, missing) {
  return casesFile.cases.map((e2eCase) => ({
    ...emptyResult(e2eCase),
    pipelineStatus: "blocked_before_execution",
    error: { category: "configuration", message: reason, missing },
  }));
}

function makeSummary({ results, smokeCasesAttempted, smokeCasesExecuted, stoppedAt, externalServicesReached }) {
  const classified = results.filter((item) => item.pipelineStatus === "completed" && (item.actualAuthorization === "APPROVED" || item.actualAuthorization === "DENIED"));
  const tp = classified.filter((item) => item.expectedAuthorization === "APPROVED" && item.actualAuthorization === "APPROVED").length;
  const tn = classified.filter((item) => item.expectedAuthorization === "DENIED" && item.actualAuthorization === "DENIED").length;
  const fp = classified.filter((item) => item.expectedAuthorization === "DENIED" && item.actualAuthorization === "APPROVED").length;
  const fn = classified.filter((item) => item.expectedAuthorization === "APPROVED" && item.actualAuthorization === "DENIED").length;
  const safeDivide = (numerator, denominator) => denominator === 0 ? null : numerator / denominator;
  const accuracy = safeDivide(tp + tn, classified.length);
  const precision = safeDivide(tp, tp + fp);
  const recall = safeDivide(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : (2 * precision * recall) / (precision + recall);
  const latencies = classified.map((item) => item.latencyMs).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  const percentile = (values, fraction) => values.length === 0 ? null : values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
  const errorCategories = {};
  for (const item of results) {
    if (item.error?.category) errorCategories[item.error.category] = (errorCategories[item.error.category] || 0) + 1;
  }

  return {
    casesPrepared: casesFile.cases.length,
    casesExecuted: results.filter((item) => item.pipelineStatus === "completed" || item.pipelineStatus === "error").length,
    casesSuccessfullyClassified: classified.length,
    casesBlockedOrNotExecuted: results.filter((item) => item.actualAuthorization === null).length,
    passed: classified.filter((item) => item.result === "PASS").length,
    failed: classified.filter((item) => item.result === "FAIL").length,
    confusionMatrix: { TP: tp, TN: tn, FP: fp, FN: fn },
    metrics: { accuracy, precision, recall, f1 },
    latencyMs: {
      minimum: latencies[0] ?? null,
      median: percentile(latencies, 0.5),
      mean: latencies.length === 0 ? null : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      p90: percentile(latencies, 0.9),
      p95: percentile(latencies, 0.95),
      maximum: latencies[latencies.length - 1] ?? null,
    },
    errorCategories,
    smokeGate: { casesAttempted: smokeCasesAttempted, casesExecuted: smokeCasesExecuted },
    stoppedAt,
    externalServicesReached,
  };
}

function writeOutput(results, summary) {
  fs.writeFileSync(resultsPath, `${JSON.stringify({
    evaluationName: "authclear-500-case-end-to-end-authorization",
    sourceCases: "evaluation/e2e/data/e2eCases.json",
    realPipelineRequired: true,
    externalServicesCalled: summary.externalServicesReached.length > 0,
    summary,
    cases: results,
  }, null, 2)}\n`);
}

async function execute() {
  const missing = missingConfiguration();
  if (missing.length > 0) {
    const reason = `End-to-end execution stopped before the five-case smoke gate because required configuration is missing: ${missing.join(", ")}.`;
    const results = makeBlockedResults(reason, missing);
    const summary = makeSummary({ results, smokeCasesAttempted: 0, smokeCasesExecuted: 0, stoppedAt: "preflight", externalServicesReached: [] });
    writeOutput(results, summary);
    console.log(reason);
    return;
  }

  const { processClaim } = require("../../backend/services/pipeline");
  const results = casesFile.cases.map(emptyResult);
  const smokeCount = Math.min(5, results.length);
  let smokeCasesExecuted = 0;
  const externalServicesReached = [];

  for (let index = 0; index < smokeCount; index += 1) {
    const result = results[index];
    const started = performance.now();
    try {
      const response = await processClaim({ buffer: renderClinicalInput(casesFile.cases[index]), mimeType: "image/svg+xml", fileName: `${result.caseId}.svg` });
      result.actualAuthorization = response.decision?.status || null;
      result.extractedData = response.extractedData || null;
      result.extractionConfidence = response.metadata?.confidence ?? null;
      result.retrievedPolicy = response.policy || null;
      result.decisionReason = response.decision?.reason || null;
      result.pipelineStatus = "completed";
      result.result = result.actualAuthorization === result.expectedAuthorization ? "PASS" : "FAIL";
      if (response.metadata?.extraction?.mode === "gemini") externalServicesReached.push("Gemini extraction");
      if (response.policy?.retrievalMode === "pinecone") externalServicesReached.push("Pinecone retrieval");
      if (response.metadata?.persisted) externalServicesReached.push("PostgreSQL persistence");

      if (
        response.metadata?.extraction?.mode !== "gemini" ||
        response.policy?.retrievalMode !== "pinecone" ||
        !result.actualAuthorization
      ) {
        throw Object.assign(
          new Error("Five-case smoke gate did not prove full Gemini extraction, Pinecone retrieval, and authorization."),
          { code: "SMOKE_GATE_NOT_FULL_AI" }
        );
      }

      smokeCasesExecuted += 1;
    } catch (error) {
      result.pipelineStatus = "error";
      result.error = { category: classifyError(error), message: error.message, details: error.details || null };
      result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
      const summary = makeSummary({ results, smokeCasesAttempted: smokeCount, smokeCasesExecuted, stoppedAt: `smoke_case_${index + 1}`, externalServicesReached: [...new Set(externalServicesReached)] });
      writeOutput(results, summary);
      console.log(`End-to-end execution stopped at smoke case ${index + 1}: ${error.message}`);
      return;
    }
    result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
  }

  for (let index = smokeCount; index < results.length; index += 1) {
    const result = results[index];
    const started = performance.now();
    try {
      const response = await processClaim({ buffer: renderClinicalInput(casesFile.cases[index]), mimeType: "image/svg+xml", fileName: `${result.caseId}.svg` });
      result.actualAuthorization = response.decision?.status || null;
      result.extractedData = response.extractedData || null;
      result.extractionConfidence = response.metadata?.confidence ?? null;
      result.retrievedPolicy = response.policy || null;
      result.decisionReason = response.decision?.reason || null;
      result.pipelineStatus = "completed";
      result.result = result.actualAuthorization === result.expectedAuthorization ? "PASS" : "FAIL";
    } catch (error) {
      result.pipelineStatus = "error";
      result.error = { category: classifyError(error), message: error.message, details: error.details || null };
    } finally {
      result.latencyMs = Math.round((performance.now() - started) * 100) / 100;
    }
  }

  const summary = makeSummary({ results, smokeCasesAttempted: smokeCount, smokeCasesExecuted, stoppedAt: null, externalServicesReached: [...new Set(externalServicesReached)] });
  writeOutput(results, summary);
  console.log(`Completed ${summary.casesSuccessfullyClassified} classified end-to-end cases.`);
}

execute().catch((error) => {
  const results = makeBlockedResults(`Runner error: ${error.message}`, []);
  const summary = makeSummary({ results, smokeCasesAttempted: 0, smokeCasesExecuted: 0, stoppedAt: "runner_error", externalServicesReached: [] });
  writeOutput(results, summary);
  console.error(error);
  process.exitCode = 1;
});