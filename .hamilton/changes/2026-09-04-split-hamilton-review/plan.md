# Plan: Separate task execution and feedback from whole-branch review

## Overview

- Change: `.hamilton/changes/2026-09-04-split-hamilton-review/`
- Goal: Split task code feedback from whole-branch review and reorganize execution state so root `progress.md` is the authoritative task index, detailed task progress and feedback live under `tasks/task-N/`, and finish history has its own durable artifact.
- Test: `bun --bun vitest run`
- Build / typecheck: `bun run build`
- Context notes: Follow `proposal.md`, `design.md`, and all four files under `requirements/`. Before recording Task 1's checkpoint, commit the currently untracked approved proposal, requirements, design, this plan, root progress index, and initialized task progress files as a planning-scaffold commit so no task diff absorbs upstream artifacts. Baseline verification after `bun install` found one existing GNU/Linux portability failure in `tests/scripts/change-context.test.ts` (`--all` orders `older-change` first because failed `stat -f` output contaminates the timestamp); Task 1 fixes that helper before any later task, while the other 97 tests pass and `bun run build` succeeds. Do not edit `.hamilton/specs/` during implementation; `hamilton-finish-work` distills the deltas into canonical specs after the final gate. Do not modify historical `.hamilton/changes/` or `.hamilton/maps/` artifacts. Delete only the explicitly listed legacy `.hamilton/templates/` mirror. Do not add comments to TypeScript, tests, or shell code; the instructional HTML blocks required inside artifact templates are template content, not source-code commentary. Every feedback and whole-branch review artifact must be committed alone before the driver advances. Run the task Verify command, then the full suite and build required by `hamilton-code` before each implementation commit.
- Quality notes: Fourteen tasks follow one responsibility per executable helper, artifact family, or skill contract. Same-file evolutions are ordered: change-context ledger parsing precedes freshness reporting, and precondition task validation precedes review validation. The task-local checkpoint, progress, feedback, and review seams are covered through real temporary git repositories; prose-only skill contracts use narrow structural tests rather than snapshots. Documentation remains a final presentation task. No structural smell is accepted.

## Tasks

### Task 1: Parse split change context

- Depends on: none
- Files:
  - Created: none
  - Modified:
    - `bundle/scripts/hamilton-change-context.sh`
    - `tests/scripts/change-context.test.ts`
  - Deleted: none
- Acceptance:
  - The helper parses the root Task/Status/Progress table, preserves plan order, validates exact active task identities, the four statuses, Markdown-escaped titles, links, matching task-progress headings, and latest task outcome evidence without folding full attempt history (requirements/execution.md — Root progress and finish-gate structure requirements).
  - A directory without `plan.md` reports `pre-plan`; a planned monolithic or missing-scaffold directory reports `legacy-unsupported` without inferred task or review status; `--all` continues across both generations (requirements/execution.md — Legacy formats are inventoried but never interpreted).
  - Missing, duplicate, extra, reordered, wrong-link, wrong-task, illegal-status, and done-without-done-evidence cases are reported rather than guessed.
  - `--all` derives sortable modification epochs portably on GNU/Linux and BSD/macOS, so a failed stat dialect cannot leak diagnostic output into the timestamp or reverse chronological ordering.
- Steps:
  1. Replace the task-context fixtures with root index and task-progress files and add failing pre-plan, legacy, escaped-title, structural-drift, and `--all` cases.
  2. Replace append-only root-progress folding with table and task-file validation, add explicit generation classification, make modification-time probing capture only the successful platform dialect, and keep route and capability inventory behavior intact.
  3. Run the focused context tests and inspect representative single-change and `--all` output.
- Verify: `bun --bun vitest run tests/scripts/change-context.test.ts` → ledger parsing, generation classification, and inventory tests pass.
- Commit: `feat(scripts): read split task progress in change context`

### Task 2: Ship split pipeline artifact templates

- Depends on: none
- Files:
  - Created:
    - `bundle/templates/task-progress.md`
    - `bundle/templates/feedback.md`
    - `bundle/templates/finish.md`
    - `tests/templates/artifact-contracts.test.ts`
  - Modified:
    - `bundle/templates/progress.md`
    - `bundle/templates/review.md`
    - `bundle/templates/plan.md`
    - `bundle/templates/design.md`
    - `bundle/templates/README.md`
    - `tests/cli/setup.test.ts`
  - Deleted: none
