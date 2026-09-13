---
artifact: plan
change: 2026-09-12-lint-skill-scripts
status: approved
created: 2026-09-12
author: Hermes Agent
decision: accepted
route_unit: null
---

# Plan: Replace Hamilton Helper Scripts with the Workbench CLI

## Overview

- Change: `.hamilton/changes/2026-09-12-lint-skill-scripts/`
- Goal: Replace the six Hamilton-owned installed shell helpers with a native `hamilton workbench` CLI while preserving their observable behavior, stateful gates, and exit-code contract. Add explicitly scoped artifact linting and migrate setup, skills, tests, and documentation to the distributed implementation.
- Test: `bun --bun vitest run`
- Build / typecheck: `bun run build`
- Context notes: Follow `AGENTS.md`, the accepted proposal and design, and the requirement deltas in `requirements/`. Use ESM `.js` imports, Effect command patterns, pinned dependencies, `Data.TaggedError` for custom errors, real temporary directories and repositories in tests, and no comments in code. The implementation must preserve the old helper semantics while keeping workflow judgment in skills rather than the CLI.
- Quality notes: Tasks follow the design boundaries: shared artifact reading and contracts, scoped linting, one task per stateful operation, command composition, setup migration, consumer migration, documentation, and deletion. Runtime IO is isolated behind narrow seams, artifact validation is shared rather than duplicated, and precondition gates are split into independently testable repository and evidence groups. No structural smell is intentionally accepted.

## Tasks

### Task 1: Add the shared artifact reader

- Depends on: none
- Files:
  - Created: `src/workbench/artifact-reader.ts`, `tests/workbench/artifact-reader.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - A reader parses the first YAML frontmatter block, returns the source path, metadata, body, and useful line locations, and exposes a discriminated result for recognized, unrelated, and invalid input.
  - Malformed YAML, duplicate keys, an absent `artifact` field inside an attempted frontmatter block, and unreadable files produce typed diagnostics instead of falling back to body or filename inference.
  - Files without frontmatter can be classified for the lint layer without being treated as recognized artifacts by the reader itself.
  - File access is injectable so parser behavior is testable without process or Git state.
- Steps:
  1. Add fixture tests for valid frontmatter, multiline bodies, malformed YAML, duplicate keys, missing artifact metadata, no frontmatter, and read failures; assert structured results and source locations.
  2. Implement the reader with the existing YAML dependency, unique-key/error detection, frontmatter/body separation, and an injected file-reading seam.
  3. Run the targeted reader tests and the build, then refactor only for clarity without changing the result contract.
- Verify: `bun --bun vitest run tests/workbench/artifact-reader.test.ts && bun run build` → all reader tests pass and TypeScript builds cleanly.
- Commit: `feat(workbench): add artifact reader`

### Task 2: Register artifact metadata contracts

- Depends on: Task 1
- Files:
  - Created: `src/workbench/artifact-contracts.ts`, `tests/workbench/artifact-contracts.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - The registry covers every supported pipeline and Wayfinder artifact represented by the installed templates, including proposal, design, requirements, plan, progress, task progress, feedback, review, finish, map, ticket, and route artifacts.
  - Each contract validates required frontmatter fields, allowed values, and path-derived identity such as change, capability, task, effort, or ticket names.
  - Unsupported artifact values and metadata/path conflicts fail closed with structured diagnostics and never become skipped files.
  - Contract results are pure over the reader's parsed metadata and are reusable by lint, context, diff, and precondition without filesystem or Git access.
- Steps:
  1. Add table-driven fixtures for every artifact type, valid metadata, missing fields, invalid enumerations, unsupported values, and path identity mismatches; write the expected diagnostics before implementation.
  2. Implement the typed contract registry and metadata validators against the reader result, keeping artifact dispatch keyed by the declared `artifact` value.
  3. Run the contract tests and build, then simplify duplicated field or identity rules while retaining one authoritative definition per rule.
- Verify: `bun --bun vitest run tests/workbench/artifact-contracts.test.ts && bun run build` → all metadata contract cases pass and TypeScript builds cleanly.
- Commit: `feat(workbench): register artifact contracts`

### Task 3: Validate artifact bodies and workflow records

- Depends on: Task 2
- Files:
  - Created: none
  - Modified: `src/workbench/artifact-contracts.ts`, `tests/workbench/artifact-contracts.test.ts`
  - Deleted: none
