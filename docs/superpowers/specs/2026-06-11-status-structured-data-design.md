# Status Command — Replace String Parsing with Structured Data

## Summary

The status command relies on `parseTaskSlug` and `resolveDagBase` to reverse-engineer task names from opaque task IDs — pure string manipulation on data that should be stored explicitly. This causes an infinite loop (100% CPU, frozen terminal) when task IDs contain consecutive dashes. The runner also generates different task IDs at insert time vs. run time, causing DB updates to target non-existent rows. Fix both by adding `task_name` and `execution_index` columns to the `tasks` table, eliminating all string parsing on the read path.

## Root Cause

### Bug 1 — Status freeze

```
task ID:  scaffold-4IJqg-scaffold--DrN7
parseTaskSlug → "scaffold-"          ← trailing dash
resolveDagBase → infinite loop        ← regex /-[^-]+$/ never matches "-"
→ 100% CPU, no output
```

`parseTaskSlug` in `src/cli/commands/status.ts:86` strips the last `-nanoid` suffix from the task ID. When the task ID contains `--` (from task names with embedded dashes), it produces a slug ending with `-`. `resolveDagBase` then enters a `while (current.includes("-"))` loop where the inner regex never matches, so `current` never changes.

### Bug 2 — Runner ID mismatch

- `insertTasks` generates ID `scaffold-4IJqg-scaffold--DrN7` via `buildTaskId`.
- `createWorkflowRuntime` calls `parseTaskSlug` to recover the task name → gets `"scaffold-"` (wrong).
- Runner's `executeSingleTask` generates a *new* ID `scaffold-4IJqg-scaffold-tK49x`.
- `transitionTask` uses the state machine's wrong compoundId → DB updates target wrong rows.
- **Result:** tasks always show `pending` in status, regardless of actual completion.

### Bug 3 — Wrong display names

`getRunStatus` maps `taskSlug` from `tasks.agent_id` — the agent executor name ("scaffolder"), not the task name ("scaffold").

## Approach

Add `task_name` and `execution_index` columns to the `tasks` table. Store structured data at insert time and read it directly. Delete `parseTaskSlug` and `resolveDagBase`. The status command becomes a single DB query with reliable ordering — no workflow spec loading, no string parsing.

## DB Migration (Version 4)

```sql
ALTER TABLE tasks ADD COLUMN task_name TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN execution_index INTEGER NOT NULL DEFAULT 0;
```

Existing rows get `''` / `0`. This is acceptable — only new runs benefit from the fix.

## Schema Update

`src/db/schema.ts` — add columns to CREATE TABLE:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  execution_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  ...
);
```

## Changes

### `src/db/queries.ts`

**`insertTasks`** — new signature, stores data explicitly:

```typescript
// Before
insertTasks(db, runId, Array<{ taskSlug: string; agentName: string }>)

// After
insertTasks(db, runId, Array<{ taskName: string; agentName: string; executionIndex: number }>)
```

Each row stores `task_name` and `execution_index`. The caller provides tasks already in topological order with sequential indexes.

**`insertTask` (dynamic tasks)** — same treatment, receives `executionIndex` as a parameter. The caller (state machine) tracks the next available index.

**`getRunStatus`** — query tasks ordered by `execution_index`, return `taskName` from column:

```typescript
// Before
db.prepare(`SELECT * FROM tasks WHERE run_id = ? ORDER BY id`)

// After
db.prepare(`SELECT * FROM tasks WHERE run_id = ? ORDER BY execution_index`)
```

**`RunStatusRow`** — rename `taskSlug` → `taskName`, source from `tasks.task_name`.

### `src/workflow/run-state-machine.ts`

**Remove `parseTaskSlug`** (the local copy at line 23-30).

**`createWorkflowRuntime`** — rebuild `compoundTaskIds` from `task_name` column, not from parsing `id`:

```typescript
// Before
const slug = parseTaskSlug(task.id, runId)
compoundTaskIds.set(slug, task.id)

