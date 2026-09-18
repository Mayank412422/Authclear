# End-to-End Authorization Evaluation

## Objective

Evaluate raw clinical inputs through the complete AuthClear authorization path: AI extraction, validation, policy retrieval, decision engine, and authorization response. This evaluation is separate from the deterministic decision-engine benchmark.

## Dataset and Ground Truth

Exactly 500 raw/unstructured clinical inputs were derived from the seeded benchmark with seed `20260916`. Each retains its source benchmark case ID, policy ID, and expected authorization from the repository's existing policy/rule-generated ground truth.

## Complete Pipeline

The evaluator submits each raw clinical note as an image-shaped upload to `processClaim()`. The production pipeline performs Gemini extraction, schema validation, Pinecone policy retrieval, deterministic authorization, Gemini answer generation, and PostgreSQL persistence. No mocks or direct decision-engine calls are used as the primary path.

The five-case real smoke gate runs before the remaining cases. This run stopped at **preflight**. External services reached: none.

## Confusion Matrix

Positive authorization is `APPROVED`; negative authorization is `DENIED`.

| Actual \ Predicted | APPROVED | DENIED |
| --- | ---: | ---: |
| APPROVED | 0 (TP) | 0 (FN) |
| DENIED | 0 (FP) | 0 (TN) |

## Metrics

| Metric | Result |
| --- | ---: |
| Cases prepared | 500 |
| Cases executed | 0 |
| Successfully classified | 0 |
| Blocked/not executed | 500 |
| Accuracy | Not measurable |
| Precision | Not measurable |
| Recall | Not measurable |
| F1-score | Not measurable |

Metrics are calculated only from successfully classified real pipeline outputs. Zero denominators are represented as `null` in `e2eResults.json` and as “Not measurable” here.

## Latency

| Metric | Result |
| --- | ---: |
| Minimum | Not measurable |
| Median | Not measurable |
| Mean | Not measurable |
| P90 | Not measurable |
| P95 | Not measurable |
| Maximum | Not measurable |

## Error Analysis

| Error category | Count |
| --- | ---: |
| configuration | 500 |

No false-positive or false-negative examples exist when no cases are successfully classified. Blocked cases are not counted as failures or classification outcomes.

## Comparison with Deterministic Benchmark

The separate deterministic decision-engine benchmark evaluated 500 structured cases with 100% agreement. That result measures rule-engine consistency only. It is not Gemini accuracy, Pinecone accuracy, or end-to-end authorization accuracy.

## Limitations

All 500 cases were **not** executed through the complete pipeline in this run. Execution was blocked before the five-case real smoke gate because required external credentials were unavailable: `DATABASE_URL`, `GEMINI_API_KEY`, and `PINECONE_API_KEY`. No external API calls were made, and no end-to-end accuracy, confusion-matrix metric, or latency value was fabricated.
