# Design: Remove Curator Agent & Refactor Progress Tracking

## Context

The curator agent (`src/curator/change-id.ts`) is a Pi SDK call that generates a kebab-case change title from the user prompt. It runs before workflow execution and produces a change-id like `042-fix-login-timeout`, combining a sequential counter from `next-id.txt` with the curator's output.

The `hamilton-propose` skill now handles change creation — it scaffolds `.hamilton/changes/<name>/` with proposal artifacts. The curator and its `next-id.txt` mechanism are redundant.

Progress is currently tracked across two files: a per-run daily file (`.hamilton/workflows/progress-YYYY-MM-DD.txt`) and a per-change file (`.hamilton/changes/<id>/progress.md`). The daily file carries session continuity context between agent sessions. This dual-file system adds complexity without clear benefit.

## Goals

- Delete the curator agent entirely
- Remove `next-id.txt` and sequential change numbering
- Remove the per-run daily progress file (`.hamilton/workflows/progress-*.txt`)
- Change directory creation moves to `hamilton-propose` skill (out of scope for this change)
- The plan task in `feature-dev` workflow deduces the change-id, creates `progress.md`, and outputs its absolute path
- `progress.md` becomes the single source of truth for agent context and audit trail
- Scope: `feature-dev` workflow only; other workflows are not refactored

## Non-Goals

- Modifying `hamilton-propose` skill behavior
- Refactoring `bug-fix`, `security-audit`, `scaffold`, `quarantine-broken-tests`, or `do` workflows
- Changing `ensureChangeDir` or `writeWorkflowMetadata` (they stay, still used by hamilton-propose or future workflows)

## Decisions

### Planner-Centric Approach

The planner agent owns progress.md creation. It deduces the change-id from the user prompt by scanning `.hamilton/changes/` directories, verifies the directory exists (created earlier by hamilton-propose), creates `progress.md`, and outputs its absolute path. The runner is a pure DAG executor with no curator, no next-id, and no progress file management.

**Rationale:** Single owner for progress tracking. Planner has full context from the user prompt and can match it against existing change directories. Runner stays thin.

**Alternatives considered:**
- **Propose-initiated:** hamilton-propose creates progress.md. Rejected because it couples propose and run workflows unnecessarily.
- **Runner-mediated:** Runner detects dir and creates progress.md. Rejected because it puts logic back into the runner we're trying to simplify.

### Change Directory Discovery

The planner deduces the change-id by scanning `.hamilton/changes/` subdirectories and matching the user prompt against directory contents (proposal title, etc.). The planner receives `project_dir` as an initial parameter from the runner.

**Rationale:** No sentinel files or CLI flags needed. The planner has the user prompt and can match it intelligently.

### Progress File as Single Source of Truth

The daily progress file is removed. All agent context (codebase patterns, story status, completion log) lives in `progress.md`. Agents read it for orientation and append to it after completing work.

**Rationale:** One file to reason about. No synchronization between two progress files. Simpler agent instructions.

## Architecture

### Files Removed

| File | Reason |
|------|--------|
| `src/curator/change-id.ts` | Curator agent — replaced by hamilton-propose + planner |
| `tests/curator/change-id.test.ts` | Curator tests |

### Functions Removed

| Function | File |
|----------|------|
| `readNextId` | `src/observability/change-dir.ts` |
| `writeNextId` | `src/observability/change-dir.ts` |
| `ensureProgressFile` | `src/observability/run-dir.ts` |

### Path Helpers Removed

| Function | File |
|----------|------|
| `nextIdFile` | `src/paths.ts` |
| `progressDir` | `src/paths.ts` |
| `progressFile` | `src/paths.ts` |

### WorkflowEnv Fields Removed

| Field | Reason |
|-------|--------|
| `progress_file` | Replaced by `{{inputs.tasks.plan.outputs.progress_file}}` |
| `progress` | Replaced by reading progress.md directly |

`change_dir` stays in the type but the runner no longer sets it. Feature-dev agents use plan output instead.

### Runner Changes (`src/workflow/runner.ts`)