- Acceptance:
  - Recognized artifacts validate their required headings, structural sections, and append-only record grammar for the declared artifact type.
  - HTML instruction comments cannot satisfy required headings or records, and checkbox-list validation is not introduced.
  - Plan/task ledgers, task progress, feedback, review, finish, critique, and Wayfinder records expose structured data needed by the stateful operations, including physical-last-pass and legacy-unsupported classification where established behavior requires it.
  - Missing headings, malformed records, non-monotonic append-only numbering, and unsupported legacy layouts produce location-bearing diagnostics rather than inferred success.
- Steps:
  1. Add body fixtures for every contract family, including valid finalized bodies, missing headings, comment-only headings, malformed records, stale numbering, and legacy layouts; assert structured diagnostics and extracted workflow state.
  2. Implement comment-aware body views and the contract-specific heading, section, record, ledger, and evidence validators on top of the metadata registry.
  3. Run the artifact contract tests and build, then verify that shared workflow parsing is consumed through the registry instead of duplicated in future operation modules.
- Verify: `bun --bun vitest run tests/workbench/artifact-contracts.test.ts && bun run build` → all body and workflow-record cases pass and TypeScript builds cleanly.
- Commit: `feat(workbench): validate artifact bodies`

### Task 4: Implement explicitly scoped linting

- Depends on: Task 3
- Files:
  - Created: `src/workbench/lint.ts`, `tests/workbench/lint.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - The lint operation requires exactly one selector, `file` or `changeDir`; missing or conflicting selectors return a usage result without inspecting either scope.
  - `file` validates only an existing regular file, while `changeDir` recursively considers regular files contained by the supplied directory, sorts candidates deterministically, and does not follow outside-target symlinks.
  - Recognized frontmatter is validated by the shared contracts, conventional Hamilton artifact filenames without frontmatter emit warnings and fail, and unrelated files are reported as skipped without failing.
  - All findings include paths and useful line or structural locations, all findings are reported in sorted order, and the result distinguishes success, lint findings, and invalid scope.
- Steps:
  1. Create temporary-directory tests for each selector, missing/both selectors, invalid paths, nested files, outside symlinks, valid artifacts, malformed artifacts, conventional filenames without frontmatter, unrelated files, multiple findings, and deterministic ordering.
  2. Implement scope validation, regular-file traversal, containment checks, reader/contract dispatch, diagnostic rendering, and the `0`/`1`/`2` result mapping without introducing a current-directory default.
  3. Run the lint suite and build, then inspect the rendered diagnostics for stable paths, severity, and locations.
- Verify: `bun --bun vitest run tests/workbench/lint.test.ts && bun run build` → all scope and diagnostic cases pass and TypeScript builds cleanly.
- Commit: `feat(workbench): add scoped artifact lint`

### Task 5: Establish runtime seams for isolation

- Depends on: none
- Files:
  - Created: `src/workbench/runtime.ts`, `src/workbench/isolate.ts`, `tests/workbench/helpers.ts`, `tests/workbench/isolate.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - Isolation preserves check, create, and verify behavior, including linked-worktree detection, non-default-branch handling, title/path validation, and negative results on an unisolated default checkout.
  - Git, filesystem, and process effects are hidden behind narrow injectable ports and the production runtime adapter; operation policy does not depend on a mutable global IO object.
  - Mutation failures return non-success without printing a successful isolation verdict, and successful results retain the load-bearing output line.
- Steps:
  1. Port the existing temporary-repository isolation scenarios and injected command-failure cases into `tests/workbench/isolate.test.ts`; add shared disposable-repository helpers for later workbench suites.
  2. Implement the role-sized runtime ports and the isolation operation against those ports, preserving the old argument and result semantics.
  3. Run the isolation tests and build, then verify real worktree behavior in disposable repositories and policy behavior through injected failures.
- Verify: `bun --bun vitest run tests/workbench/isolate.test.ts && bun run build` → isolation scenarios pass and TypeScript builds cleanly.
- Commit: `feat(workbench): port isolation operation`

### Task 6: Port prototype branching

