---
artifact: task-progress
change: 2026-09-12-lint-skill-scripts
task: 13
status: pending
updated: 2026-09-12
decision: accepted
---

# Task Progress: Task 13 — Migrate skills to workbench commands

## Attempt 1 — 2026-09-12

- Outcome: done
- Created:
  - `tests/skills/workbench-contract.test.ts`
- Modified:
  - `.hamilton/changes/2026-09-12-lint-skill-scripts/progress.md`
  - `skills/hamilton-propose/SKILL.md`
  - `skills/hamilton-plan/SKILL.md`
  - `skills/hamilton-code/SKILL.md`
  - `skills/hamilton-orchestrate/SKILL.md`
  - `skills/hamilton-critique/SKILL.md`
  - `skills/hamilton-finish-work/SKILL.md`
  - `skills/hamilton-wayfinder-prototype/SKILL.md`
  - `tests/skills/finish-work-contract.test.ts`
  - `tests/skills/orchestrate-contract.test.ts`
- Deleted: none
- Verification:
  - `bun --bun vitest run tests/skills/finish-work-contract.test.ts tests/skills/orchestrate-contract.test.ts tests/skills/workbench-contract.test.ts` — passed (48 tests)
  - `bun run build` — passed
  - `bun run test` — passed (25 files, 682 tests)
  - `bun run build` — passed
  - `rg -n '~/.hamilton/scripts/|hamilton-(artifact-contracts|change-context|diff-package|isolate|precondition-check|prototype-branch)\\.sh' skills/hamilton-*/SKILL.md` — passed (no matches)
  - `git diff --check` — passed
- Notes:
  - Replaced every maintained Hamilton helper call with its matching `hamilton workbench` command while preserving skill-owned sequencing, judgment, fail-closed behavior, evidence handling, and migration boundaries.