Remove:
- Import of `determineChangeId` from curator
- Import of `readNextId`, `writeNextId`, `ensureChangeDir`, `writeWorkflowMetadata` from change-dir
- Import of `ensureProgressFile` from run-dir
- Curator + next-id + change-dir-creation block (lines 93-120)
- Progress file creation and injection into WorkflowEnv
- `change_dir` injection into WorkflowEnv

Add:
- Pass `project_dir` as an initial parameter so the planner knows where to scan

### Plan Output Schema (`bundle/workflows/feature-dev/schemas/plan.json`)

New field:
```json
"progress_file": {
  "type": "string",
  "description": "Absolute path to progress.md inside the change directory"
}
```

Existing `change_id` field stays — the planner reports which change it matched.

### Planner Instructions (`bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md`)

New steps:
1. Deduce the change-id from the user prompt by scanning `.hamilton/changes/` directories
2. Verify the change directory exists (error if not found — user must run hamilton-propose first)
3. Create `progress.md` with an initial header
4. Output `progress_file` (absolute path) in the JSON result

### Agent Instructions (developer, tester, verifier)

Replace:
- `{{inputs.change_dir}}/progress.md` → `{{inputs.tasks.plan.outputs.progress_file}}`
- Daily progress file references (`{{inputs.progress_file}}`, `{{inputs.progress}}`) → removed
- Codebase Patterns and Story Plan sections → agents read from progress.md instead

### Workflow YAML (`bundle/workflows/feature-dev/workflow.yml`)

No structural changes. The plan task schema reference picks up the new `progress_file` field automatically.

## Data Flow

```
User runs hamilton-propose
  → creates .hamilton/changes/<name>/
  → writes proposal.md, requeriments.md, design.md

User runs: hamilton workflow run feature-dev "Add dark mode"

1. RUNNER: generates run ID, passes project_dir + user prompt as params
2. PLAN task (planner):
   a. Scans .hamilton/changes/ directories
   b. Matches "Add dark mode" against directory contents
   c. Finds .hamilton/changes/dark-mode/
   d. Creates progress.md with header
   e. Writes plan.md (existing behavior)
   f. Outputs: { tasks: [...], change_id: "dark-mode", progress_file: "/abs/path/.hamilton/changes/dark-mode/progress.md" }
3. SETUP task: discovers build/test commands (unchanged)
4. For each story:
   a. DEVELOPER: reads {{inputs.tasks.plan.outputs.progress_file}} for context
      implements story, appends completion entry
   b. TESTER: appends test results
   c. VERIFIER: appends verification status
```

## Error Handling

- Planner: `NoMatchingChangeError` when no `.hamilton/changes/` directory matches the user prompt (user must run hamilton-propose first)
- Planner: standard filesystem error when `progress.md` cannot be created
- No new error types needed beyond the planner's existing error handling pattern

## Docs Cleanup

- `docs/advanced.md` — remove references to `next-id.txt` and daily progress file convention
- `docs/settings.md` — remove `next-id.txt` counter documentation

## Testing

### Tests Removed
- `tests/curator/change-id.test.ts`
- `tests/observability/run-dir.test.ts` — `ensureProgressFile` test cases
- `tests/observability/change-dir.test.ts` — `readNextId`/`writeNextId` test cases
- `tests/paths.test.ts` — `nextIdFile`, `progressDir`, `progressFile` test cases

### Tests Updated
- `tests/cli/run.test.ts` — remove curator mock, remove `progress_file`/`progress` from expected WorkflowEnv
- `tests/workflow/` — any feature-dev workflow tests that reference `change_dir` or daily progress

### New Tests
- Planner deduces change-id from user prompt
- Planner errors when no matching change directory exists
- Planner creates progress.md and outputs path

## Migration Impact

Other workflows (`bug-fix`, `security-audit`, etc.) are not refactored. Their agents still reference `{{inputs.change_dir}}/progress.md`, but since the runner no longer sets `change_dir`, the value is undefined. Those agents' progress-writing instructions become inert — no progress is written for non-feature-dev workflows until they are refactored in future changes.