- Depends on: Task 5
- Files:
  - Created: `src/workbench/prototype.ts`, `tests/workbench/prototype.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - Mapped and standalone prototype flows preserve branch identity, create/resume/switch behavior, verification, and invalid-argument handling.
  - Branch mutations happen only after their repository preconditions pass, and failures never report a successful branch result.
  - The operation uses the shared runtime seam and retains the former final branch/result output required by Wayfinder.
- Steps:
  1. Port the existing prototype branch fixture matrix into temporary-repository tests for mapped, standalone, resume, verify, collision, and failure cases.
  2. Implement the prototype operation with the runtime's narrow branch ports and the existing branch naming rules.
  3. Run the prototype tests and build, then inspect the branch state after every successful and failed mutation case.
- Verify: `bun --bun vitest run tests/workbench/prototype.test.ts && bun run build` → all prototype scenarios pass and TypeScript builds cleanly.
- Commit: `feat(workbench): port prototype branching`

### Task 7: Port diff packaging

- Depends on: Tasks 3 and 5
- Files:
  - Created: `src/workbench/diff.ts`, `tests/workbench/diff.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - Record mode creates exactly one stable task checkpoint only for a genuine first attempt and never overwrites an existing checkpoint.
  - Task, explicit-base, and whole-change packaging preserve ancestry checks, output paths, current-HEAD handling, and invalid-argument/environment results.
  - A package failure or invalid range stops before reporting a successful package, while successful output retains the full Base, Head, and package-path information consumed by skills.
- Steps:
  1. Port checkpoint and range fixtures into disposable repositories, covering first record, retry, historical checkpoint, task scope, explicit base, whole change, invalid ancestry, and output failures.
  2. Implement diff policy against the shared artifact contracts and runtime Git/filesystem ports without rebasing or reconstructing historical task ranges from current HEAD.
  3. Run the diff tests and build, then inspect generated package contents and checkpoint stability.
- Verify: `bun --bun vitest run tests/workbench/diff.test.ts && bun run build` → all checkpoint and package cases pass and TypeScript builds cleanly.
- Commit: `feat(workbench): port diff packaging`

### Task 8: Port change context

