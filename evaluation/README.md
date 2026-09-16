# AuthClear Synthetic End-to-End Evaluation Benchmark

This benchmark is generated from the existing policy catalog in `backend/data/policies.json` using a fixed random seed (`20260916`) to keep output reproducible. Run `node evaluation/generateBenchmark.js` from the repository root to regenerate `evaluation/data/benchmark.json`.

Each benchmark case includes `caseId`, `extractedData`, policy data (`id`, `procedure`, `allowedDiagnoses`, `minDurationMonths`, `ageMin`, `ageMax`, `policyClause`, `source`), `expectedStatus`, and `expectedReason`.

`expectedStatus` and `expectedReason` are calculated by calling the existing deterministic rules in `backend/services/decisionEngine.js` (`evaluateClaim`) with the selected policy and extracted claim data. Outcomes are therefore derived strictly from rule order and logic in that file: procedure matching first, diagnosis matching second, minimum duration check third, and age-range check fourth.

The generator produces exactly 500 cases with approved and denied examples including procedure mismatch, diagnosis mismatch, age below minimum, age above maximum, and boundary-age approvals (`age == ageMin` and `age == ageMax`). Duration denials are generated only if source policies have `minDurationMonths > 0`; with the current bundled policy catalog, all policies use `minDurationMonths = 0`, so no duration-denial cases are added.
