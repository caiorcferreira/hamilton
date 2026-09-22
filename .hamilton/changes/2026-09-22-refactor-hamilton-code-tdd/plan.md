---
artifact: plan
change: 2026-09-22-refactor-hamilton-code-tdd
status: approved
created: 2026-09-22
author: Hermes Agent
decision: accepted
route_unit: null
---

# Plan: Refactor hamilton-code Around a TDD Cycle

## Overview

- Change: `.hamilton/changes/2026-09-22-refactor-hamilton-code-tdd/`
- Goal: Make `hamilton-code` execute an explicit red/green/refactor implementation cycle and make `hamilton-code-feedback` the durable refactor-phase gate, including a justified alternative path for tasks that cannot start with a conventional failing test.
- Test: `bun --bun vitest run`
- Build / typecheck: `bun run build`
- Context notes: Follow `AGENTS.md`, the accepted proposal, design, and requirement deltas. This is a skill, orchestration-prompt, contract-test, and documentation change; do not alter the CLI, artifact formats, task ledger, or runtime implementation. Preserve ESM `.js` imports where code is touched, pinned dependencies, no comments in code, and the existing artifact ownership and commit conventions.
- Quality notes: Tasks follow the design boundaries: implementation discipline, tactical review, orchestration routing, and public documentation are separate units with focused contract tests. No structural smell is intentionally accepted.
- Re-plan amendment (2026-09-22): Whole-branch Review Pass 1 found blocking evidence gaps in completed Tasks 2 and 4: each latest task log collapses Green and behavior-preserving Refactor into a combined verification entry. Tasks 1–4 and all existing task, feedback, and review history remain frozen. Append Tasks 5 and 6 to repair only the affected task-progress evidence, preserve prior feedback and review history, and require fresh Task 2 and Task 4 feedback passes from their unchanged checkpoints before advancement.

## Tasks

### Task 1: Define the implementation TDD cycle

- Depends on: none
- Files:
  - Created: none
  - Modified: `skills/hamilton-code/SKILL.md`, `tests/skills/execution-contracts.test.ts`
  - Deleted: none
- Acceptance:
  - `hamilton-code` explicitly orders every ordinary implementation cycle as red, green, and refactor, requires a failing behavioral check before production edits, requires the smallest passing implementation, and requires behavior-preserving refactoring with relevant tests still passing.
  - The skill states that green is an intermediate milestone, records red/green/refactor commands and observed results in task-local evidence, and preserves the existing plan, verification, checkpoint, root-row, and commit conventions.
  - The skill documents a concrete exception requiring a reason and repeatable alternative verification when a conventional failing test cannot be written, and rejects a preference-based test omission.
  - Contract tests verify the phase order, green-only prohibition, evidence requirement, correction-cycle verification, and exceptional path without weakening existing execution contracts.
- Steps:
  1. Extend `tests/skills/execution-contracts.test.ts` with assertions for the red, green, refactor, evidence, green-only prohibition, correction, and justified alternative-verification contracts; run the focused test and confirm it fails against the current skill text.
  2. Update `skills/hamilton-code/SKILL.md` with the ordered TDD process, exception rules, task-local evidence requirements, correction behavior, examples, and an updated process flow while preserving the existing durable execution rules.
  3. Run the focused execution contract suite and build, then refactor the wording for clarity without changing the required phase order or existing ownership boundaries.
- Verify: `bun --bun vitest run tests/skills/execution-contracts.test.ts && bun run build` → the execution contract tests pass and TypeScript builds cleanly.
- Commit: `docs(code): define TDD implementation cycle`

### Task 2: Make feedback the refactor gate

- Depends on: Task 1
- Files:
  - Created: none
  - Modified: `skills/hamilton-code-feedback/SKILL.md`, `tests/skills/code-feedback-contract.test.ts`
  - Deleted: none
