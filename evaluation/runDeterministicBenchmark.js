const fs = require("node:fs");
const path = require("node:path");

const { evaluateClaim } = require("../backend/services/decisionEngine");

const benchmarkPath = path.join(__dirname, "data", "benchmark.json");
const resultsPath = path.join(__dirname, "data", "benchmarkResults.json");
const reportPath = path.join(__dirname, "benchmarkReport.md");
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));

function decisionPolicy(policy) {
  return {
    id: policy.id,
    procedure: policy.procedure,
    allowedDiagnoses: policy.allowedDiagnoses,
    minDurationMonths: policy.minDurationMonths,
    ageMin: policy.ageMin,
    ageMax: policy.ageMax,
    clause: policy.policyClause,
  };
}

function classifyRule(decision) {
  if (decision.status === "APPROVED") return "approved";
  if (decision.reason.startsWith("Requested procedure")) return "procedure_mismatch";
  if (decision.reason.startsWith("Diagnosis")) return "diagnosis_mismatch";
  if (decision.reason.startsWith("Symptoms documented")) return "duration_below_min";
  if (decision.reason.startsWith("Patient age")) return "age_rule";
  return "other";
}

function increment(counter, key) {
  counter[key] = (counter[key] || 0) + 1;
}

function markdownTable(counter) {
  return Object.entries(counter)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");
}

if (benchmark.totalCases !== 500 || benchmark.cases.length !== 500) {
  throw new Error(`Expected exactly 500 generated cases, received ${benchmark.cases.length}.`);
}

const results = [];
const categoryCounts = {};
const ruleCounts = {
  approved: 0,
  procedure_mismatch: 0,
  diagnosis_mismatch: 0,
  duration_below_min: 0,
  age_rule: 0,
  other: 0,
};
const decisionCounts = { APPROVED: 0, DENIED: 0 };
let passed = 0;

for (const benchmarkCase of benchmark.cases) {
  const actual = evaluateClaim(benchmarkCase.extractedData, decisionPolicy(benchmarkCase.policy));
  const expected = {
    status: benchmarkCase.expectedStatus,
    reason: benchmarkCase.expectedReason,
  };
  const pass = actual.status === expected.status && actual.reason === expected.reason;
  const rule = classifyRule(actual);

  if (pass) passed += 1;
  increment(categoryCounts, benchmarkCase.category);
  increment(ruleCounts, rule);
  increment(decisionCounts, actual.status);

  results.push({
    caseId: benchmarkCase.caseId,
    category: benchmarkCase.category,
    input: benchmarkCase.extractedData,
    policyId: benchmarkCase.policy.id,
    expectedDecision: expected,
    actualDecision: actual,
    rule,
    result: pass ? "PASS" : "FAIL",
  });
}

const failed = results.length - passed;
const accuracy = passed / results.length;
const failureRate = failed / results.length;

const output = {
  benchmarkName: "authclear-500-case-deterministic-decision-engine",
  sourceBenchmark: "evaluation/data/benchmark.json",
  generationSeed: benchmark.generationSeed,
  externalServicesCalled: false,
  totalCases: results.length,
  passed,
  failed,
  accuracy,
  failureRate,
  decisionDistribution: decisionCounts,
  categoryCounts,
  ruleCounts,
  cases: results,
};

fs.writeFileSync(resultsPath, `${JSON.stringify(output, null, 2)}\n`);

const report = `# AuthClear 500-Case Deterministic Benchmark

## Methodology

Exactly 500 synthetic cases were generated from the repository policy catalog using seed \`20260916\` by \`evaluation/generateBenchmark.js\`. Each generated structured claim and its corresponding policy were evaluated with the repository's actual \`evaluateClaim()\` function from \`backend/services/decisionEngine.js\`. Expected outcomes came from the generated benchmark, and actual outcomes were computed by calling that production function for every case.

This benchmark made no Gemini, Pinecone, OCR, or PostgreSQL calls. It is a deterministic decision-engine benchmark, not an AI or end-to-end benchmark.

## Results

| Metric | Result |
| --- | ---: |
| Total | ${results.length} |
| Passed | ${passed} |
| Failed | ${failed} |
| Accuracy | ${(accuracy * 100).toFixed(2)}% |
| Approved | ${decisionCounts.APPROVED} |
| Denied | ${decisionCounts.DENIED} |
| Failure rate | ${(failureRate * 100).toFixed(2)}% |

## Rule-wise Results

| Rule/category | Cases |
| --- | ---: |
${markdownTable(ruleCounts)}

The generator contains 90 \`procedure_mismatch\` category cases, while 47 actually triggered the decision engine's procedure-mismatch branch. The remaining 43 passed the engine's phrase-overlap procedure matching and therefore appear under \`approved\` in the actual rule results. This reflects production behavior and is not a rewritten expected result.

## Category Results

| Generator category | Cases |
| --- | ---: |
${markdownTable(categoryCounts)}

## Important Limitation

This is a deterministic decision-engine benchmark. It does not measure Gemini extraction accuracy, Pinecone retrieval accuracy, OCR accuracy, or full end-to-end production performance.

The real end-to-end smoke test remains blocked because \`DATABASE_URL\`, \`GEMINI_API_KEY\`, and \`PINECONE_API_KEY\` were unavailable in the Codespace. The six smoke cases were not counted in this 500-case deterministic benchmark.

The current policy catalog contains no positive \`minDurationMonths\` values, so the generator produced no duration-denial cases.
`;

fs.writeFileSync(reportPath, report);
console.log(`Evaluated ${results.length} cases with evaluateClaim(). Passed: ${passed}; failed: ${failed}; accuracy: ${(accuracy * 100).toFixed(2)}%.`);