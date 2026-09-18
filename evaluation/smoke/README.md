# AuthClear Smoke Evaluation

## What was tested

Six representative cases were prepared from policies in `backend/data/policies.json`: an approved BPH request, procedure mismatch, diagnosis mismatch, age below minimum, age above maximum, and an intentionally invalid/degraded extraction input. Each expected status is calculated with the repository's `evaluateClaim` function and its current policy rule order.

The runner invokes `backend/services/pipeline.js` directly. This is the production pipeline path after upload handling and includes Gemini extraction, Pinecone retrieval, deterministic decisioning, Gemini answer generation, and PostgreSQL persistence. No mocks are used.

The current policy catalog has no positive `minDurationMonths`, so no duration-denial smoke case can be derived from the bundled rules. The existing benchmark records the same limitation.

## Command and execution

From the repository root:

```bash
node evaluation/smoke/smokeTest.js
node evaluation/smoke/analyzeSmoke.js
```

The exact smoke command run for this evaluation was `node evaluation/smoke/smokeTest.js`. Results are written to `evaluation/smoke/smokeResults.json`.

## External services reached

No external service was reached when configuration was missing. The runner checks configuration before loading the production pipeline and records every case as not executed in that situation. When configured, the pipeline reaches Gemini extraction/generation, Pinecone embeddings/retrieval, and PostgreSQL persistence; it does not replace failures with mocks.

## Results

The measured result is the contents of `smokeResults.json`, and the aggregate analysis is produced by `node evaluation/smoke/analyzeSmoke.js`. `totalCases` means prepared cases; `executedCases` means cases that actually entered `processClaim`. Blocked cases are not counted as passes or failures, and accuracy is `null` when no cases executed.

Current measured summary: **6 cases prepared, 0 executed, 6 blocked, 0 passed, 0 failed, accuracy not measurable**. There were 0 extraction failures, 0 pipeline/runtime errors, 0 degraded/fallback executions, and no measurable latency because the pipeline was not entered.

## Failures and limitations

This Codespace had no `DATABASE_URL`, `GEMINI_API_KEY`, or `PINECONE_API_KEY` in the environment at evaluation time. Therefore the real pipeline could not be invoked. The smoke inputs are text rendered into SVG buffers only to provide upload-shaped inputs; they are not claims that Gemini successfully extracted.

The six-case sample is a smoke check, not a statistically meaningful benchmark. Retrieval may select a different policy for ambiguous requests, and those outcomes are recorded as actual results rather than rewritten to match expected fixtures.

## 500-case projection

No 500-case execution was performed. Any 500-case section is explicitly a projection/estimate based only on the measured smoke cases. With zero measured executions, this report intentionally marks the projection as **not meaningful** rather than fabricating projected counts or accuracy.