- Acceptance:
  - `progress.md` is a root-only Task/Status/Progress table whose statuses are exactly `pending`, `in-progress`, `blocked`, and `done`, and whose links target `tasks/task-N/progress.md` (requirements/artifact-templates.md — Progress template represents the root task index only).
  - `task-progress.md` identifies `Task N` and carries append-only `done | blocked` attempts; `feedback.md` identifies the same task and carries `Base:`, `Head:`, verdict, Blocking, and Suggestions; `review.md` is whole-branch-only with `Base:` and `Head:`; `finish.md` carries paired monotonic Attempt/Outcome sections (requirements/artifact-templates.md — task progress, task feedback, review, and finish requirements).
  - `hamilton setup` installs and reports `task-progress.md`, `feedback.md`, and `finish.md`, and the catalog and plan/design hints describe the split owners without a root-progress stage timeline.
- Steps:
  1. Add failing template-contract assertions and extend setup's expected template set for every new filename and required shape marker.
  2. Rewrite `progress.md` and `review.md`, add the three new templates, and update the plan, design, and catalog templates to reference the split artifacts and seven-stage consumers without changing unrelated template behavior.
  3. Run the focused template and setup tests and fix only violations of the approved template contract.
- Verify: `bun --bun vitest run tests/templates/artifact-contracts.test.ts tests/cli/setup.test.ts` → all template-shape and installation tests pass.
- Commit: `feat(templates): split task and change execution artifacts`

### Task 3: Remove the legacy project-local template mirror

- Depends on: Task 2
- Files:
  - Created: none
  - Modified:
    - `tests/templates/artifact-contracts.test.ts`
  - Deleted:
    - `.hamilton/templates/README.md`
    - `.hamilton/templates/design.md`
    - `.hamilton/templates/plan.md`
    - `.hamilton/templates/progress.md`
    - `.hamilton/templates/proposal.md`
    - `.hamilton/templates/requirements-change.md`
    - `.hamilton/templates/requirements-spec.md`
    - `.hamilton/templates/review.md`
- Acceptance:
  - No tracked path remains under `.hamilton/templates/`, while `bundle/templates/` remains the sole repository source and setup still installs to `~/.hamilton/templates/` (requirements/artifact-templates.md — The bundle is the only repository template source).
  - No file under `.hamilton/changes/`, `.hamilton/specs/`, or `.hamilton/maps/` is deleted by this task.
- Steps:
  1. Extend the template contract test so it fails while any tracked project-local template mirror exists and verifies that bundle sources remain present.
  2. Delete exactly the eight listed legacy files and no project history or canonical specification.
  3. Run the contract test and inspect the staged deletion list for scope.
- Verify: `bun --bun vitest run tests/templates/artifact-contracts.test.ts && test -z "$(git ls-files '.hamilton/templates/**')"` → the contract passes and the tracked mirror is empty.
- Commit: `chore(templates): remove legacy project-local mirror`

### Task 4: Scope diff checkpoints to individual tasks

- Depends on: none
- Files:
  - Created: none
  - Modified:
    - `bundle/scripts/hamilton-diff-package.sh`
    - `tests/scripts/diff-package.test.ts`
  - Deleted: none
- Acceptance:
  - Task record and package modes accept an exact positive task number, validate that it names an active `Task N`, and use ignored `tasks/task-N/.base` instead of the shared change-level checkpoint (requirements/execution.md — Each task owns one stable diff checkpoint).
  - Recording is idempotent and never overwrites an existing task checkpoint; a correction after A..B is packaged as A..C, and starting Task 3 never changes Task 2's checkpoint.
  - Missing, empty, malformed, off-history, or same-as-HEAD checkpoints fail without `HEAD~1`; explicit-base and whole-change modes retain their valid existing behavior.
- Steps:
  1. Rewrite the script tests first for task-number validation, per-task ignore paths, record-once behavior, correction ranges, task isolation, and failure cases while retaining explicit-base and whole-change coverage.
  2. Change record and package modes to resolve `tasks/task-N/.base`, validate active plan membership and commit ancestry, and preserve the checkpoint once created.
  3. Run the focused script tests and inspect the emitted package range and ignore entries.
- Verify: `bun --bun vitest run tests/scripts/diff-package.test.ts` → every task-local and whole-change range case passes.
- Commit: `feat(scripts): scope diff checkpoints per task`

### Task 5: Report split review freshness

- Depends on: Task 4, Task 1
- Files:
  - Created: none
  - Modified:
    - `bundle/scripts/hamilton-change-context.sh`
    - `tests/scripts/change-context.test.ts`
  - Deleted: none
