# Task Progress: Task 6 — Enforce task ledger completion in the finish gate

## Attempt 1 — 2026-09-04

- Outcome: done
- Changed:
  - Created: none
  - Modified: `bundle/scripts/hamilton-precondition-check.sh`, `tests/scripts/precondition-check.test.ts`, `.hamilton/changes/2026-09-04-split-hamilton-review/progress.md`, `.hamilton/changes/2026-09-04-split-hamilton-review/tasks/task-6/progress.md`
  - Deleted: none
- Verified:
  - `bun --bun vitest run tests/scripts/precondition-check.test.ts` → 27 tests passed
  - `bun run test` → 199 tests passed
  - `bun run build` → passed
- Notes: Replaced legacy root-history folding with strict split-ledger validation, preserved abandoned task history and existing clean-tree and verification-command behavior, and rejected planned legacy progress layouts.
