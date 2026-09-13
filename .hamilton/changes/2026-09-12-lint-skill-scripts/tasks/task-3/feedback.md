---
artifact: feedback
change: 2026-09-12-lint-skill-scripts
task: 3
created: 2026-09-12
status: open
verdict: changes-requested
decision: rejected
base: b76aa669fdf0173074940d9c83cfc5a8926bf11d
head: 3c9b2224aacc91d24bc9eb6471593e7794b185d0
---

# Code Feedback: Task 3 — Validate artifact bodies and workflow records

## Pass 1 — 2026-09-12

### Blocking

- [src/workbench/artifact-contracts.ts:890] The `progress` body contract declares no workflow records, so a plan/task progress ledger is accepted with missing or malformed ledger rows and exposes an empty `workflow.records` array. Add contract-specific ledger extraction with location-bearing validation (including numbering where required) and cover valid and malformed ledger rows in tests (violates: Task 3 acceptance for plan/task ledgers to expose structured workflow data and for malformed/non-monotonic records to fail closed).
- [src/workbench/artifact-contracts.ts:1003] The append-only record expression accepts arbitrary trailing text after a valid date because it ends with `(?:$| )`; for example, `Pass 1 — 2026-09-12 garbage` is parsed as valid and produces no diagnostic. Anchor the declared record grammar (or explicitly validate an allowed suffix) and add a regression test with a location-bearing `invalid-record` diagnostic (violates: Task 3 acceptance that malformed records produce diagnostics).

### Suggestions

- None.