- Acceptance:
  - Context reports each active task's physical latest feedback verdict and fresh/stale/malformed standing from the declared task identity and valid Base/Head range, never falling back past a malformed last pass.
  - Context reports the physical latest whole-branch verdict and freshness against the latest material change commit, excluding only this change's operational progress, feedback, review, and finish paths, and inventories `finish.md` separately.
  - Unrelated later task commits do not stale earlier task feedback, while a later commit touching that task's progress does; proposal, requirement, design, plan, spec, map, skill, template, script, test, and documentation changes remain material to whole-branch freshness.
- Steps:
  1. Add failing nested-feedback and root-review fixtures for valid, stale, malformed, wrong-task, physically-last-pass, unrelated-sibling, material-change, and finish-presence cases.
  2. Add narrow pass parsers and git ancestry checks to the context helper, retaining the ledger as the implementation-state source and opening only the latest task evidence needed for the summary.
  3. Run the focused tests and compare the output matrix for absent, stale, changes-requested, and approved states.
- Verify: `bun --bun vitest run tests/scripts/change-context.test.ts` → all split feedback and whole-review context cases pass.
- Commit: `feat(scripts): report feedback and review freshness`

### Task 6: Enforce task ledger completion in the finish gate

- Depends on: Task 2, Task 1
- Files:
  - Created: none
  - Modified:
    - `bundle/scripts/hamilton-precondition-check.sh`
    - `tests/scripts/precondition-check.test.ts`
  - Deleted: none
- Acceptance:
  - The task gate requires root progress to match active `plan.md` tasks exactly once and in order, validates the four statuses and exact links, requires matching task-progress headings and physical latest `Outcome: done`, and skips abandoned plan tasks while retaining their history (requirements/execution.md — Finish gates validate the task ledger structurally).
  - Every missing, duplicate, extra, reordered, invalid-status, wrong-link, missing-file, wrong-task, pending, in-progress, blocked, and inconsistent-done case fails closed and names the affected task.
  - The existing clean-tree and configured verification-command gates keep their behavior, and a planned legacy layout fails rather than being interpreted.
- Steps:
  1. Replace the task-gate fixtures with the split ledger and add one failing test per structural and status edge case while retaining clean-tree and verification-command coverage.
  2. Replace root history folding with exact plan/table/task-file validation and explicit legacy rejection without changing unrelated command-line options.
  3. Run the full precondition test file and inspect its per-gate messages and final `gate: open | closed` line.
- Verify: `bun --bun vitest run tests/scripts/precondition-check.test.ts` → all task-ledger and retained precondition cases pass.
- Commit: `feat(scripts): gate finish on the task progress ledger`

### Task 7: Enforce split review gates

- Depends on: Task 4, Task 5, Task 6
- Files:
  - Created: none
  - Modified:
    - `bundle/scripts/hamilton-precondition-check.sh`
    - `tests/scripts/precondition-check.test.ts`
    - `tests/scripts/helpers.ts`
  - Deleted: none
- Acceptance:
  - Every active task requires a physically last, correctly identified, well-formed `approved` feedback pass with no blocking or `cannot verify from diff` item and a valid current-branch Base/Head range containing that task's latest progress commit (requirements/review.md — task verdict and freshness requirements).
  - Root review requires a physically last, well-formed `approved` pass with no blocking findings and a valid range containing the latest material change commit; malformed last passes never fall back, and material calculation excludes only operational bookkeeping paths.
  - The existing explicit waiver bypasses only the final material-change ancestry comparison; malformed/off-branch ranges, task feedback freshness, verdicts, ledger state, clean tree, and configured verification remain non-waivable.
- Steps:
  1. Add or factor only the test helper needed to create selective git commits, then replace mixed-review fixtures with nested feedback and commit-bound root review fixtures.
  2. Add failing cases for wrong-task identity, missing/malformed physical last pass, inverted or unreachable ranges, stale task feedback, sibling commits, unresolved `cannot verify from diff`, contradictory approval, material and bookkeeping changes, missing review, and waiver boundaries.
  3. Rewrite the review and freshness gates to parse each owner artifact directly and validate git ancestry against the current branch.
  4. Run the focused gate tests and verify that every unknown or contradictory state fails closed.
- Verify: `bun --bun vitest run tests/scripts/precondition-check.test.ts` → every task-feedback, whole-review, freshness, and waiver case passes.
- Commit: `feat(scripts): gate finish on fresh split reviews`

