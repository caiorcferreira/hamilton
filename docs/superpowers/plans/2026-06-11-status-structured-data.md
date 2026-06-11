# Status Command — Replace String Parsing with Structured Data

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate string-parsing bugs in the status command by adding `task_name` and `execution_index` columns to the `tasks` table, making status a single ordered DB query.

**Architecture:** Add two columns to `tasks` table via Migration 4. Store task name and execution index at insert time. Status command reads them directly — no reverse-engineering from opaque task IDs. Runner uses state machine's compoundTaskIds instead of generating independent task IDs.

**Tech Stack:** TypeScript, bun:sqlite, Effect-TS, vitest

---

## File Map

| File | Role |
|---|---|
| `src/db/schema.ts` | CREATE TABLE — add `task_name`, `execution_index` columns |
| `src/db/migrations.ts` | Migration 4 — ALTER TABLE for existing installs |
| `src/db/queries.ts` | CRUD — updated `insertTasks`/`insertTask`/`TaskRow`/`RunStatusRow`/`getRunStatus` |
| `src/workflow/state.ts` | `RunStatus` type — rename `taskSlug` → `taskName` |
| `src/workflow/run-state-machine.ts` | Remove `parseTaskSlug`, use `task_name` column, track `_nextExecutionIndex` |
| `src/workflow/runner.ts` | Use `ctx.compoundTaskIds` for task IDs, call `insertDynamicTask` for templates |
| `src/cli/commands/status.ts` | Delete `parseTaskSlug`, `resolveDagBase`, `loadSpec` path; simplify `formatStatus` signature |
| `tests/db/queries.test.ts` | Update `insertTasks`/`insertTask`/`getRunStatus` call sites and assertions |
| `tests/cli/status.test.ts` | Update `formatStatus` tests, remove string-parsing assertions, add execution_index test |
| `tests/workflow/run-state-machine.test.ts` | Add `execution_index` assertions |

---

### Task 1: DB Migration 4 — Add `task_name` and `execution_index` columns

**Files:**
- Modify: `src/db/schema.ts:17-29`
- Modify: `src/db/migrations.ts:10-23`

- [ ] **Step 1: Add columns to schema.ts CREATE TABLE**

In `src/db/schema.ts`, in the tasks CREATE TABLE statement, add the two new columns after `agent_id`:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  execution_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  output_json TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

- [ ] **Step 2: Add Migration 4 to migrations.ts**

In `src/db/migrations.ts`, append to the `MIGRATIONS` record after version 3:

```typescript
const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => createSchema(db),
  2: (db) => {
    for (const col of ["model_provider", "model_id"]) {
      try { db.exec("ALTER TABLE tasks ADD COLUMN " + col + " TEXT") }
      catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    }
  },
  3: (db) => {
    db.exec("CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_index INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, stop_reason TEXT, tool_result_count INTEGER DEFAULT 0, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id))")
    db.exec("CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, tool_name TEXT NOT NULL, args_summary TEXT NOT NULL, result_summary TEXT, is_error INTEGER DEFAULT 0, partial_update_count INTEGER DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
    db.exec("CREATE TABLE IF NOT EXISTS provider_requests (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status_code INTEGER, payload_summary TEXT NOT NULL, headers_summary TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, latency_ms INTEGER, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
  },
  4: (db) => {
    try { db.exec("ALTER TABLE tasks ADD COLUMN task_name TEXT NOT NULL DEFAULT ''") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    try { db.exec("ALTER TABLE tasks ADD COLUMN execution_index INTEGER NOT NULL DEFAULT 0") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  }
}
```

Note: Migration 4 uses `TEXT NOT NULL DEFAULT ''` for both columns because SQLite ALTER TABLE cannot add NOT NULL INTEGER columns with DEFAULT in a single statement without issues on some versions. New installs get proper `INTEGER NOT NULL DEFAULT 0` from schema.ts, and queries coalesce the value.

- [ ] **Step 3: Update migration test version numbers**

In `tests/db/migrations.test.ts`, update all checks from version 3 to 4:

Line 37: `expect(v2.user_version).toBe(4)`
Line 83: `expect(v1).toBe(4)`
Line 87: `expect(v2).toBe(4)`
Line 104: `expect(v).toBe(4)`

Also update test descriptions at line 29: `"migrate creates all tables from scratch (v1 -> v4)"`

- [ ] **Step 4: Add v3 -> v4 migration test**

Add a new test to `tests/db/migrations.test.ts`:

