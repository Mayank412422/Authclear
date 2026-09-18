const fs = require("node:fs");
const path = require("node:path");

const benchmarkPath = path.join(__dirname, "..", "data", "benchmark.json");
const outputPath = path.join(__dirname, "data", "e2eCases.json");
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));

function rawClinicalInput(benchmarkCase) {
  const claim = benchmarkCase.extractedData;
  return [
    `Patient identifier: ${claim.patientId}.`,
    `The clinical note documents ${claim.diagnosis.toLowerCase()}.`,
    `The requested service is ${claim.requestedProcedure}.`,
    `Symptoms have been present for approximately ${claim.symptomDuration} months.`,
    `Patient age is ${claim.age} years.`,
  ].join(" ");
}

if (benchmark.generationSeed !== 20260916 || benchmark.cases.length !== 500) {
  throw new Error("The seeded source benchmark must contain exactly 500 cases.");
}

const cases = benchmark.cases.map((benchmarkCase) => ({
  caseId: `E2E-${benchmarkCase.caseId}`,
  sourceBenchmarkCaseId: benchmarkCase.caseId,
  category: benchmarkCase.category,
  rawClinicalInput: rawClinicalInput(benchmarkCase),
  policyId: benchmarkCase.policy.id,
  expectedAuthorization: benchmarkCase.expectedStatus,
}));

fs.writeFileSync(outputPath, `${JSON.stringify({
  evaluationName: "authclear-500-case-end-to-end-authorization",
  sourceBenchmark: "evaluation/data/benchmark.json",
  generationSeed: benchmark.generationSeed,
  totalCases: cases.length,
  cases,
}, null, 2)}\n`);

console.log(`Generated ${cases.length} end-to-end raw clinical inputs at ${outputPath}`);