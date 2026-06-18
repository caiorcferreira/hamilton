# Design: Roadmap Batch Fixes

**Date**: 2026-06-19

Six small-to-medium improvements from the Hamilton roadmap.

---

## 1. Inject Output Schema in Task Context

**Problem**: Output schemas are resolved from YAML and used only for Ajv validation on `write_task_output`. The agent never sees the expected output shape and must infer it.

**Design**: When a task has `output.schema.content` (resolved at load time from `schema.file` if needed), prepend it to the task prompt using XML-style tags.

**Where**: `src/workflow/runner.ts`, in `executeSingleTask`, between prompt build and `PromptBuilt` event publish.

**Format**:

```
<expected_output_schema>
<schema content as formatted JSON>
</expected_output_schema>

<task>
<original task prompt>
</task>
```

**Behavior**: Only injected when `task.agent.output.schema.content` is present. No new resolution is needed — schemas are already resolved from file during `loadWorkflowSpec`.

---

## 2. Improve Error Messages with Nearest Match

**Problem**: When a workflow slug is not found, the error is a generic "workflow not found" with no suggestions.

**Design**: Add fuzzy matching via Levenshtein edit distance to suggest nearby workflow names.

**Where**:
- `src/workflow/resolver.ts` — compute suggestions when no exact match
- `src/workflow/loader.ts` — add `nearestMatches` field to `WorkflowNotFoundError`
- `src/cli/commands/run.ts` — render suggestions in CLI error

**Algorithm**: Levenshtein distance computed for all available slugs against the failed input. Results sorted ascending, top 3 returned. Implemented inline — no external dependency needed.

**Error output**:

```
Workflow "featuer-dev" not found.
Did you mean:
  - feature-dev
  - feature-review
  - hotfix
```

---

## 3. Background Run (Default) + Foreground Flag

**Problem**: Runs always block the terminal. Users want to kick off a run and check later.

**Design**: Background execution is the default. A `--foreground` / `-f` flag restores the blocking behavior.

**New CLI options**:
- `--foreground` (`-f`) — when present, runs in-process as today.
- `--run-id <id>` — hidden flag for the child to receive its pre-generated runId. Not exposed in help text.

**New DB column**: `runs.pid` (nullable INTEGER), added via migration.

**Default (background) path**:
1. Parent calls `buildRunId(workflowSlug)` to generate the runId.
2. Parent spawns detached child via `Bun.spawn`, passing `--foreground` and `--run-id <runId>`:
   ```
   Bun.spawn([process.execPath, process.argv[1], "run", slug, ...prompt, "--foreground", "--run-id", runId], { detached: true })
   ```
   This reuses the current bun binary and script path, working for both dev (`bun src/cli/main.ts`) and installed (`hamilton`) environments.
3. Parent runs `INSERT INTO runs (id, workflow_id, pid, ...)` with the child PID.
4. Parent prints `Run ID: <runId>` and exits immediately.
5. Child process receives `--foreground --run-id <runId>`, executes `runWorkflow(spec, ..., existingRunId)` in-process, writes `process.pid` to DB on startup.

**Foreground path**: When `--foreground` is passed without `--run-id` (user invocation), `runWorkflow` generates its own runId via `buildRunId` as it does today. No PID stored.

**Status/resume**: Unchanged — they already read from the DB.

---

## 4. Fix Guideline File Naming

**Problem**: In the `PromptBuilt` event, guideline file names are just the guideline name (e.g., `my-guideline`). They should be `<guideline-name>:<file-name>`.

**Where**: `src/guidelines/loader.ts:108`.

**Fix**: Change the `name` field from `manifest.metadata.name` to `${manifest.metadata.name}:${file}`.

```typescript
files.push({ name: `${manifest.metadata.name}:${file}`, content })
```

The `file` variable is the relative path from the guideline directory, already available in the iteration over `entry.files`.

This flows through to Pi's `agentsFilesOverride` at `src/executors/pi/pi-executor.ts:143`, where it becomes the `path` the agent sees.

---

## 5. Eliminate runId/taskId String Parsing

**Problem**: `CliRenderer` at `src/cli/subscribers.ts` parses taskId strings to extract task names and nanoid suffixes for display. We should never depend on string parsing for ID structure.

**Design**: Enrich all task-related events with a `taskName` field. The renderer uses that directly.

**Event changes** — add `taskName: string` to:

| Event | New field |
|-------|-----------|
| `TaskStarted` | `+taskName` |
| `TaskCompleted` | `+taskName` |
| `TaskFailed` | `+taskName` |
| `TaskTimedOut` | `+taskName` |
| `TaskRetrying` | `+taskName` |
| `TaskPaused` | `+taskName` |
| `TokenUsage` | `+taskName` |

**Producer** (`src/workflow/runner.ts`): The caller already has `instanceName` in scope when publishing each event. Pass it through.

**Consumer** (`src/cli/subscribers.ts`): Replace `extractSlug(event.taskId, event.runId)` with `event.taskName`. Remove `extractSlug` and `shortId` functions entirely. For the short ID display (last nanoid segment), use `event.taskId.split("-").pop()` — this is cosmetic and doesn't reconstruct semantic meaning from the ID structure.

---

## 6. Git Diff Tool

**Problem**: Agents have no way to inspect git diffs during task execution.

**Design**: Add a `git_diff` tool to the existing workflow extension at `src/executors/pi/extensions/workflow-extension.ts`. Registered alongside `write_task_output`.

**Tool signature** (as seen by agent):

```
git_diff(staged?: boolean): string
```

- `staged=false` (default): Shows unstaged changes (`git diff`).
- `staged=true`: Shows staged changes (`git diff --cached`).

**Implementation**:
- Shell out to `git diff` or `git diff --cached` in `process.cwd()`.
- Return stdout as the tool result.
- Handle errors gracefully (not a git repo, no changes).
- Registered in `createWorkflowExtension` to share the abort-on-complete lifecycle.