- Acceptance:
  - `hamilton-code-feedback` explicitly receives the implementation's red/green/refactor or exception evidence and judges the behavior-preserving refactor against the task, project standards, and code-quality rubric.
  - The skill states that an approved pass completes the refactor gate, while requested changes remain append-only and return the same task to a new correction cycle; the reviewer never edits implementation or progress artifacts.
  - Feedback-driven corrections require relevant verification after the finding is addressed, and exceptional verification is judged for genuine justification and sufficiency rather than approved automatically.
  - Contract tests verify the refactor-gate role, context inputs, approval/requested-change routing, and exception review while preserving the existing review-only and artifact-only commit contracts.
- Steps:
  1. Add focused assertions to `tests/skills/code-feedback-contract.test.ts` for the refactor-phase role, TDD evidence input, approval and requested-change outcomes, correction verification, and exceptional verification; run the suite and confirm the new assertions fail.
  2. Update `skills/hamilton-code-feedback/SKILL.md` to define the refactor-phase review, required implementation context, and correction/exception handling without changing its bounded inspection or feedback artifact ownership.
  3. Run the focused feedback contract suite and build, then refactor the new guidance for an unambiguous handoff.
- Verify: `bun --bun vitest run tests/skills/code-feedback-contract.test.ts && bun run build` → the feedback contract tests pass and TypeScript builds cleanly.
- Commit: `docs(review): define refactor feedback gate`

### Task 3: Route TDD evidence through orchestration

- Depends on: Tasks 1 and 2
- Files:
  - Created: none
  - Modified: `skills/hamilton-orchestrate/SKILL.md`, `skills/hamilton-orchestrate/references/implementer-prompt.md`, `skills/hamilton-orchestrate/references/code-feedback-prompt.md`, `tests/skills/orchestrate-contract.test.ts`
  - Deleted: none
- Acceptance:
  - Orchestration names the existing code-feedback dispatch as the refactor-phase review and does not advance from a green implementation until a fresh durable approved feedback pass exists.
  - The implementer dispatch requires the task-local report to carry red/green/refactor or exception evidence, and the feedback dispatch supplies that evidence plus the task acceptance, stable diff, project standards, and bounded located-risk context.
  - A requested refactor finding routes the same task back to `hamilton-code`, requires relevant verification after correction, and then obtains fresh feedback; approval is the only advancement path to another task or whole-branch review.
  - Orchestration contract tests verify the ordering and handoff across the actual prompt references without changing the durable resume matrices or making the controller edit stage-owned artifacts.
- Steps:
  1. Extend `tests/skills/orchestrate-contract.test.ts` with independent assertions for the refactor gate, implementer evidence handoff, feedback context, requested-change correction loop, and approved-only advancement; run it and confirm the additions fail.
  2. Update the orchestrator and both dispatch prompts to state the TDD evidence contract and explicit refactor-phase handoff while retaining exact task scope, stable-range, model, artifact-only, and no-next-skill rules.
  3. Run the focused orchestration and related execution/feedback contract suites and build, then refactor duplicated wording so the prompts and driver use one consistent handoff vocabulary.
- Verify: `bun --bun vitest run tests/skills/orchestrate-contract.test.ts tests/skills/execution-contracts.test.ts tests/skills/code-feedback-contract.test.ts && bun run build` → all orchestration, execution, and feedback contracts pass and TypeScript builds cleanly.
- Commit: `docs(orchestrate): route TDD evidence through feedback`

### Task 4: Document the TDD task loop

- Depends on: Task 3
- Files:
  - Created: `tests/docs/tdd-workflow.test.ts`
  - Modified: `docs/skills.md`, `docs/sdd-framework.md`, `docs/modes.md`
  - Deleted: none
- Acceptance:
  - Each affected public document describes `hamilton-code`'s red/green/refactor order, identifies `hamilton-code-feedback` as the refactor-phase gate, and states that green alone does not complete a task.
  - Each affected public document explains that requested feedback returns the same task to a fresh correction cycle with verification before advancement.
  - Each affected public document explains the required justification and repeatable alternative verification for tasks without a conventional failing test.
  - Documentation tests check the contract independently per document so one document cannot satisfy another's requirement through concatenated text.