// After
compoundTaskIds.set(task.task_name, task.id)
```

**State machine tracks `_nextExecutionIndex`** — a counter starting at 0, incremented on each insert. Used for both initial `insertTasks` (static tasks) and `insertDynamicTask` (template instances added at runtime). This ensures all tasks have correct, non-overlapping indices.

**Insert time** — pass collected tasks with sequential `execution_index`:

```typescript
const sorted = topologicalSort(collectReachableTasks(spec.spec.tasks, spec.spec.run.entrypoint))
insertTasks(db, runId, sorted.map((t, i) => ({
  taskName: t.name,
  agentName: t.agent!.executorRef,
  executionIndex: i
})))
```

### `src/workflow/runner.ts`

**`executeSingleTask`** — use the state machine's task ID instead of generating a new one:

```typescript
// Before
const taskId = buildTaskId(runId, instanceName)

// After
const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(runId, instanceName)
```

The fallback to `buildTaskId` handles edge cases where a task name isn't in the map (shouldn't happen after the state machine fix, but defensive).

**Template instances** — call `insertDynamicTask` before executing:

```typescript
const instanceName = `${task.name}/${i}`
yield* _(ctx.insertDynamicTask(instanceName, templateTask.agent!.executorRef))
yield* _(executeSingleTask(templateTask, subContext, instanceName))
```

Currently `transitionTask("implement-stories/0", "start")` targets a non-existent row because `insertDynamicTask` is never called. Adding this call fixes template task state tracking as a side effect.

### `src/cli/commands/status.ts`

**Remove**:
- `parseTaskSlug` (lines 85-98)
- `resolveDagBase` (lines 69-83)
- The DAG ordering block (lines 125-145) — ordering comes from `execution_index`

**`GetRunStatusOpts`** — drop `loadSpec`:

```typescript
// Before
export interface GetRunStatusOpts { runId: string; loadSpec?: boolean }

// After
export interface GetRunStatusOpts { runId: string }
```

**`getRunStatus`** — remove the entire `loadSpec` path (lines 30-44). No more loading `WorkflowSpec`, `WorkflowDescriptor`, or `loadWorkflowSpec`.

**`formatStatus`** — drop `spec` parameter. Use `taskName` from the status object:

```typescript
// Before
export function formatStatus(status: RunStatus, spec?: WorkflowSpec): string

// After
export function formatStatus(status: RunStatus): string
```

Subtasks (template instances with `/` in the name) are detected by `taskName.includes("/")`.

**`statusCommand`** — simplify:

```typescript
export const statusCommand = Command.make("status", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(getRunStatus({ runId: id }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Status not found: ${id}`)
      return
    }
    yield* Console.log(formatStatus(result.value.status))
  })
)
```

### `src/workflow/engine.ts`

No changes to `buildTaskId` — it's still used as a fallback and for generating run IDs. The fix is *not* changing how IDs are generated; it's making the status path stop needing to reverse-engineer them.

### Test updates

**`tests/cli/status.test.ts`**:
- `formatStatus` tests: populate `taskName` in test data, remove `taskSlug`, drop `spec` parameter.
- `taskSlug` → `taskName` rename throughout assertions.
- The existing subtask indent test (spaces for `/` in name) continues to work — sub-task detection is now `taskName.includes("/")` instead of deriving from task ID.
- Remove the string-manipulation assertion block (line 153-156) that slices task IDs.

**New tests:**
- `execution_index` ordering: insert tasks out of order, verify status displays them in `execution_index` order.
- Verify tasks use `task_name` for display, not `agent_id`.

## Files Modified

| File | Change |
|---|---|
| `src/db/schema.ts` | Add `task_name`, `execution_index` columns |
| `src/db/migrations.ts` | Migration 4: ALTER TABLE tasks |
| `src/db/queries.ts` | `insertTasks`: new params; `getRunStatus`: use `task_name`, order by `execution_index`; `RunStatusRow`: rename field |
| `src/workflow/run-state-machine.ts` | Remove `parseTaskSlug`; use `task_name` in `createWorkflowRuntime`; pass topological order to `insertTasks` |
| `src/workflow/runner.ts` | Use `ctx.compoundTaskIds`; call `insertDynamicTask` for template instances |
| `src/cli/commands/status.ts` | Remove `parseTaskSlug`, `resolveDagBase`, `loadSpec` path; simplify `formatStatus` signature |
| `tests/cli/status.test.ts` | Update to new `RunStatusRow` shape and `formatStatus` signature |

## Out of Scope

- Fixing existing stale DB rows (migration gives them `''` / `0` defaults).
- Parallel task execution.
- Template/forEach execution logic changes beyond the `insertDynamicTask` call.
