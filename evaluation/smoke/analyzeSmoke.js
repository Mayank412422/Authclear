const fs = require("node:fs");
const path = require("node:path");

const resultsPath = path.join(__dirname, "smokeResults.json");
const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const executed = results.results.filter((item) => item.actualDecision !== null || item.error?.type === "pipeline_error");
const passed = executed.filter((item) => item.pass === true).length;
const failed = executed.filter((item) => item.pass === false || item.error).length;
const extractionFailures = executed.filter((item) => item.error?.stage === "extraction" || item.error?.type === "extraction_error").length;
const runtimeErrors = executed.filter((item) => item.error && !item.error?.type?.includes("extraction")).length;
const degradedCases = executed.filter((item) => item.degradedOrFallbackMode && typeof item.degradedOrFallbackMode === "object" && item.degradedOrFallbackMode.degraded === true).length;
const latencyValues = executed.map((item) => item.latencyMs).filter((value) => typeof value === "number");
const distribution = {};
for (const item of executed) {
  const status = item.actualDecision || "ERROR";
  distribution[status] = (distribution[status] || 0) + 1;
}

const report = {
  measuredResults: {
    totalCases: results.totalCases,
    executedCases: executed.length,
    blockedCases: results.totalCases - executed.length,
    passed,
    failed,
    accuracy: executed.length === 0 ? null : passed / executed.length,
    extractionFailures,
    pipelineRuntimeErrors: runtimeErrors,
    degradedOrFallbackCases: degradedCases,
    decisionDistribution: distribution,
    averageLatencyMs: latencyValues.length === 0 ? null : latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length,
  },
  projection500: {
    status: "not-meaningful",
    statement: `Based on ${executed.length} measured smoke cases, a 500-case result was not executed. The sample is too small${executed.length === 0 ? " and produced no measurements" : " for a meaningful projection"}.`,
  },
};

console.log(JSON.stringify(report, null, 2));