- Steps:
  1. Create `tests/docs/tdd-workflow.test.ts` with per-document assertions for the phase order, refactor gate, correction loop, green-only prohibition, and exceptional verification; run it and confirm it fails against the current documentation.
  2. Update the three public workflow documents to describe the same TDD and feedback handoff without changing unrelated pipeline or artifact guidance.
  3. Run the documentation suite, full test suite, build, and `git diff --check`, then inspect the rendered Markdown sections for consistent terminology and no stale workflow description.
- Verify: `bun --bun vitest run tests/docs/tdd-workflow.test.ts && bun run build && git diff --check` → documentation assertions pass, TypeScript builds cleanly, and whitespace is valid.
- Commit: `docs: explain TDD task workflow`

### Task 5: Repair Task 2 phase evidence

- Depends on: none
- Files:
  - Created: none
  - Modified: `.hamilton/changes/2026-09-22-refactor-hamilton-code-tdd/tasks/task-2/progress.md`
  - Deleted: none
- Acceptance:
  - Every existing Task 2 attempt and feedback pass remains byte-for-byte unchanged, and exactly one next-numbered attempt is appended at the physical end of `tasks/task-2/progress.md` with separate `Red`, `Green`, and `Refactor` entries in that order; each entry includes the exact command and observed result.
  - The Red entry records the failing evidence-shape check before the correction append, the Green entry records the same shape check passing plus `bun --bun vitest run tests/skills/code-feedback-contract.test.ts` passing, and the Refactor entry records behavior-preserving `bun --bun vitest run tests/skills/code-feedback-contract.test.ts && bun run build && git diff --check` passing without changing production files. The evidence-only nature of this remediation is the concrete reason the structural check, rather than a new production behavior test, supplies Red.
  - The implementation does not edit `tasks/task-2/feedback.md` or any review artifact. Immediately after this correction commit, the driver obtains and commits a fresh `hamilton-code-feedback` pass for Task 2 from its unchanged `tasks/task-2/.base` through the correction head, preserving the prior pass; Task 2's fresh approved pass must precede Task 5 feedback and any advancement to Task 6.
- Steps:
  1. Red — run `bun -e 'const fs = require("node:fs"); const latest = fs.readFileSync(".hamilton/changes/2026-09-22-refactor-hamilton-code-tdd/tasks/task-2/progress.md", "utf8").split(/^## Attempt [^\n]*$/m).at(-1) ?? ""; const phases = [...latest.matchAll(/^### (Red|Green|Refactor)$/gm)].map((match) => match[1]); if (phases.join(",") !== "Red,Green,Refactor") process.exit(1);'` against the physical latest Task 2 attempt and record its expected non-zero result because the reviewed attempt combines Green and Refactor evidence.
  2. Green — append the next-numbered Task 2 attempt at the physical end, preserving all prior bytes; record the Red command and failure, rerun the same evidence-shape check to a zero result, and run `bun --bun vitest run tests/skills/code-feedback-contract.test.ts` to capture its passing result.
  3. Refactor — without changing a production file, run `bun --bun vitest run tests/skills/code-feedback-contract.test.ts && bun run build && git diff --check`, record the passing result as behavior-preserving verification, and inspect the diff to confirm that only the new Task 2 attempt was appended.
  4. Freshness handoff — after committing the progress-only correction, leave `tasks/task-2/feedback.md` untouched, obtain and commit its fresh approved feedback pass from the unchanged checkpoint, then obtain Task 5's own fresh feedback before starting Task 6.
- Verify: `bun -e 'const fs = require("node:fs"); const latest = fs.readFileSync(".hamilton/changes/2026-09-22-refactor-hamilton-code-tdd/tasks/task-2/progress.md", "utf8").split(/^## Attempt [^\n]*$/m).at(-1) ?? ""; const phases = [...latest.matchAll(/^### (Red|Green|Refactor)$/gm)].map((match) => match[1]); if (phases.join(",") !== "Red,Green,Refactor") process.exit(1);' && bun --bun vitest run tests/skills/code-feedback-contract.test.ts && bun run build && git diff --check` → the latest Task 2 attempt contains exactly the distinct ordered phase evidence, the focused feedback contract suite and build pass, and the append is whitespace-clean; the separate fresh Task 2 approval is committed before advancement.
- Commit: `chore(change): repair Task 2 phase evidence`