```typescript
it("v3 -> v4 adds task_name and execution_index to tasks", () => {
  db = tempDb()
  db.prepare("PRAGMA user_version = 3").run()
  db.exec("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT, current_task TEXT, error_message TEXT, context_json TEXT DEFAULT '{}')")
  db.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', started_at TEXT, completed_at TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, retry_count INTEGER DEFAULT 0, error_message TEXT, output_json TEXT, model_provider TEXT, model_id TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")
  db.exec("CREATE TABLE IF NOT EXISTS token_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT NOT NULL, event_type TEXT NOT NULL, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, timestamp TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (run_id) REFERENCES runs(id))")
  db.exec("CREATE TABLE IF NOT EXISTS workflow_state (run_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (run_id, key))")
  db.exec("CREATE TABLE IF NOT EXISTS durable_deferred (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', value TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")
  db.exec("CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_index INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, stop_reason TEXT, tool_result_count INTEGER DEFAULT 0, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id))")
  db.exec("CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, tool_name TEXT NOT NULL, args_summary TEXT NOT NULL, result_summary TEXT, is_error INTEGER DEFAULT 0, partial_update_count INTEGER DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
  db.exec("CREATE TABLE IF NOT EXISTS provider_requests (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status_code INTEGER, payload_summary TEXT NOT NULL, headers_summary TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, latency_ms INTEGER, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")

  migrate(db)

  const v = db.prepare("PRAGMA user_version").get() as { user_version: number }
  expect(v.user_version).toBe(4)

  const info = db.prepare("PRAGMA table_info('tasks')").all() as Array<{ name: string }>
  const colNames = info.map(c => c.name)
  expect(colNames).toContain("task_name")
  expect(colNames).toContain("execution_index")
})
```

- [ ] **Step 5: Run tests to verify migration**

Run: `bun --bun vitest run tests/db/migrations.test.ts`
Expected: all 5 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts
git commit -m "feat: add task_name and execution_index columns to tasks table (migration 4)"
```

---

### Task 2: Update `TaskRow` and `RunStatusRow` types, rename `taskSlug` → `taskName`

**Files:**
- Modify: `src/db/queries.ts:15-49`
- Modify: `src/workflow/state.ts:12-32`

- [ ] **Step 1: Add new fields to TaskRow interface**

In `src/db/queries.ts`, add `task_name` and `execution_index` to `TaskRow`:

```typescript
export interface TaskRow {
  id: string
  run_id: string
  agent_id: string
  task_name: string
  execution_index: number
  status: string
  started_at: string | null
  completed_at: string | null
  tokens_in: number
  tokens_out: number
  retry_count: number
  error_message: string | null
  output_json: string | null
}
```

- [ ] **Step 2: Rename `taskSlug` → `taskName` in RunStatusRow**

In `src/db/queries.ts`, in `RunStatusRow`:

```typescript
export interface RunStatusRow {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt: string | null
  currentTask: string | null
  tasks: Array<{
    taskId: string
    taskName: string
    status: string
    startedAt: string | null
    completedAt: string | null
    tokensIn: number
    tokensOut: number
    errorMessage: string | null
  }>
  totalTokensIn: number
  totalTokensOut: number
  errorMessage: string | null
}
```

- [ ] **Step 3: Rename `taskSlug` → `taskName` in RunStatus (state.ts)**

In `src/workflow/state.ts`, change `taskSlug` to `taskName`:

```typescript
export interface RunStatus {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt: string | null
  currentTask: string | null
  tasks: Array<{
    taskId: string
    taskName: string
    status: string
    startedAt: string | null
    completedAt: string | null
    tokensIn: number
    tokensOut: number
    errorMessage: string | null
  }>
  totalTokensIn: number
  totalTokensOut: number
  errorMessage: string | null
}
```

- [ ] **Step 4: Build to verify type consistency**

Run: `bun run build`
Expected: No type errors from this rename (other files referencing `taskSlug` will break — that's expected and fixed in later tasks).

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts src/workflow/state.ts
git commit -m "refactor: rename taskSlug to taskName in RunStatusRow and RunStatus types"
```

---

### Task 3: Update `insertTasks` and `insertTask` to populate new columns

**Files:**
- Modify: `src/db/queries.ts:62-84`

- [ ] **Step 1: Rewrite insertTasks**

Replace the existing `insertTasks` function:

```typescript
export function insertTasks(
  db: Database,
  runId: string,
  tasks: Array<{ taskName: string; agentName: string; executionIndex: number }>
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status) VALUES (?, ?, ?, ?, ?, 'pending')`
  )
  for (const task of tasks) {
    stmt.run(buildTaskId(runId, task.taskName), runId, task.agentName, task.taskName, task.executionIndex)
  }
}
```

- [ ] **Step 2: Rewrite insertTask**

Replace the existing `insertTask` function:

```typescript
export function insertTask(
  db: Database,
  runId: string,
  taskId: string,
  agentName: string,
  taskName: string,
  executionIndex: number
): void {
  db.prepare(
    `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status) VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(taskId, runId, agentName, taskName, executionIndex)
}
```

- [ ] **Step 3: Run tests to see which call sites break**

Run: `bun --bun vitest run tests/db/queries.test.ts`
Expected: FAIL — call sites in tests use old signature

- [ ] **Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: update insertTasks and insertTask to accept taskName and executionIndex"
```

---

### Task 4: Update `getRunStatus` to use `task_name` and order by `execution_index`

**Files:**
- Modify: `src/db/queries.ts:157-195`

- [ ] **Step 1: Update getRunStatus query and mapping**

Replace the task query to order by `execution_index`, and map `taskName` from `task_name` column:

```typescript
export function getRunStatus(db: Database, runId: string): RunStatusRow | null {
  const run = getRunById(db, runId)
  if (!run) return null

  const tasks = db.prepare(
    `SELECT * FROM tasks WHERE run_id = ? ORDER BY execution_index`
  ).all(runId) as TaskRow[]

  const tokenResult = db.prepare(
    `SELECT COALESCE(SUM(tokens_in), 0) as total_in, COALESCE(SUM(tokens_out), 0) as total_out FROM token_events WHERE run_id = ?`
  ).get(runId) as { total_in: number; total_out: number }

  return {
    runId: run.id,
    workflow: run.workflow_id,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    currentTask: run.current_task,
    tasks: tasks.map((t) => ({
      taskId: t.id,
      taskName: t.task_name,
      status: t.status,
      startedAt: t.started_at,
      completedAt: t.completed_at,
      tokensIn: t.tokens_in,
      tokensOut: t.tokens_out,
      errorMessage: t.error_message
    })),
    totalTokensIn: tokenResult.total_in,
    totalTokensOut: tokenResult.total_out,
    errorMessage: run.error_message
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: use task_name and execution_index in getRunStatus"
```

---

### Task 5: Update DB queries test file

**Files:**
- Modify: `tests/db/queries.test.ts:66-176`

- [ ] **Step 1: Update insertTasks call site**

Replace line 68-71:

```typescript
insertTasks(db, "run-1", [
  { taskName: "task-1", agentName: "agent-1", executionIndex: 0 },
  { taskName: "task-2", agentName: "agent-2", executionIndex: 1 }
])
```

- [ ] **Step 2: Update insertTasks assertions**

After line 76, add:

```typescript
expect(tasks[0].task_name).toBe("task-1")
expect(tasks[0].execution_index).toBe(0)
expect(tasks[1].task_name).toBe("task-2")
expect(tasks[1].execution_index).toBe(1)
```

- [ ] **Step 3: Update insertTask call site**

Replace line 81:

```typescript
insertTask(db, "run-1", "run-1-dynamic-abcde", "agent-1", "dynamic-task", 99)
```

Add assertions:
```typescript
expect(tasks[0].task_name).toBe("dynamic-task")
expect(tasks[0].execution_index).toBe(99)
```

- [ ] **Step 4: Update remaining insertTasks calls**

Throughout the file, every `insertTasks` call uses the old `{ taskSlug, agentName }` shape. Update them all to `{ taskName, agentName, executionIndex }` with sequential indices.

Lines affected: 91, 104, 121, 160.

- [ ] **Step 5: Add getRunStatus ordering test**

Add a new test at the end of the first `describe("queries")` block:

```typescript
it("getRunStatus returns tasks ordered by execution_index", () => {
  insertRun(db, "run-order", "wf-order", "2025-01-01T00:00:00Z")
  insertTasks(db, "run-order", [
    { taskName: "third", agentName: "agent-c", executionIndex: 2 },
    { taskName: "first", agentName: "agent-a", executionIndex: 0 },
    { taskName: "second", agentName: "agent-b", executionIndex: 1 }
  ])
  const status = getRunStatus(db, "run-order")
  expect(status!.tasks[0].taskName).toBe("first")
  expect(status!.tasks[1].taskName).toBe("second")
  expect(status!.tasks[2].taskName).toBe("third")
})
```

- [ ] **Step 6: Run tests to verify**

Run: `bun --bun vitest run tests/db/queries.test.ts`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add tests/db/queries.test.ts
git commit -m "test: update queries tests for taskName and executionIndex"
```

---

### Task 6: Update run-state-machine to use `task_name` column, remove `parseTaskSlug`, add `_nextExecutionIndex`

**Files:**
- Modify: `src/workflow/run-state-machine.ts:23-30, 79-96, 146-153, 234-305`

- [ ] **Step 1: Remove parseTaskSlug**

Delete lines 23-30 (the local `parseTaskSlug` function).

- [ ] **Step 2: Add _nextExecutionIndex to WorkflowRuntimeImpl**

In the `WorkflowRuntimeImpl` class, add a field after `_compoundTaskIds`:

```typescript
class WorkflowRuntimeImpl implements WorkflowRuntime {
  private _state: RunState
  private _taskStates: Map<string, TaskState> = new Map()
  private _compoundTaskIds: Map<string, string> = new Map()
  private _nextExecutionIndex: number = 0
```

Update constructor to accept and optionally set it:

```typescript
constructor(
    private readonly _db: Database,
    private readonly _runId: string,
    private readonly _spec: WorkflowSpec,
    initialState: RunState,
    taskStates: Map<string, TaskState>,
    compoundTaskIds: Map<string, string>,
    nextExecutionIndex: number = 0
  ) {
    this._state = initialState
    this._taskStates = taskStates
    this._compoundTaskIds = compoundTaskIds
    this._nextExecutionIndex = nextExecutionIndex
  }
```

- [ ] **Step 3: Update transitionTask to set _nextExecutionIndex from DB on resume**

When resuming a paused run, the existing `createWorkflowRuntime` reads task rows and rebuilds `compoundTaskIds`. We also need to recover `_nextExecutionIndex` from the max existing `execution_index` + 1.

In `createWorkflowRuntime`, after reading `taskRows` for the resumed case (around line 259-267):

```typescript
const taskRows = getTasksByRunId(db, existingRunId)
const taskStates = new Map<string, TaskState>()
const compoundTaskIds = new Map<string, string>()
let maxExecutionIndex = 0
for (const task of taskRows) {
  const state = task.status as TaskState
  compoundTaskIds.set(task.task_name, task.id)
  taskStates.set(task.task_name, state)
  if (task.execution_index > maxExecutionIndex) maxExecutionIndex = task.execution_index
}
```

And pass `maxExecutionIndex + 1` to the constructor.

- [ ] **Step 4: Update initial insert to use task_name and execution_index**

In the new-run path of `createWorkflowRuntime` (around line 287-304), replace the insert logic:

```typescript
const runId = buildRunId(spec.metadata.name)

insertRun(db, runId, spec.metadata.name, new Date().toISOString())
const taskEntries = collectAllTaskNames(spec)
const sorted = topologicalSort(
  collectReachableTasks(spec.spec.tasks, spec.spec.run.entrypoint)
)
const sortedNames = new Set(sorted.map(t => t.name))
const allTasks = taskEntries.map((t, i) => ({
  taskName: t.taskName,
  agentName: t.agentName,
  executionIndex: sortedNames.has(t.taskName) ? sorted.findIndex(s => s.name === t.taskName) : taskEntries.length + i
}))
insertTasks(db, runId, allTasks)
updateRunContext(db, runId, JSON.stringify(context))

const taskRows = getTasksByRunId(db, runId)
const taskStates = new Map<string, TaskState>()
const compoundTaskIds = new Map<string, string>()
let maxExecutionIndex = 0
for (const task of taskRows) {
  compoundTaskIds.set(task.task_name, task.id)
  taskStates.set(task.task_name, "pending")
  if (task.execution_index > maxExecutionIndex) maxExecutionIndex = task.execution_index
}

return new WorkflowRuntimeImpl(db, runId, spec, "running", taskStates, compoundTaskIds, maxExecutionIndex + 1)
```

Add the necessary import at the top:
```typescript
import { buildRunId, buildTaskId, topologicalSort, collectReachableTasks } from "../workflow/engine.js"
```

(Note: `buildRunId` and `buildTaskId` are already imported; add `topologicalSort` and `collectReachableTasks`.)

- [ ] **Step 5: Update insertDynamicTask**

Replace the existing `insertDynamicTask` method:

```typescript
insertDynamicTask(taskName: string, agentName: string): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    const taskId = buildTaskId(this._runId, taskName)
    const idx = this._nextExecutionIndex++
    insertTask(this._db, this._runId, taskId, agentName, taskName, idx)
    this._taskStates.set(taskName, "pending")
    this._compoundTaskIds.set(taskName, taskId)
  })
}
```

- [ ] **Step 6: Build to verify compilation**

Run: `bun run build`
Expected: compilation passes

- [ ] **Step 7: Run state machine tests**

Run: `bun --bun vitest run tests/workflow/run-state-machine.test.ts`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/workflow/run-state-machine.ts
git commit -m "refactor: use task_name column and execution_index in state machine, remove parseTaskSlug"
```

---

### Task 7: Add execution_index assertions to state machine tests

**Files:**
- Modify: `tests/workflow/run-state-machine.test.ts`

- [ ] **Step 1: Add assertion for execution_index on new run**

In the "starts a new run in running state" test, after line 68 (`expect(tasks[1].status).toBe("pending")`), add:

```typescript
expect(tasks[0].execution_index).toBeGreaterThanOrEqual(0)
expect(tasks[1].execution_index).toBeGreaterThanOrEqual(0)
expect(tasks[0].execution_index).not.toBe(tasks[1].execution_index)
```

- [ ] **Step 2: Add assertion for task_name on resume**

In the "resume from existing paused run skips completed tasks" test, after the resumed run is created (line 120), add:

```typescript
const resumedTasks = getTasksByRunId(resumed.db, runId)
expect(resumedTasks).toHaveLength(2)
for (const t of resumedTasks) {
  expect(t.task_name).not.toBe("")
}
```

- [ ] **Step 3: Run tests**

Run: `bun --bun vitest run tests/workflow/run-state-machine.test.ts`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add tests/workflow/run-state-machine.test.ts
git commit -m "test: verify execution_index and task_name in state machine"
```

---

### Task 8: Fix runner to use compoundTaskIds and call insertDynamicTask

**Files:**
- Modify: `src/workflow/runner.ts:124, 243-248`

- [ ] **Step 1: Use compoundTaskIds in executeSingleTask**

Replace line 124:

```typescript
const taskId = buildTaskId(runId, instanceName)
```

With:

```typescript
const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(runId, instanceName)
```

- [ ] **Step 2: Call insertDynamicTask for template instances**

In the template/forEach block (around line 230), before `yield* _(executeSingleTask(...))`, insert:

For the sub-task path after `subInstanceName` is computed (line 242):
```typescript
yield* _(ctx.insertDynamicTask(subInstanceName, subTask.agent!.executorRef))
yield* _(executeSingleTask(subTask, subContext, subInstanceName))
```

For the single-task template path (line 246):
```typescript
yield* _(ctx.insertDynamicTask(instanceName, templateTask.agent!.executorRef))
yield* _(executeSingleTask(templateTask, subContext, instanceName))
```

- [ ] **Step 3: Build to verify**

Run: `bun run build`
Expected: compilation passes

- [ ] **Step 4: Run existing runner tests**

Run: `bun --bun vitest run tests/workflow/runner.test.ts`
Expected: all tests pass (or if tests need updating, note that for next task)

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "fix: use ctx.compoundTaskIds for task IDs, insert dynamic tasks for template instances"
```

---

### Task 9: Rewrite status command — delete string parsing, drop loadSpec

**Files:**
- Modify: `src/cli/commands/status.ts` (entire file)

- [ ] **Step 1: Rewrite status.ts**

Replace the entire file with:

```typescript
import { Args, Command } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import { loadRunState, RunStateError } from "../../workflow/state.js"
import { hamiltonHome, runDir } from "../../paths.js"

export type RunStatus = import("../../workflow/state.js").RunStatus

export interface GetRunStatusOpts {
  runId: string
}

export function getRunStatus(opts: GetRunStatusOpts): Effect.Effect<RunStatus, RunStateError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new RunStateError({
        runId: opts.runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const status = yield* _(loadRunState(opts.runId))

    return status
  })
}

function computeElapsed(start: string, end?: string | null): string {
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const diffSec = Math.max(0, Math.floor((endMs - startMs) / 1000))

  if (diffSec < 60) return `${diffSec}s`

  const min = Math.floor(diffSec / 60)
  const sec = diffSec % 60
  return `${min}m ${sec}s`
}

function taskIndicator(status: string): string {
  if (status === "completed") return "\u2713"
  if (status === "running") return "\u23F3"
  if (status === "failed") return "\u2717"
  return "\u25CB"
}

export function formatStatus(status: RunStatus): string {
  const lines: string[] = []

  const elapsed = computeElapsed(status.startedAt, status.completedAt)

  lines.push(`Run folder: ${runDir(status.runId)}/`)

  if (status.status === "completed") {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    completed (${elapsed} total)`)
  } else if (status.status === "failed") {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    failed (${elapsed} elapsed)`)
  } else {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    running (${elapsed} elapsed)`)
  }

  lines.push(`Run ID:    ${status.runId}`)

  const tasks = status.tasks

  let currentTaskName: string | null = null
  if (status.currentTask) {
    const colocated = tasks.find((t) => t.taskId === status.currentTask)
    if (colocated) {
      currentTaskName = colocated.taskName
    }
  }
  if (currentTaskName) {
    const currentIdx = tasks.findIndex((t) => t.taskName === currentTaskName)
    if (currentIdx >= 0) {
      lines.push(`Task:      ${currentTaskName} (${currentIdx + 1}/${tasks.length})`)
    }
  }

  const tokensIn = status.totalTokensIn.toLocaleString()
  const tokensOut = status.totalTokensOut.toLocaleString()
  lines.push(`Tokens:    ${tokensIn} in / ${tokensOut} out`)

  if (status.errorMessage) {
    lines.push(`Errors:    ${status.errorMessage}`)
  } else {
    lines.push(`Errors:    none`)
  }

  lines.push("")
  lines.push("Tasks:")

  for (const t of tasks) {
    const isCurrent = currentTaskName !== null && t.taskName === currentTaskName
    const indicator = isCurrent ? "\u23F3" : taskIndicator(t.status)
    const isSubtask = t.taskName.includes("/")
    const indent = isSubtask ? "   " : "  "
    const agentName = isSubtask ? "" : ` (${t.taskName})`
    lines.push(`${indent}${indicator}  ${t.taskName}${agentName}`)
  }

  return lines.join("\n")
}

const runIdArg = Args.text({ name: "id" })

export const statusCommand = Command.make("status", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(getRunStatus({ runId: id }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Status not found: ${id}`)
      return
    }
    yield* Console.log(formatStatus(result.value.status))
  })
).pipe(Command.withDescription("Show run status"))
```

Key changes from original:
- Removed `parseTaskSlug` and `resolveDagBase` functions
- Removed `loadSpec` parameter and workflow spec loading
- Removed `WorkflowSpec`, `WorkflowDescriptor`, `collectReachableTasks`, `topologicalSort` imports
- `formatStatus` no longer takes `spec` — uses `taskName` directly from `RunStatus`
- Current task detection: matches `currentTask` (task ID) against `tasks[].taskId` to find the corresponding name
- Sub-task detection: `taskName.includes("/")` instead of deriving from task ID

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: compilation passes

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/status.ts
git commit -m "refactor: remove string-parsing from status, use taskName from DB"
```