### Task 8: Implement the task-local execution lifecycle in skills

- Depends on: Task 2, Task 4, Task 1, Task 6
- Files:
  - Created:
    - `tests/skills/helpers.ts`
    - `tests/skills/execution-contracts.test.ts`
  - Modified:
    - `skills/hamilton-plan/SKILL.md`
    - `skills/hamilton-code/SKILL.md`
  - Deleted: none
- Acceptance:
  - Planning writes `plan.md`, initializes root progress and one task progress file per active task, escapes display titles, and reconciles re-plan additions, renames, frozen done tasks, and abandoned history without renumbering (requirements/execution.md — planning and re-plan requirements).
  - Code requires one exact active `Task N`, moves only its row through `in-progress` to `done | blocked`, appends only its task log, commits successful evidence with code, and persists a graceful blocker in an artifact-only commit without committing partial production edits (requirements/execution.md — code status transitions).
  - Both skills reject unsupported planned legacy layouts, use task-local checkpoints and evidence, never write review/finish summaries into progress, and preserve sibling isolation.
- Steps:
  1. Add a small skill-test helper and failing structural tests for the stable paths, status vocabulary, initialization, re-plan, inline-id, blocker, sibling, and legacy boundaries.
  2. Rewrite the plan skill's output and re-plan contract around the root index and initialized task logs.
  3. Rewrite the code skill's inputs, process, output, progress format, commit behavior, and handoff around one row and one task directory.
  4. Run the focused contract tests and read both skills end to end for contradictory old progress language.
- Verify: `bun --bun vitest run tests/skills/execution-contracts.test.ts` → plan and code contract tests pass.
- Commit: `feat(skills): split task execution progress`

### Task 9: Add the task-scoped code-feedback skill

