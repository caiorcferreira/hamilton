---
artifact: task-progress
change: 2026-09-25-replace-effect-cli-with-nestjs
task: 12
status: done
updated: 2026-09-25
decision: accepted
---
# Task Progress: Task 12 — Register isolate subcommand

## Attempt 1 — 2026-09-25

- Outcome: done

Created: src/cli/nest/isolate.command.ts, tests/cli/isolate-command.test.ts
Modified: src/cli/nest/workbench.command.ts, src/cli/nest/workbench.module.ts
Deleted: none
Verification:
  - `bun --bun vitest run tests/cli/isolate-command.test.ts` before registration — expected red; 4 tests failed because `isolate.command.js` did not yet exist.
  - Intermediate focused runs exposed and fixed two test-harness issues: the Nest help executable name and capturing output from the real `ResultReporter` sinks.
  - `bun --bun vitest run tests/cli/isolate-command.test.ts` — passed, 6 tests.
  - `bun --bun vitest run tests/cli/isolate-command.test.ts && bun --bun vitest run && bun run build` — passed; 33 test files, 500 tests, TypeScript build successful.
  - `git diff --check` — passed.
Notes: The Nest adapter validates invalid mode combinations before its single service-execution path. The command contains no Git orchestration. No scope deviations.