---

### Task 10: Update status test file

**Files:**
- Modify: `tests/cli/status.test.ts` (entire file)

- [ ] **Step 1: Rewrite status test**

Replace the entire file with:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadRunState } from "../../src/workflow/state.js"
import { createSchema } from "../../src/db/schema.js"
import { insertRun, insertTasks, updateTaskStarted, updateTaskCompleted, updateRunCompleted, insertTokenEvent } from "../../src/db/queries.js"
import { formatStatus } from "../../src/cli/commands/status.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-status-"))
  const dp = Path.join(dir, "hamilton.db")
  const db = new Database(dp)
  ;(db as any)._tempDir = dir
  createSchema(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("loadRunState (SQLite-backed)", () => {
  let db: Database
  let origHome: string | undefined
  let tmpHome: string

  beforeEach(() => {
    db = tempDb()
    origHome = process.env.HOME
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-state-"))
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    cleanupDb(db)
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("reads run state from SQLite", async () => {
    const startedAt = "2026-01-01T00:00:00.000Z"
    insertRun(db, "run-1", "bug-fix", startedAt)
    insertTasks(db, "run-1", [
      { taskName: "triage", agentName: "triager", executionIndex: 0 },
      { taskName: "fix", agentName: "fixer", executionIndex: 1 }
    ])
    const tasks = db.prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY execution_index").all("run-1") as any[]
    const triageTaskId = tasks[0].id
    const fixTaskId = tasks[1].id

    updateTaskStarted(db, "run-1", triageTaskId, "2026-01-01T00:00:01.000Z")
    updateTaskCompleted(db, "run-1", triageTaskId, "2026-01-01T00:00:30.000Z", {
      tokensIn: 500,
      tokensOut: 200
    })
    updateTaskStarted(db, "run-1", fixTaskId, "2026-01-01T00:00:31.000Z")
    insertTokenEvent(db, "run-1", triageTaskId, "completion", 500, 200)

    const dp = Path.join(tmpHome, ".hamilton", "hamilton.db")
    const targetDb = new Database(dp)
    createSchema(targetDb)
    const sourceData = db.prepare("SELECT * FROM runs").all() as any[]
    for (const row of sourceData) {
      targetDb.prepare(
        `INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at, completed_at, current_task, error_message, context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.workflow_id, row.status, row.started_at, row.completed_at, row.current_task, row.error_message, row.context_json)
    }
    const tasksData = db.prepare("SELECT * FROM tasks").all() as any[]
    for (const row of tasksData) {
      targetDb.prepare(
        `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status, started_at, completed_at, tokens_in, tokens_out, retry_count, error_message, output_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.run_id, row.agent_id, row.task_name, row.execution_index, row.status, row.started_at, row.completed_at, row.tokens_in, row.tokens_out, row.retry_count, row.error_message, row.output_json)
    }
    const tokenData = db.prepare("SELECT * FROM token_events").all() as any[]
    for (const row of tokenData) {
      targetDb.prepare(
        `INSERT INTO token_events (run_id, task_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.run_id, row.task_id, row.event_type, row.tokens_in, row.tokens_out, row.timestamp)
    }
    targetDb.close()

    const exit = await Effect.runPromiseExit(loadRunState("run-1"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.runId).toBe("run-1")
      expect(exit.value.workflow).toBe("bug-fix")
      expect(exit.value.status).toBe("running")
      expect(exit.value.tasks).toHaveLength(2)
      expect(exit.value.tasks[0].taskName).toBe("triage")
      expect(exit.value.tasks[0].status).toBe("completed")
      expect(exit.value.tasks[1].taskName).toBe("fix")
      expect(exit.value.tasks[1].status).toBe("running")
      expect(exit.value.totalTokensIn).toBe(500)
      expect(exit.value.totalTokensOut).toBe(200)
    }
  })

  it("returns failure for non-existent run", async () => {
    const dp = Path.join(tmpHome, ".hamilton", "hamilton.db")
    const targetDb = new Database(dp)
    createSchema(targetDb)
    targetDb.close()

    const exit = await Effect.runPromiseExit(loadRunState("nonexistent"))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("formatStatus", () => {
  it("formats a running status", () => {
    const runId = "bug-fix-abc123"
    const status = {
      runId,
      workflow: "bug-fix",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      currentTask: `${runId}-fix-x4y5z`,
      tasks: [
        { taskId: `${runId}-triage-x1y2z`, taskName: "triage", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-investigate-x2y3z`, taskName: "investigate", status: "completed", startedAt: "2026-01-01T00:00:30.000Z", completedAt: "2026-01-01T00:01:00.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-setup-x3y4z`, taskName: "setup", status: "completed", startedAt: "2026-01-01T00:01:00.000Z", completedAt: "2026-01-01T00:01:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-fix-x4y5z`, taskName: "fix", status: "running", startedAt: "2026-01-01T00:01:30.000Z", completedAt: null, tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-verify-x5y6z`, taskName: "verify", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null }
      ],
      totalTokensIn: 25000,
      totalTokensOut: 8000,
      errorMessage: null
    }
    const output = formatStatus(status as any)
    expect(output).toContain("Run folder:")
    expect(output).toContain("bug-fix")
    expect(output).toContain("running")
    expect(output).toContain(runId)
    expect(output).toContain("fix (4/5)")
    expect(output).toContain("triage")
    expect(output).toContain("verify")
    expect(output).toContain("25,000")
    expect(output).toContain("8,000")
    expect(output).toContain("Errors:    none")

    const lines = output.split("\n")
    const tasksLineIdx = lines.findIndex((l) => l === "Tasks:")
    expect(tasksLineIdx).toBeGreaterThanOrEqual(0)
    expect(tasksLineIdx).toBe(lines.length - 6)

    for (const t of status.tasks) {
      const found = lines.some((l) => l.includes(t.taskName))
      expect(found).toBe(true)
    }
  })

  it("formats a completed status", () => {
    const runId = "run-done"
    const status = {
      runId,
      workflow: "test-wf",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:05:00.000Z",
      currentTask: null,
      tasks: [
        { taskId: `${runId}-task-1-abc`, taskName: "task-1", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:02:00.000Z", tokensIn: 100, tokensOut: 50, errorMessage: null }
      ],
      totalTokensIn: 100,
      totalTokensOut: 50,
      errorMessage: null
    }
    const output = formatStatus(status as any)
    expect(output).toContain("completed")
    expect(output).toContain("5m 0s total")
  })

  it("formats a failed status with error", () => {
    const runId = "run-fail"
    const status = {
      runId,
      workflow: "failing-wf",
      status: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:10.000Z",
      currentTask: null,
      tasks: [
        { taskId: `${runId}-task-1-abc`, taskName: "task-1", status: "failed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: "API error" }
      ],
      totalTokensIn: 0,
      totalTokensOut: 0,
      errorMessage: "API error"
    }
    const output = formatStatus(status as any)
    expect(output).toContain("failed")
    expect(output).toContain("API error")
  })

  it("indents subtask instances with 3 spaces", () => {
    const runId = "feature-dev-abc123"
    const status = {
      runId,
      workflow: "feature-dev",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      currentTask: `${runId}-implement-stories-0-x1y2z`,
      tasks: [
        { taskId: `${runId}-triage-x1y2z`, taskName: "triage", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-implement-stories-0-x2y3z`, taskName: "implement-stories/0", status: "running", startedAt: "2026-01-01T00:00:30.000Z", completedAt: null, tokensIn: 1000, tokensOut: 500, errorMessage: null },
        { taskId: `${runId}-implement-stories-1-x3y4z`, taskName: "implement-stories/1", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null }
      ],
      totalTokensIn: 1500,
      totalTokensOut: 700,
      errorMessage: null
    }
    const output = formatStatus(status as any)
    const lines = output.split("\n")

    const triageLine = lines.find((l) => l.includes("triage") && !l.includes("Task:"))
    expect(triageLine).toBeDefined()
    expect(triageLine!.startsWith("  ")).toBe(true)

    const subtask0 = lines.find((l) => l.includes("implement-stories/0") && !l.includes("Task:"))
    expect(subtask0).toBeDefined()
    expect(subtask0!.startsWith("   ")).toBe(true)

    const subtask1 = lines.find((l) => l.includes("implement-stories/1") && !l.includes("Task:"))
    expect(subtask1).toBeDefined()
    expect(subtask1!.startsWith("   ")).toBe(true)

    expect(triageLine).toContain("(triage)")
    expect(subtask0).not.toContain("(implement-stories/0)")
  })
})
```

Key changes from original:
- `taskSlug` → `taskName` everywhere in test data
- `agent_id` assertions replaced with `task_name` assertions
- Data copy between DBs includes `task_name` and `execution_index` columns
- Removed the string-manipulation assertion block (original lines 153-156)
- The task list test data now uses actual task names instead of agent names

- [ ] **Step 2: Run tests**

Run: `bun --bun vitest run tests/cli/status.test.ts`
Expected: all 6 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/cli/status.test.ts
git commit -m "test: update status tests for taskName, remove string-parsing assertions"
```

---

### Task 11: Full test suite and final verification

- [ ] **Step 1: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 155 tests pass (no regressions)

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: clean compilation

- [ ] **Step 3: Close the old hung process**

```bash
kill $(ps aux | grep 'hamilton workflow status' | grep -v grep | awk '{print $2}')
```

- [ ] **Step 4: Verify status command works (no freezes)**

Install the CLI and test:
```bash
bun run install-local
hamilton workflow status scaffold-4IJqg
```

Expected: should complete immediately (under 1 second), showing the run status. Since the existing run has stale data (`''` task names from before migration), it may show blank task names — that's expected for old runs.

- [ ] **Step 5: Create a fresh quick run to test with new data**

```bash
hamilton workflow run scaffold --task "create a basic node.js project called hello-world"
```
Wait for it to complete, then:
```bash
hamilton workflow status <run-id-from-output>
```

Expected: status displays immediately with correct task names ordered by execution.

- [ ] **Step 6: Commit if any final tweaks needed, or confirm all clean**

```bash
git status
```

Expected: clean working tree