- Depends on: Task 2, Task 4, Task 8
- Files:
  - Created:
    - `skills/hamilton-code-feedback/SKILL.md`
    - `skills/hamilton-code-feedback/references/code-quality.md`
    - `tests/skills/code-feedback-contract.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - The self-contained step-4 skill accepts exactly one `Task N`, its stable diff package, task-local progress, binding constraints, and standards; whole-branch input stops and redirects to `hamilton-review` (requirements/review.md — Task-scoped code feedback is a distinct pipeline step).
  - Inspection remains bounded to the task diff except one concrete named risk, and every unresolved `cannot verify from diff` item is blocking `changes-requested` until located evidence or code resolves it.
  - Each physical last pass records matching task identity, full Base/Head, verdict, Blocking, and Suggestions in `tasks/task-N/feedback.md`, commits only that artifact before handoff, and never changes progress.
- Steps:
  1. Write failing contract tests for frontmatter, exact scope, bounded inspection, unresolved-impact handling, artifact shape and path, reviewed range, artifact-only commit, and wrong-scope handoff.
  2. Author the self-contained skill and local task-diff quality rubric without a sibling-skill dependency.
  3. Run the focused contract tests and inspect the skill for any whole-branch mode or root-progress write.
- Verify: `bun --bun vitest run tests/skills/code-feedback-contract.test.ts` → every tactical feedback contract marker passes.
- Commit: `feat(skills): add hamilton-code-feedback`

### Task 10: Narrow hamilton-review to whole-branch inspection

- Depends on: Task 2, Task 7, Task 9
- Files:
  - Created:
    - `tests/skills/review-contract.test.ts`
  - Modified:
    - `skills/hamilton-review/SKILL.md`
    - `skills/hamilton-review/references/code-quality.md`
  - Deleted: none
- Acceptance:
  - `hamilton-review` is step 5 and accepts only merge-base-to-HEAD whole-branch input; task input stops and redirects to `hamilton-code-feedback` (requirements/review.md — Whole-branch review is a distinct pipeline gate).
  - Every pass starts from the complete diff and always inspects broader affected repository consumers, assumptions, cross-task composition, missing material changes, and boundaries, while running only focused verification for a concrete doubt and leaving mandatory full verification to finish-work.
  - Each physical last pass records full Base/Head and verdict in root `review.md`, commits only that file before handoff, never writes progress, and names re-plan or upstream proposal revision according to the finding type.
- Steps:
  1. Write failing contract tests for whole-branch-only scope, broad impact inspection, focused verification, material freshness metadata, physical-last-pass behavior, artifact-only commit, and task-scope redirect.
  2. Rewrite `SKILL.md` as the whole-branch gate and specialize its local quality reference for integration, omission, and affected-consumer review.
  3. Run the focused tests and read the skill for any surviving task-diff mode or bounded-repository instruction.
- Verify: `bun --bun vitest run tests/skills/review-contract.test.ts` → every whole-branch contract marker passes.
- Commit: `feat(skills): make hamilton-review whole-branch only`

### Task 11: Rebuild orchestration around split pipeline state

- Depends on: Task 4, Task 5, Task 8, Task 9, Task 10
- Files:
  - Created:
    - `skills/hamilton-orchestrate/references/code-feedback-prompt.md`
    - `skills/hamilton-orchestrate/references/whole-branch-review-prompt.md`
    - `tests/skills/orchestrate-contract.test.ts`
  - Modified:
    - `skills/hamilton-orchestrate/SKILL.md`
    - `skills/hamilton-orchestrate/references/implementer-prompt.md`
  - Deleted:
    - `skills/hamilton-orchestrate/references/reviewer-prompt.md`
- Acceptance:
  - Orchestration uses root status plus physical latest verdict and freshness: pending/blocked dispatches code, interrupted in-progress is inspected, done with absent/stale feedback dispatches feedback, fresh changes-requested dispatches code, and only done plus fresh approval advances (requirements/execution.md — Resume decisions).
  - It records one task-local `.base` before first code, uses task progress as the only detailed implementer report, commits each feedback artifact before the next checkpoint, and uses distinct task-feedback and whole-branch prompts.
  - After all task gates, absent/stale review dispatches review, fresh changes-requested enters re-plan for numbered remediation tasks or stops upstream for an artifact defect, and fresh approval hands off to finish-work; no ownerless fix wave or synthetic task remains.
- Steps:
  1. Add failing orchestration contract tests for every task resume state, every whole-review resume state, task checkpoint order, absence of a report-file placeholder, distinct prompts, remediation re-plan, and upstream-defect stop.
  2. Rewrite the implementer prompt around one row and task log, replace the shared reviewer prompt with the two scope-specific prompts, and require Base/Head persistence and artifact-only review commits.
  3. Rewrite the orchestration process, durable-resume section, model roles, file handoffs, boundaries, output, and flow diagram around the approved state matrices.
  4. Run the focused tests and search the changed skill directory for old per-task `hamilton-review`, shared `.base`, report-file, and one-wave language.
- Verify: `bun --bun vitest run tests/skills/orchestrate-contract.test.ts` → all orchestration state and prompt contracts pass.
- Commit: `feat(skills): orchestrate split feedback and review gates`

### Task 12: Move finish history into finish.md

- Depends on: Task 2, Task 7, Task 11
- Files:
  - Created:
    - `tests/skills/finish-work-contract.test.ts`
  - Modified:
    - `skills/hamilton-finish-work/SKILL.md`
  - Deleted: none
- Acceptance:
  - Finish-work consumes the exact ledger, task evidence, fresh feedback, and physical latest whole-review gates, and the explicit waiver affects only material-change ancestry; it never appends a finish section to progress.
  - After gates and committed spec synchronization, it commits `Attempt N` before side effects, verifies real state, persists matching `Outcome N` on the surviving branch or base, pushes and reads back remote outcomes when applicable, and reconciles a dangling attempt before another action (requirements/execution.md — Finish history).
  - Finish-owned spec, route/map, and numbered finish mutations after gate entry do not stale that same attempt; any unrelated material edit aborts and returns to review.
- Steps:
  1. Add failing contract tests for inputs and gates, no progress write, monotonic paired sections, attempt-before-action ordering, dangling recovery, local-merge/base persistence, pull-request push/read-back, no-op, partial failure, and post-gate mutation boundaries.
  2. Rewrite the finish skill's process, progress replacement, strategy branches, resume behavior, output, and diagram around `finish.md` and verified side effects.
  3. Run the focused tests and inspect the skill for stale mixed-review, last-code-commit, or root-progress finish language.
- Verify: `bun --bun vitest run tests/skills/finish-work-contract.test.ts` → every finish gate and history contract marker passes.
- Commit: `feat(skills): record verified finish outcomes separately`

### Task 13: Synchronize the seven-step identity across live skills

- Depends on: Task 8, Task 9, Task 10, Task 11, Task 12
- Files:
  - Created:
    - `tests/skills/pipeline-identity.test.ts`
  - Modified:
    - `skills/hamilton-init/SKILL.md`
    - `skills/hamilton-propose/SKILL.md`
    - `skills/hamilton-critique/SKILL.md`
    - `skills/hamilton-plan/SKILL.md`
    - `skills/hamilton-code/SKILL.md`
    - `skills/hamilton-code-feedback/SKILL.md`
    - `skills/hamilton-review/SKILL.md`
    - `skills/hamilton-orchestrate/SKILL.md`
    - `skills/hamilton-finish-work/SKILL.md`
    - `bundle/templates/design.md`
  - Deleted: none
- Acceptance:
  - Every live core skill presents `propose → plan → code → code-feedback → review → finish-work`, with init step 0, propose step 1, plan step 2, code step 3, code-feedback step 4, review step 5, and finish-work step 6; Wayfinder and critique remain optional and outside the core count (requirements/framework-docs.md — Pipeline identity).
  - Code hands off to code-feedback, critique distinguishes itself from whole-branch review, design-template testing guidance names both tactical and final gates, and no live skill advertises task-scoped `hamilton-review`.
  - Structural tests assert stable semantic markers rather than full prose snapshots.
- Steps:
  1. Add failing pipeline-identity tests covering every listed skill's sequence, role, step number, and handoff plus the design-template cross-reference.
  2. Update the remaining embedded sequences, step labels, counterpart descriptions, handoffs, and diagrams without changing each skill's unrelated behavior.
  3. Run all skill contract tests and search live skills for stale six-step and task-review language, excluding historical change artifacts.
- Verify: `bun --bun vitest run tests/skills` → all execution, feedback, review, orchestration, finish, and identity contract tests pass.
- Commit: `docs(skills): promote code feedback to pipeline step four`

### Task 14: Publish the split workflow migration guidance

- Depends on: Task 3, Task 13
- Files:
  - Created: none
  - Modified:
    - `README.md`
    - `docs/skills.md`
    - `docs/sdd-framework.md`
    - `docs/modes.md`
    - `CONTRIBUTING.md`
  - Deleted: none
- Acceptance:
  - Every public pipeline diagram and stage table shows seven core skills, the per-task code/code-feedback loop, one whole-branch review, and finish-work step 6 without counting Wayfinder or critique (requirements/framework-docs.md — Pipeline identity).
  - The skills reference gives plan, code, code-feedback, review, orchestrate, and finish-work entries the established heading/When/Inputs/Produces/Notes/Source shape and accurately names the root ledger, nested task artifacts, reviewed-head freshness, remediation re-plan, and finish history.
  - Artifact trees show root `progress.md`, `tasks/task-N/{progress.md,feedback.md}`, root `review.md`, and root `finish.md`; migration guidance says update the full set between changes, labels planned old formats unsupported, and does not imply conversion or resume support.
  - `CONTRIBUTING.md` maps changes under `skills/hamilton-*/` to `docs/skills.md`, while existing template and Wayfinder mapping distinctions remain intact.
- Steps:
  1. Update the README quick start, diagram, artifact tree, and migration pointer from the implemented contracts.
  2. Rewrite the affected skills-reference entries and control-flow section, then update the SDD framework and modes overview to the same seven-step and split-artifact truth.
  3. Add the Assisted-skill row to the contributor mapping without merging or disturbing the established Wayfinder rows.
  4. Read all five documents end to end, run stale-language searches outside historical artifacts, and run the repository gates.
- Verify: `bun --bun vitest run && bun run build && git diff --check` → full tests and build pass, and the diff has no whitespace errors.
- Commit: `docs: publish split execution and review workflow`

## Done when

- All fourteen active task rows in root `progress.md` read `done`, and each linked task progress file's physical latest attempt reads `Outcome: done`.
- Every task's physical latest feedback pass is valid, committed, `approved`, free of blocking items, and fresh for that task's latest progress commit.
- Root `review.md` has a committed physical latest whole-branch pass that is valid, `approved`, free of blocking findings, and fresh for the latest material change commit.
- `bun --bun vitest run` passes and `bun run build` succeeds.
- `git diff --check` is clean; no tracked `.hamilton/templates/` path, shared change-level `.base`, task-scoped `hamilton-review`, shared reviewer prompt, duplicate implementer report file, mixed root-progress history, or ownerless final fix wave remains in live sources.
- `hamilton-finish-work` folds `execution`, `review`, `artifact-templates`, and `framework-docs` deltas into canonical specs and records the verified finish strategy in `finish.md`.
