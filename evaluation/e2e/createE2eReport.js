const fs = require("node:fs");
const path = require("node:path");

const resultsPath = path.join(__dirname, "data", "e2eResults.json");
const reportPath = path.join(__dirname, "e2eAuthorizationReport.md");
const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const summary = results.summary;
const metric = (value) => value === null ? "Not measurable" : `${(value * 100).toFixed(2)}%`;
const latency = (value) => value === null ? "Not measurable" : `${value.toFixed(2)} ms`;
const errors = Object.entries(summary.errorCategories).map(([key, value]) => `| ${key} | ${value} |`).join("\n") || "| None recorded | 0 |";

const report = `# End-to-End Authorization Evaluation

## Objective

Evaluate raw clinical inputs through the complete AuthClear authorization path: AI extraction, validation, policy retrieval, decision engine, and authorization response. This evaluation is separate from the deterministic decision-engine benchmark.

## Dataset and Ground Truth

Exactly 500 raw/unstructured clinical inputs were derived from the seeded benchmark with seed \`20260916\`. Each retains its source benchmark case ID, policy ID, and expected authorization from the repository's existing policy/rule-generated ground truth.

## Complete Pipeline

The evaluator submits each raw clinical note as an image-shaped upload to \`processClaim()\`. The production pipeline performs Gemini extraction, schema validation, Pinecone policy retrieval, deterministic authorization, Gemini answer generation, and PostgreSQL persistence. No mocks or direct decision-engine calls are used as the primary path.

The five-case real smoke gate runs before the remaining cases. This run stopped at **${summary.stoppedAt || "completion"}**. External services reached: ${summary.externalServicesReached.length ? summary.externalServicesReached.join(", ") : "none"}.

## Confusion Matrix

Positive authorization is \`APPROVED\`; negative authorization is \`DENIED\`.

| Actual \\ Predicted | APPROVED | DENIED |
| --- | ---: | ---: |
| APPROVED | ${summary.confusionMatrix.TP} (TP) | ${summary.confusionMatrix.FN} (FN) |
| DENIED | ${summary.confusionMatrix.FP} (FP) | ${summary.confusionMatrix.TN} (TN) |

## Metrics

| Metric | Result |
| --- | ---: |
| Cases prepared | ${summary.casesPrepared} |
| Cases executed | ${summary.casesExecuted} |
| Successfully classified | ${summary.casesSuccessfullyClassified} |
| Blocked/not executed | ${summary.casesBlockedOrNotExecuted} |
| Accuracy | ${metric(summary.metrics.accuracy)} |
| Precision | ${metric(summary.metrics.precision)} |
| Recall | ${metric(summary.metrics.recall)} |
| F1-score | ${metric(summary.metrics.f1)} |

Metrics are calculated only from successfully classified real pipeline outputs. Zero denominators are represented as \`null\` in \`e2eResults.json\` and as “Not measurable” here.

## Latency

| Metric | Result |
| --- | ---: |
| Minimum | ${latency(summary.latencyMs.minimum)} |
| Median | ${latency(summary.latencyMs.median)} |
| Mean | ${latency(summary.latencyMs.mean)} |
| P90 | ${latency(summary.latencyMs.p90)} |
| P95 | ${latency(summary.latencyMs.p95)} |
| Maximum | ${latency(summary.latencyMs.maximum)} |

## Error Analysis

| Error category | Count |
| --- | ---: |
${errors}

No false-positive or false-negative examples exist when no cases are successfully classified. Blocked cases are not counted as failures or classification outcomes.

## Comparison with Deterministic Benchmark

The separate deterministic decision-engine benchmark evaluated 500 structured cases with 100% agreement. That result measures rule-engine consistency only. It is not Gemini accuracy, Pinecone accuracy, or end-to-end authorization accuracy.

## Limitations

All 500 cases were **not** executed through the complete pipeline in this run. Execution was blocked before the five-case real smoke gate because required external credentials were unavailable: \`DATABASE_URL\`, \`GEMINI_API_KEY\`, and \`PINECONE_API_KEY\`. No external API calls were made, and no end-to-end accuracy, confusion-matrix metric, or latency value was fabricated.
`;

fs.writeFileSync(reportPath, report);
console.log(`Wrote ${reportPath}`);