### Task 6: Repair Task 4 phase evidence

- Depends on: Task 5
- Files:
  - Created: none
  - Modified: `.hamilton/changes/2026-09-22-refactor-hamilton-code-tdd/tasks/task-4/progress.md`
  - Deleted: none
- Acceptance:
  - Every existing Task 4 attempt and feedback pass remains byte-for-byte unchanged, and exactly one next-numbered attempt is appended at the physical end of `tasks/task-4/progress.md` with separate `Red`, `Green`, and `Refactor` entries in that order; each entry includes the exact command and observed result.
  - The Red entry records the failing evidence-shape check before the correction append, the Green entry records the same shape check passing plus `bun --bun vitest run tests/docs/tdd-workflow.test.ts` passing, and the Refactor entry records behavior-preserving `bun --bun vitest run tests/docs && bun run build && git diff --check` passing without changing production files. The evidence-only nature of this remediation is the concrete reason the structural check, rather than a new production behavior test, supplies Red.
  - The implementation does not edit `tasks/task-4/feedback.md` or `review.md`. Immediately after this correction commit, the driver obtains and commits a fresh `hamilton-code-feedback` pass for Task 4 from its unchanged `tasks/task-4/.base` through the correction head, preserving the prior pass; Task 4's fresh approved pass must precede whole-branch review and any advancement to finish-work.
- Steps:
  1. Red — run `bun -e 'const fs = require("node:fs"); const latest = fs.readFileSync(".hamilton/changes/2026-09-22-refactor-hamilton-code-tdd/tasks/task-4/progress.md", "utf8").split(/^## Attempt [^\n]*$/m).at(-1) ?? ""; const phases = [...latest.matchAll(/^### (Red|Green|Refactor)$/gm)].map((match) => match[1]); if (phases.join(",") !== "Red,Green,Refactor") process.exit(1);'` against the physical latest Task 4 attempt and record its expected non-zero result because the reviewed attempt lacks distinct Green and Refactor evidence.
  2. Green — append the next-numbered Task 4 attempt at the physical end, preserving all prior bytes including the existing user-owned progress change; record the Red command and failure, rerun the same evidence-shape check to a zero result, and run `bun --bun vitest run tests/docs/tdd-workflow.test.ts` to capture its passing result.
  3. Refactor — without changing a production file, run `bun --bun vitest run tests/docs && bun run build && git diff --check`, record the passing result as behavior-preserving verification, and inspect the diff to confirm that only the new Task 4 attempt was appended.
  4. Freshness handoff — after committing the progress-only correction, leave `tasks/task-4/feedback.md` and `review.md` untouched, obtain and commit its fresh approved feedback pass from the unchanged checkpoint, then run whole-branch review only after both remediation task gates are current.
- Verify: `bun -e 'const fs = require("node:fs"); const latest = fs.readFileSync(".hamilton/changes/2026-09-22-refactor-hamilton-code-tdd/tasks/task-4/progress.md", "utf8").split(/^## Attempt [^\n]*$/m).at(-1) ?? ""; const phases = [...latest.matchAll(/^### (Red|Green|Refactor)$/gm)].map((match) => match[1]); if (phases.join(",") !== "Red,Green,Refactor") process.exit(1);' && bun --bun vitest run tests/docs && bun run build && git diff --check` → the latest Task 4 attempt contains exactly the distinct ordered phase evidence, the documentation suite and build pass, and the append is whitespace-clean; the separate fresh Task 4 approval is committed before whole-branch review.
- Commit: `chore(change): repair Task 4 phase evidence`

## Done when

- All tasks implemented and recorded in `progress.md`
- `bun --bun vitest run` passes; `bun run build` is clean
- All task feedback and whole-branch review feedback has been addressed