- Depends on: Tasks 3 and 5
- Files:
  - Created: `src/workbench/context.ts`, `tests/workbench/context.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - Single-change and `--all` context reports preserve artifact inventory, task status, feedback/review freshness, route metadata, and deterministic output.
  - Current frontmatter artifacts use shared typed inspection, while legacy or incomplete layouts retain the established `pre-plan` and `legacy-unsupported` classifications instead of being silently reinterpreted.
  - Invalid paths and unreadable changes return environment errors without producing a misleading successful context result.
- Steps:
  1. Port context fixtures for one change, all changes, current split state, pre-plan state, legacy layout, malformed artifacts, freshness states, and invalid paths.
  2. Implement context discovery and rendering on top of shared artifact inspection and narrow Git/runtime metadata ports, without duplicating YAML parsing.
  3. Run the context tests and build, then compare representative output against the former helper's load-bearing fields.
- Verify: `bun --bun vitest run tests/workbench/context.test.ts && bun run build` → all context states pass and TypeScript builds cleanly.
- Commit: `feat(workbench): port change context`

### Task 9: Port repository precondition gates

- Depends on: Tasks 3 and 5
- Files:
  - Created: `src/workbench/precondition.ts`, `tests/workbench/precondition.test.ts`
  - Modified: none
  - Deleted: none
- Acceptance:
  - The precondition operation evaluates repository cleanliness and the supplied project test command against the requested change repository, preserving normal negative results and environment failures.
  - Tests that fail, mutate the worktree, or cannot be executed close the gate without a success result and without inferring a waiver.
  - The operation uses injected command and Git seams for policy tests and real temporary repositories for integration behavior.
- Steps:
  1. Port clean-tree, test-command, post-test mutation, missing-command, and target-repository fixtures; assert the exact gate result and output for each case.
  2. Implement the repository-level precondition gates against the runtime and shared artifact-inspection interfaces, keeping command execution separate from gate policy.
  3. Run the precondition repository-gate tests and build, then verify no failed gate reports success.
- Verify: `bun --bun vitest run tests/workbench/precondition.test.ts -t "repository" && bun run build` → repository-gate cases pass and TypeScript builds cleanly.
- Commit: `feat(workbench): port repository preconditions`

### Task 10: Port evidence freshness gates

- Depends on: Task 9
- Files:
  - Created: none
  - Modified: `src/workbench/precondition.ts`, `tests/workbench/precondition.test.ts`
  - Deleted: none
- Acceptance:
  - Task ledger, task progress, feedback, review, ancestry, freshness, blocking-finding, and explicit whole-change waiver rules preserve the former fail-closed behavior.
  - Missing, malformed, stale, mixed, uncommitted, or contradictory evidence never inherits an earlier approval; the waiver changes only the explicitly permitted material-change check.
  - Successful output retains the final precondition result line and identifies the verified gate state needed by finish-work.
- Steps:
  1. Port evidence fixtures for exact split ledgers, task statuses, latest attempts, feedback/review verdicts, Base/Head ancestry, stale and mixed commits, blocking findings, and the narrow waiver cases.
  2. Implement the evidence gates using the shared workflow-record validators and physical Git history, preserving stage ownership and fail-closed decisions.
  3. Run the complete precondition suite and build, then inspect successful and failed outputs against the requirement scenarios.
- Verify: `bun --bun vitest run tests/workbench/precondition.test.ts && bun run build` → all repository and evidence gate cases pass and TypeScript builds cleanly.
- Commit: `feat(workbench): port evidence preconditions`

### Task 11: Compose the workbench CLI

- Depends on: Tasks 4, 6, 7, 8, and 10
- Files:
  - Created: `src/cli/commands/workbench.ts`, `tests/cli/workbench.test.ts`
  - Modified: `src/cli/main.ts`
  - Deleted: none
- Acceptance:
  - `hamilton workbench` exposes `isolate`, `diff`, `precondition`, `context`, `prototype`, and `lint` with their former argument meanings, while artifact contracts remain internal.
  - CLI parsing rejects unknown options, missing values, invalid combinations, missing lint scope, and both lint selectors with exit `2` before stateful work begins.
  - Subprocess tests exercise the actual command path for successful results, normal negative checks, failed operations, lint findings, help output, and the final machine-readable result lines.
  - The command runs without a source checkout or `~/.hamilton/scripts/` dependency and uses the production runtime adapter only at the composition boundary.
- Steps:
  1. Add command-level and subprocess tests that invoke the real Bun entrypoint with temporary repositories and change directories, covering help, every subcommand, exit statuses, and invalid argument combinations.
  2. Implement the namespaced Effect command, option parsing, operation factories, runtime wiring, result rendering, and root CLI composition without moving workflow judgment into handlers.
  3. Run the CLI suite and build, then verify the command starts with stale helper files absent and reports the expected final result lines.
- Verify: `bun --bun vitest run tests/cli/workbench.test.ts && bun run build` → actual CLI scenarios pass and TypeScript builds cleanly.
- Commit: `feat(cli): add workbench commands`

### Task 12: Remove script installation from setup

- Depends on: Task 11
- Files:
  - Created: none
  - Modified: `src/cli/commands/setup.ts`, `src/paths.ts`, `tests/cli/setup.test.ts`, `tests/paths.test.ts`
  - Deleted: none
- Acceptance:
  - Fresh setup continues to install templates, guidelines, settings, and the Hamilton home while creating and reporting no helper scripts or new `~/.hamilton/scripts/` directory.
  - Setup succeeds when the bundle has no `scripts/` directory and leaves a pre-existing scripts directory and its contents byte-for-byte unchanged.
  - Path helpers and setup results no longer expose script installation as a supported asset.
- Steps:
  1. Update temporary-HOME and bundle-override tests for fresh setup, missing bundle scripts, and an existing stale script directory; assert the expected red behavior before implementation.
  2. Remove script-directory creation, copy, and reporting from setup and remove obsolete path helpers while retaining all other setup behavior.
  3. Run setup and path tests and build, then inspect the resulting HOME tree and setup output.
- Verify: `bun --bun vitest run tests/cli/setup.test.ts tests/paths.test.ts && bun run build` → all setup migration cases pass and TypeScript builds cleanly.
- Commit: `refactor(cli): stop installing helper scripts`

### Task 13: Migrate skills to workbench commands

- Depends on: Tasks 11 and 12
- Files:
  - Created: `tests/skills/workbench-contract.test.ts`
  - Modified: `skills/hamilton-propose/SKILL.md`, `skills/hamilton-plan/SKILL.md`, `skills/hamilton-code/SKILL.md`, `skills/hamilton-orchestrate/SKILL.md`, `skills/hamilton-critique/SKILL.md`, `skills/hamilton-finish-work/SKILL.md`, `skills/hamilton-wayfinder-prototype/SKILL.md`, `tests/skills/finish-work-contract.test.ts`, `tests/skills/orchestrate-contract.test.ts`
  - Deleted: none
- Acceptance:
  - Every maintained Hamilton skill that formerly invoked a Hamilton-owned helper calls the matching `hamilton workbench` subcommand with equivalent arguments and no maintained skill invokes `~/.hamilton/scripts/`.
  - Skill-owned judgment, ordering, fail-closed behavior, task/review ownership, and migration boundaries remain in the skills rather than being delegated to the CLI.
  - Contract tests cover the complete former call-site mapping, including isolate, diff, context, precondition, and prototype commands.
- Steps:
  1. Update skill contract tests to assert the new command mappings and to fail on stale helper paths or altered ownership language.
  2. Replace each documented helper invocation in the seven affected skills with the corresponding workbench invocation, preserving flags, sequencing, and evidence handling.
  3. Run the focused skill-contract suites and build, then search all maintained skills for obsolete helper references.
- Verify: `bun --bun vitest run tests/skills/finish-work-contract.test.ts tests/skills/orchestrate-contract.test.ts tests/skills/workbench-contract.test.ts && bun run build` → all consumer contracts pass and no maintained skill references the old support surface.
- Commit: `docs(skills): migrate helper calls to workbench`

### Task 14: Update framework documentation

- Depends on: Task 13
- Files:
  - Created: `tests/docs/workbench-docs.test.ts`
  - Modified: `README.md`, `docs/modes.md`, `docs/skills.md`, `docs/sdd-framework.md`
  - Deleted: none
- Acceptance:
  - Setup and migration documentation presents the distributed workbench as the supported Hamilton workflow-mechanics surface and no longer instructs readers to install or verify the six helper scripts.
  - Documentation names all relevant workbench subcommands and explains that lint requires exactly one of `--file <file>` or `--change-dir <dir>`, including recursive boundary, skipped-file, warning, and fail-closed behavior.
  - Migration guidance states that CLI and skills update together, setup does not delete stale helper files, and `hamilton purge` remains explicit cleanup.
- Steps:
  1. Add focused documentation assertions for the setup, workbench, lint, and between-changes migration requirements; make them fail against the current text.
  2. Rewrite the affected README, mode, skills-reference, and framework sections to describe the new command without changing unrelated guidance.
  3. Run the documentation test, search for stale supported instructions, and inspect the rendered Markdown diff for accurate command examples.
- Verify: `bun --bun vitest run tests/docs/workbench-docs.test.ts && git diff --check && ! rg -n "hamilton-(artifact-contracts|change-context|diff-package|isolate|precondition-check|prototype-branch)|~/.hamilton/scripts/" README.md docs` → documentation assertions pass, whitespace is clean, and no stale user-facing instruction remains.
- Commit: `docs: document workbench migration`

### Task 15: Delete obsolete shell helpers and tests

- Depends on: Task 14
- Files:
  - Created: none
  - Modified: none
  - Deleted: `bundle/scripts/hamilton-artifact-contracts.sh`, `bundle/scripts/hamilton-change-context.sh`, `bundle/scripts/hamilton-diff-package.sh`, `bundle/scripts/hamilton-isolate.sh`, `bundle/scripts/hamilton-precondition-check.sh`, `bundle/scripts/hamilton-prototype-branch.sh`, `tests/scripts/change-context.test.ts`, `tests/scripts/diff-package.test.ts`, `tests/scripts/helpers.ts`, `tests/scripts/isolate.test.ts`, `tests/scripts/precondition-check.test.ts`, `tests/scripts/prototype-branch.test.ts`
- Acceptance:
  - The six Hamilton shell helpers and their obsolete shell-execution test suite are no longer tracked or required by setup, skills, docs, or source code.
  - The operation-focused workbench suites cover the former behavior before deletion, and no duplicate supported implementation remains.
  - The complete project test and build gates pass with the shell helper files absent.
- Steps:
  1. Confirm all former behavior cases are represented by `tests/workbench/`, all consumers use the workbench, and no source or documentation path still requires the deleted files.
  2. Delete the six bundle scripts and the legacy `tests/scripts/` files, then remove any now-unused references revealed by the compiler or search.
  3. Run the full test suite, build, whitespace check, and repository search; inspect the final changed-file list for accidental deletions.
- Verify: `bun --bun vitest run && bun run build && git diff --check && ! rg -n "hamilton-(artifact-contracts|change-context|diff-package|isolate|precondition-check|prototype-branch)|~/.hamilton/scripts/" src bundle skills README.md docs tests` → all tests and the build pass, the diff has no whitespace errors, and no maintained implementation references the removed helpers.
- Commit: `refactor: remove shell helper implementation`

## Done when

- All tasks are implemented and recorded as `done` in `progress.md` with linked task evidence.
- `bun --bun vitest run` passes and `bun run build` is clean.
- Every task has a fresh task-scoped feedback approval with no blocking findings.
- The whole branch has a fresh approved review with no blocking findings, and all review feedback has been addressed.
