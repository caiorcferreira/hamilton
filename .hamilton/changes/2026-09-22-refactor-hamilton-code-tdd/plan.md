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

## Done when

- All tasks implemented and recorded in `progress.md`
- `bun --bun vitest run` passes; `bun run build` is clean
- All task feedback and whole-branch review feedback has been addressed
