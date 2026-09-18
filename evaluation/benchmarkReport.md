# AuthClear 500-Case Deterministic Benchmark

## Methodology

Exactly 500 synthetic cases were generated from the repository policy catalog using seed `20260916` by `evaluation/generateBenchmark.js`. Each generated structured claim and its corresponding policy were evaluated with the repository's actual `evaluateClaim()` function from `backend/services/decisionEngine.js`. Expected outcomes came from the generated benchmark, and actual outcomes were computed by calling that production function for every case.

This benchmark made no Gemini, Pinecone, OCR, or PostgreSQL calls. It is a deterministic decision-engine benchmark, not an AI or end-to-end benchmark.

## Results

| Metric | Result |
| --- | ---: |
| Total | 500 |
| Passed | 500 |
| Failed | 0 |
| Accuracy | 100.00% |
| Approved | 213 |
| Denied | 287 |
| Failure rate | 0.00% |

## Rule-wise Results

| Rule/category | Cases |
| --- | ---: |
| age_rule | 150 |
| approved | 213 |
| diagnosis_mismatch | 90 |
| duration_below_min | 0 |
| other | 0 |
| procedure_mismatch | 47 |

The generator contains 90 `procedure_mismatch` category cases, while 47 actually triggered the decision engine's procedure-mismatch branch. The remaining 43 passed the engine's phrase-overlap procedure matching and therefore appear under `approved` in the actual rule results. This reflects production behavior and is not a rewritten expected result.

## Category Results

| Generator category | Cases |
| --- | ---: |
| age_above_max | 75 |
| age_below_min | 75 |
| approved | 150 |
| boundary_age_max | 10 |
| boundary_age_min | 10 |
| diagnosis_mismatch | 90 |
| procedure_mismatch | 90 |

## Important Limitation

This is a deterministic decision-engine benchmark. It does not measure Gemini extraction accuracy, Pinecone retrieval accuracy, OCR accuracy, or full end-to-end production performance.

The real end-to-end smoke test remains blocked because `DATABASE_URL`, `GEMINI_API_KEY`, and `PINECONE_API_KEY` were unavailable in the Codespace. The six smoke cases were not counted in this 500-case deterministic benchmark.

The current policy catalog contains no positive `minDurationMonths` values, so the generator produced no duration-denial cases.
