# Refactor `expandTemplate` to Pure Graph Mutation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `expandTemplate` into a pure graph mutator. Make the DB the sole source of truth for the execution DAG, introduce a `while` execution loop in `runWorkflow`, and inject `currentIteration` per-task without shared mutable state.

**Architecture:** 8-step incremental migration. Each step produces passing tests. Early steps are zero-behavioral-change (DB schema, signature changes, extracted functions). The break occurs at step 7 when `expandTemplate` stops calling `dispatchTask`.

**Tech Stack:** TypeScript, bun, Effect-TS, bun:sqlite, vitest.

---

### Task 1: DB migration 7 — add `task_def` + `dependencies`, drop `parent_task_id`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrations.ts`
- Modify: `src/db/queries.ts`
- Modify: `tests/db/queries-parent-depth.test.ts` (rename + adapt)
- Create: `tests/db/queries-task-def.test.ts`

**Goal:** Add `dependencies TEXT` and `task_def TEXT` columns. Drop `parent_task_id`. Merge `insertTaskWithParent` into `insertTask`. All callers updated to pass `depth`, `dependencies`, and `taskConfig`. Existing tests pass with zero behavioral change.

- [ ] **Step 1: Write migration + schema test for new columns and dropped column**

Create `tests/db/queries-task-def.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { Database } from "bun:sqlite"
import { migrate } from "../../src/db/migrations.js"
import { insertTask, insertTasks } from "../../src/db/queries.js"
import { buildTaskId } from "../../src/workflow/engine.js"

function tempDb(): Database {
  return new Database(":memory:")
}

describe("db migration v7 — task_def and dependencies", () => {
  it("adds task_def and dependencies columns, removes parent_task_id", () => {
    const db = tempDb()
    migrate(db)

    const info = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>
    const columns = info.map(c => c.name)

    expect(columns).toContain("task_def")
    expect(columns).toContain("dependencies")
    expect(columns).toContain("depth")
    expect(columns).not.toContain("parent_task_id")
  })

  it("stores dependencies as JSON array", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-1"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "plan")
    insertTask(db, runId, taskId, "planner", "plan", 0, 0, ["setup"], {})

    const row = db.prepare("SELECT dependencies, task_def FROM tasks WHERE id = ?").get(taskId) as { dependencies: string; task_def: string }
    expect(JSON.parse(row.dependencies)).toEqual(["setup"])
    expect(JSON.parse(row.task_def)).toEqual({})
  })

  it("stores task_def with full task config", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-2"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "build")
    const taskConfig = {
      agent: { executorRef: "builder", prompt: { content: "Build it" } },
      arguments: { forEach: { valueFrom: { ref: "inputs.parameters.items" }, as: "item" } },
      when: "inputs.parameters.go == true"
    }
    insertTask(db, runId, taskId, "builder", "build", 0, 1, [], taskConfig)

    const row = db.prepare("SELECT task_def FROM tasks WHERE id = ?").get(taskId) as { task_def: string }
    const parsed = JSON.parse(row.task_def)
    expect(parsed.agent.executorRef).toBe("builder")
    expect(parsed.arguments.forEach.as).toBe("item")
    expect(parsed.when).toBe("inputs.parameters.go == true")
  })

  it("empty dependencies stored as []", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-3"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "leaf")
    insertTask(db, runId, taskId, "agent", "leaf", 0, 0, [], {})

    const row = db.prepare("SELECT dependencies FROM tasks WHERE id = ?").get(taskId) as { dependencies: string }
    expect(JSON.parse(row.dependencies)).toEqual([])
  })

  it("insertTasks batch stores all rows", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-4"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    insertTasks(db, runId, [
      { taskName: "a", agentName: "agent-a", executionIndex: 0, depth: 0, dependencies: [], taskConfig: { agent: { executorRef: "agent-a", prompt: { content: "A" } } } },
      { taskName: "b", agentName: "agent-b", executionIndex: 1, depth: 0, dependencies: ["a"], taskConfig: { agent: { executorRef: "agent-b", prompt: { content: "B" } } } }
    ])

    const rows = db.prepare("SELECT task_name, dependencies, task_def FROM tasks WHERE run_id = ? ORDER BY execution_index").all(runId) as Array<{ task_name: string; dependencies: string; task_def: string }>
    expect(rows.length).toBe(2)
    expect(rows[0].task_name).toBe("a")
    expect(JSON.parse(rows[0].dependencies)).toEqual([])
    expect(rows[1].task_name).toBe("b")
    expect(JSON.parse(rows[1].dependencies)).toEqual(["a"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/db/queries-task-def.test.ts`
Expected: FAIL — migration 7 not defined, `insertTask` doesn't accept new params.

- [ ] **Step 3: Update TaskRow type in `src/db/queries.ts`**

Remove `parent_task_id` from `TaskRow`. Add `dependencies` and `task_def`:

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
  depth: number
  dependencies: string | null
  task_def: string | null
}
```

- [ ] **Step 4: Update schema in `src/db/schema.ts`**

Replace the `tasks` table definition to include `dependencies TEXT` and `task_def TEXT`, remove `parent_task_id`:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_name TEXT NOT NULL DEFAULT '',
  execution_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  output_json TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  dependencies TEXT,
  task_def TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

- [ ] **Step 5: Add migration 7 in `src/db/migrations.ts`**

Add to `MIGRATIONS`:

```typescript
7: (db) => {
  try { db.exec("ALTER TABLE tasks ADD COLUMN dependencies TEXT") }
  catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  try { db.exec("ALTER TABLE tasks ADD COLUMN task_def TEXT") }
  catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
}
```

- [ ] **Step 6: Merge `insertTaskWithParent` into `insertTask` in `src/db/queries.ts`**

Replace both functions with a single unified `insertTask`:

```typescript
export function insertTask(
  db: Database,
  runId: string,
  taskId: string,
  agentName: string,
  taskName: string,
  executionIndex: number,
  depth: number,
  dependencies: string[],
  taskConfig: Record<string, unknown>
): void {
  db.prepare(
    `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status, depth, dependencies, task_def) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(taskId, runId, agentName, taskName, executionIndex, depth, JSON.stringify(dependencies), JSON.stringify(taskConfig))
}
```

Remove `insertTaskWithParent` entirely.

- [ ] **Step 7: Update `insertTasks` in `src/db/queries.ts`**

Change signature to include `depth` and `taskConfig`:

```typescript
export function insertTasks(
  db: Database,
  runId: string,
  tasks: Array<{
    taskName: string
    agentName: string
    executionIndex: number
    depth: number
    dependencies: string[]
    taskConfig: Record<string, unknown>
  }>
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status, depth, dependencies, task_def) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  )
  for (const task of tasks) {
    stmt.run(buildTaskId(runId, task.taskName), runId, task.agentName, task.taskName, task.executionIndex, task.depth, JSON.stringify(task.dependencies), JSON.stringify(task.taskConfig))
  }
}
```

- [ ] **Step 8: Update `updateRunEnv` to set `task_def` + `dependencies` for resume path**

In `updateRunEnv` (queries.ts), add `task_def` and `dependencies` columns to the SELECT/UPDATE path if present. For now, the resume path columns auto-NULL since we're adding columns via ALTER TABLE.

- [ ] **Step 9: Update old `insertTask` callers to the new signature**

Find all callers of the old `insertTask` and `insertTaskWithParent`:
- `insertDynamicTask` in `run-state-machine.ts` (update in Task 2 — leave for now, it still has the old signature)
- Any test files calling `insertTask` or `insertTaskWithParent` directly

Update `tests/db/queries-parent-depth.test.ts` to use the new unified `insertTask`:

```typescript
import { insertTask } from "../../src/db/queries.js"

describe("db migration v7 — depth and dependencies", () => {
  it("existing rows default to depth 0", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-1"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "plan")
    insertTask(db, runId, taskId, "planner", "plan", 0, 0, [], {})

    const row = db.prepare("SELECT depth, dependencies FROM tasks WHERE id = ?").get(taskId) as { depth: number; dependencies: string | null }
    expect(row.depth).toBe(0)
    expect(JSON.parse(row.dependencies ?? "[]")).toEqual([])
  })

  it("can store depth via insertTask", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-2"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "child")
    insertTask(db, runId, taskId, "child-agent", "child", 1, 3, ["parent"], {})

    const row = db.prepare("SELECT depth, dependencies FROM tasks WHERE id = ?").get(taskId) as { depth: number; dependencies: string }
    expect(row.depth).toBe(3)
    expect(JSON.parse(row.dependencies)).toEqual(["parent"])
  })
})
```

Rename the test file: `mv tests/db/queries-parent-depth.test.ts tests/db/queries-depth-deps.test.ts`

- [ ] **Step 10: Remove `parent_task_id` from `insertDynamicTask` in `src/workflow/run-state-machine.ts`**

Update `insertDynamicTask` to use the new unified `insertTask`:

```typescript
insertDynamicTask(taskName: string, agentName: string, depth: number, dependencies: string[] = [], taskConfig: Record<string, unknown> = {}): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    const taskId = buildTaskId(this._runId, taskName)
    const idx = this._nextExecutionIndex++
    insertTask(this._db, this._runId, taskId, agentName, taskName, idx, depth, dependencies, taskConfig)
    this._taskStates.set(taskName, "pending")
    this._compoundTaskIds.set(taskName, taskId)
  })
}
```

Remove the old DB query for parent depth — depth is now passed directly.

- [ ] **Step 11: Update `getTaskDepth` in `src/workflow/run-state-machine.ts`**

Update to read `depth` column directly (no parent chain walk needed, but depth already comes from DB row). Keep as-is since it already reads from the `depth` column.

- [ ] **Step 12: Run all tests**

Run: `bun --bun vitest run`
Expected: All tests pass. Insertions work with new columns. Migration creates columns. Old `parent_task_id` references are gone.

Note: `createWorkflowRuntime` and `expandTemplate` still compile with old signatures since they call `insertDynamicTask` with old args. We update them in Task 2.

- [ ] **Step 13: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts src/db/queries.ts src/workflow/run-state-machine.ts tests/db/queries-depth-deps.test.ts tests/db/queries-task-def.test.ts
git rm tests/db/queries-parent-depth.test.ts
git commit -m "feat(db): add task_def + dependencies columns, drop parent_task_id, unify insertTask"
```

---

### Task 2: Pass full task config at insertion time

**Files:**
- Modify: `src/workflow/run-state-machine.ts:229-247, 314-320`
- Modify: `src/workflow/template-expander.ts` (pass empty config stubs for now)
- Modify: `tests/workflow/runner.test.ts` (no change needed, specs use `makeSpec`)

**Goal:** `createWorkflowRuntime` serializes full task config into `task_def`. `expandTemplate` passes empty stubs for now (refactored in Task 5). All existing tests pass.

- [ ] **Step 1: Write test for `collectAllTasksFromDb` reading back config**

Add to `tests/workflow/runner.test.ts` after the existing template tests:

```typescript
it("stores task_def in DB and reads back task config from collectAllTasksFromDb", async () => {
  const spec: WorkflowSpec = {
    metadata: { version: 1, name: "task-def-test" },
    spec: {
      run: { entrypoint: "check", timeout: "300s" },
      tasks: [
        { name: "build", agent: { executorRef: "builder", prompt: { content: "Build" } } },
        {
          name: "check",
          dependencies: ["build"],
          agent: { executorRef: "checker", prompt: { content: "Check" } },
          when: "inputs.tasks.build.outputs.status == 'done'"
        }
      ]
    },
    agentRegistry: new Map([
      ["builder", makeAgentManifest("builder")],
      ["checker", makeAgentManifest("checker")]
    ])
  }
  const result = await Effect.runPromise(
    Effect.scoped(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    ).pipe(Effect.provide(EventBusLive))
  )
  expect(result.status).toBe("completed")
  expect(result.taskResults["build"]).toBe("done")
  expect(result.taskResults["check"]).toBe("done")
})
```

This test verifies the task_def is stored and read correctly by `collectAllTasksFromDb`. It passes because the stored task config includes `dependencies`, `agent`, `when` — everything needed for dispatch.

- [ ] **Step 2: Run test to verify it fails (collectAllTasksFromDb doesn't exist yet)**

Run: `bun --bun vitest run tests/workflow/runner.test.ts -t "stores task_def in DB"`
Expected: FAIL — `collectAllTasksFromDb` not yet created.

- [ ] **Step 3: Update `collectAllTaskNames` to `collectLeafTaskDefs` in `src/workflow/run-state-machine.ts`**

Replace the `collectAllTaskNames` function with one that includes full config:

```typescript
function collectLeafTaskDefs(
  spec: WorkflowSpec,
  runId: string
): Array<{ taskName: string; agentName: string; taskId: string; executionIndex: number; depth: number; dependencies: string[]; taskConfig: Record<string, unknown> }> {
  const result: ReturnType<typeof collectLeafTaskDefs> = []
  let idx = 0

  function walk(tasks: WorkflowSpec["spec"]["tasks"]): void {
    for (const t of tasks) {
      const agentName = t.agent?.executorRef ?? (t.script ? "script" : "unknown")
      result.push({
        taskName: t.name,
        agentName,
        taskId: buildTaskId(runId, t.name),
        executionIndex: idx++,
        depth: 0,
        dependencies: t.dependencies ?? [],
        taskConfig: {
          agent: t.agent ?? undefined,
          script: t.script ?? undefined,
          template: t.template ?? undefined,
          arguments: t.arguments ?? undefined,
          when: t.when ?? undefined,
          tasks: t.tasks ?? undefined
        }
      })
      if (t.tasks) {
        walk(t.tasks)
      }
    }
  }

  walk(spec.spec.tasks)
  return result
}
```

- [ ] **Step 4: Update `createWorkflowRuntime` to use new function**

In `createWorkflowRuntime`, replace:

```typescript
const taskEntries = collectAllTaskNames(spec)
insertTasks(db, runId, taskEntries.map((t, i) => ({ taskName: t.taskName, agentName: t.agentName, executionIndex: i })))
```

With:

```typescript
const taskEntries = collectLeafTaskDefs(spec, runId)
insertTasks(db, runId, taskEntries.map(t => ({
  taskName: t.taskName,
  agentName: t.agentName,
  executionIndex: t.executionIndex,
  depth: t.depth,
  dependencies: t.dependencies,
  taskConfig: t.taskConfig
})))
```

Also update the resume path (existingRunId) — the compoundTaskIds populate still works since we read `getTasksByRunId` to get task_name → id mapping.

- [ ] **Step 5: Create `collectAllTasksFromDb` in `src/workflow/runner.ts`**

Add function near the top of `runner.ts` (before `runWorkflow`):

```typescript
import { getTasksByRunId } from "../db/queries.js"

function collectAllTasksFromDb(ctx: WorkflowRuntime): WorkflowTask[] {
  const rows = getTasksByRunId(ctx.db, ctx.runId)
  return rows
    .filter(r => r.status === "pending" || r.status === "running")
    .map(r => {
      const dependencies: string[] = r.dependencies ? JSON.parse(r.dependencies) : []
      const config = r.task_def ? JSON.parse(r.task_def) : {}
      return {
        name: r.task_name,
        dependencies,
        ...config
      }
    })
}
```

Import `WorkflowTask` from types and `WorkflowRuntime` from run-state-machine.

- [ ] **Step 6: Run task_def test**

Run: `bun --bun vitest run tests/workflow/runner.test.ts -t "stores task_def in DB"`
Expected: PASS. The task_def is stored on insert and read back by `collectAllTasksFromDb`.

- [ ] **Step 7: Run full test suite**

Run: `bun --bun vitest run`
Expected: All ~155 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/workflow/run-state-machine.ts src/workflow/runner.ts tests/workflow/runner.test.ts
git commit -m "feat: store task_def in DB at workflow start, add collectAllTasksFromDb"
```

---

### Task 3: Add `TaskInserted` event type and subscriber

**Files:**
- Modify: `src/events/bus.ts`
- Modify: `src/observability/workflow-logger.ts`

**Goal:** Add `TaskInserted` to the `Event` union. Handle in `WorkflowLogger` by writing to `events.jsonl`. No publisher yet — zero behavioral change.

- [ ] **Step 1: Write subscriber test**

Add to `tests/workflow/runner.test.ts`:

```typescript
it("publishes TaskInserted events when template expands", async () => {
  const spec: WorkflowSpec = {
    metadata: { version: 1, name: "task-inserted-event" },
    spec: {
      run: { entrypoint: "process", timeout: "300s" },
      tasks: [
        {
          name: "process",
          template: "step",
          arguments: { forEach: { valueFrom: { ref: "inputs.parameters.items" }, as: "item" } }
        },
        {
          name: "step",
          tasks: [
            { name: "build", agent: { executorRef: "builder", prompt: { content: "Build" } } }
          ]
        }
      ]
    },
    agentRegistry: new Map([["builder", makeAgentManifest("builder")]])
  }
  const events = await collectEvents(
    runWorkflow(spec, { parameters: { items: ["a"] }, project_dir: tmpHome }, { strict: false })
  )
  const inserted = events.filter(e => e._tag === "TaskInserted")
  expect(inserted.length).toBeGreaterThan(0)
  const buildInserted = inserted.find(e => e._tag === "TaskInserted" && e.taskName.includes("build"))
  expect(buildInserted).toBeDefined()
  if (buildInserted && buildInserted._tag === "TaskInserted") {
    expect(buildInserted.scopeKey).toBe("process/0")
    expect(buildInserted.depth).toBe(1)
  }
})
```

- [ ] **Step 2: Run test — verify it fails (event type not defined)**

Run: `bun --bun vitest run tests/workflow/runner.test.ts -t "publishes TaskInserted events"`
Expected: FAIL — `TaskInserted` not in Event union.

- [ ] **Step 3: Add `TaskInserted` to Event union in `src/events/bus.ts`**

Add to the `Event` type union:

```typescript
| { readonly _tag: "TaskInserted"; readonly runId: string; readonly taskId: string; readonly taskName: string; readonly scopeKey?: string; readonly depth: number }
```

- [ ] **Step 4: Add subscriber in `src/observability/workflow-logger.ts`**

Add a new `if` block for `TaskInserted`:

```typescript
if (event._tag === "TaskInserted") {
  return Effect.gen(function* (_) {
    yield* _(appendEngineLog(event.runId, {
      event: "task_inserted",
      taskId: event.taskId,
      taskName: event.taskName,
      scopeKey: event.scopeKey,
      depth: event.depth
    }))
  }).pipe(Effect.catchAll(() => Effect.void))
}
```

- [ ] **Step 5: Run test — verify it still fails (nothing publishes TaskInserted yet)**

Run: `bun --bun vitest run tests/workflow/runner.test.ts -t "publishes TaskInserted events"`
Expected: FAIL — `inserted.length` is 0 because nothing publishes the event yet. This confirms the subscriber exists but expandTemplate doesn't emit.

Skip this test for now (mark with `.skip` or remove) — it will pass in Task 5.

Remove the test added in step 1 for now (keep the event type and subscriber, just remove the test that expects TaskInserted events until Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/events/bus.ts src/observability/workflow-logger.ts
git commit -m "feat: add TaskInserted event type and subscriber"
```

---

### Task 4: Extract `handleWhenGuard` as pure function

**Files:**
- Modify: `src/workflow/when-guard.ts`
- Modify: `src/workflow/runner.ts`
- Modify: `src/workflow/template-expander.ts`

**Goal:** Extract `handleWhenGuard` — a pure function that evaluates the `when` condition. `runner.ts` handles all status transitions. The duplicate `when` block in `template-expander.ts` is replaced with a call to the pure function (status transitions stay inline there for now, removed in Task 7).

- [ ] **Step 1: Write test for pure `handleWhenGuard`**

Create `tests/workflow/when-guard.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { handleWhenGuard } from "../../src/workflow/when-guard.js"
import type { WorkflowTask, WorkflowEnv } from "../../src/types.js"

describe("handleWhenGuard", () => {
  it("returns proceed when task has no when condition", () => {
    const task: WorkflowTask = { name: "build", agent: { executorRef: "b", prompt: { content: "x" } } }
    const env: WorkflowEnv = {}
    expect(handleWhenGuard(task, env)).toBe("proceed")
  })

  it("returns skip when when condition evaluates to false", () => {
    const task: WorkflowTask = { name: "check", agent: { executorRef: "c", prompt: { content: "x" } }, when: "inputs.go == false" }
    const env: WorkflowEnv = { parameters: { go: false } }
    expect(handleWhenGuard(task, env)).toBe("skip")
  })

  it("returns proceed when when condition evaluates to true", () => {
    const task: WorkflowTask = { name: "check", agent: { executorRef: "c", prompt: { content: "x" } }, when: "inputs.parameters.go == true" }
    const env: WorkflowEnv = { parameters: { go: true } }
    expect(handleWhenGuard(task, env)).toBe("proceed")
  })

  it("returns error object for invalid when expression", () => {
    const task: WorkflowTask = { name: "check", agent: { executorRef: "c", prompt: { content: "x" } }, when: "inputs.+++" }
    const env: WorkflowEnv = {}
    const result = handleWhenGuard(task, env)
    expect(typeof result).toBe("object")
    expect((result as any)._tag).toBe("error")
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun --bun vitest run tests/workflow/when-guard.test.ts`
Expected: FAIL — `handleWhenGuard` not exported.

- [ ] **Step 3: Add `handleWhenGuard` to `src/workflow/when-guard.ts`**

```typescript
export function handleWhenGuard(
  task: WorkflowTask,
  env: WorkflowEnv
): "proceed" | "skip" | { _tag: "error"; message: string } {
  if (!task.when) return "proceed"

  try {
    const result = evaluateWhen(task.when, { inputs: env as Record<string, unknown> })
    return result ? "proceed" : "skip"
  } catch (e) {
    const msg = e instanceof WhenError ? e.message : String(e)
    return { _tag: "error", message: msg }
  }
}
```

Import `WhenError` from `../cel/evaluate.js`.

- [ ] **Step 4: Run when-guard tests**

Run: `bun --bun vitest run tests/workflow/when-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace when-block in `src/workflow/runner.ts`**

Replace lines ~122–141 (the full when-block) with:

```typescript
if (task.when) {
  const maxDepth = resolveMaxRecursionDepth()
  const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
  if (depthResult === "fail") break

  const whenResult = handleWhenGuard(task, workflowEnv)
  if (whenResult === "skip") {
    yield* _(ctx.transitionTask(task.name, "complete"))
    continue
  }
  if (typeof whenResult === "object" && whenResult._tag === "error") {
    yield* _(ctx.transitionTask(task.name, "fail"))
    yield* _(ctx.fail(whenResult.message))
    yield* _(Ref.set(workflowStatus, "failed"))
    break
  }
}
```

- [ ] **Step 6: Replace when-block in `src/workflow/template-expander.ts`**

Replace lines ~60–78 with:

```typescript
if (subTask.when) {
  const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, subInstanceName))
  if (depthResult === "fail") {
    yield* _(Ref.set(state.workflowStatus, "failed"))
    break
  }

  const whenResult = handleWhenGuard(subTask, state.workflowEnv)
  if (whenResult === "skip") {
    yield* _(ctx.transitionTask(subInstanceName, "complete"))
    continue
  }
  if (typeof whenResult === "object" && whenResult._tag === "error") {
    yield* _(ctx.transitionTask(subInstanceName, "fail"))
    yield* _(ctx.fail(whenResult.message))
    yield* _(Ref.set(state.workflowStatus, "failed"))
    break
  }
}
```

Remove the old import of `evaluateWhenCondition` from template-expander.ts (only `handleWhenGuard` is needed for `when`, but `checkRecursionDepth` is still imported).

- [ ] **Step 7: Run full test suite**

Run: `bun --bun vitest run`
Expected: All ~155 tests pass. Zero behavioral change.

- [ ] **Step 8: Commit**

```bash
git add src/workflow/when-guard.ts src/workflow/runner.ts src/workflow/template-expander.ts tests/workflow/when-guard.test.ts
git commit -m "refactor: extract pure handleWhenGuard, consolidate when-handling"
```

---

### Task 5: Refactor `expandTemplate` — return ExpansionResult, emit TaskInserted, keep dispatchTask

**Files:**
- Modify: `src/workflow/template-expander.ts`
- Modify: `src/workflow/runner.ts`
- Create: `tests/workflow/template-expander.test.ts`

**Goal:** Change `expandTemplate` signature to return `ExpansionResult`, emit `TaskInserted` events, pass resolved dependencies and full `taskConfig` to `insertDynamicTask`. **Keep calling `dispatchTask` internally** — the return value is unused by `runner.ts` at this point. Full removal of `dispatchTask` happens in Task 7.

- [ ] **Step 1: Write tests for the refactored `expandTemplate`**

Create `tests/workflow/template-expander.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Scope } from "effect"
import { EventBus, EventBusLive, Event } from "../../src/events/bus.js"
import { createWorkflowRuntime } from "../../src/workflow/run-state-machine.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  const { EventBus } = require("../../src/events/bus.js")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/prompts/system.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test" }, soul: { content: "test" }, context: { content: "" } })),
    SystemPromptFragmentsNotFoundError: class SystemPromptFragmentsNotFoundError extends Error {}
  }
})

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => "ok\n")
}))

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: { settings: { model: "default" }, systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` } },
  systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
})

describe("expandTemplate", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-expand-"))
    process.env.HOME = tmpHome
    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "agents"), { recursive: true })
    const piDir = Path.join(hh, "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("returns empty result for non-template task", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "no-template" },
      spec: {
        run: { entrypoint: "build", timeout: "300s" },
        tasks: [{ name: "build", agent: { executorRef: "b", prompt: { content: "x" } } }]
      },
      agentRegistry: new Map([["b", makeAgentManifest("b")]])
    }
    const result = await Effect.runPromise(
      Effect.scoped(Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(spec, {}, undefined).pipe(Effect.mapError(e => new Error(e.message))))
        const { expandTemplate } = yield* _(Effect.promise(() => import("../../src/workflow/template-expander.js")))
        const bus = yield* _(EventBus)
        return yield* _(expandTemplate(ctx, spec.spec.tasks[0], spec, { project_dir: tmpHome }, 0))
      })).pipe(Effect.provide(EventBusLive))
    )
    expect(result.inserted).toEqual([])
    expect(result.taskScopes).toEqual({})
    expect(result.originalNames).toEqual({})
  })

  it("inserts tasks with correct instance names for flat template", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "flat-template" },
      spec: {
        run: { entrypoint: "process", timeout: "300s" },
        tasks: [
          {
            name: "process",
            template: "step",
            arguments: { forEach: { valueFrom: { ref: "inputs.parameters.items" }, as: "item" } }
          },
          {
            name: "step",
            tasks: [
              { name: "build", agent: { executorRef: "builder", prompt: { content: "Build" } } }
            ]
          }
        ]
      },
      agentRegistry: new Map([["builder", makeAgentManifest("builder")]])
    }
    const result = await Effect.runPromise(
      Effect.scoped(Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(spec, { parameters: { items: ["a", "b"] } }, undefined).pipe(Effect.mapError(e => new Error(e.message))))
        const { expandTemplate } = yield* _(Effect.promise(() => import("../../src/workflow/template-expander.js")))
        const bus = yield* _(EventBus)
        return yield* _(expandTemplate(ctx, spec.spec.tasks[0], spec, { project_dir: tmpHome, parameters: { items: ["a", "b"] } }, 0))
      })).pipe(Effect.provide(EventBusLive))
    )
    expect(result.inserted).toEqual(["process/0-build", "process/1-build"])
    expect(result.taskScopes["process/0-build"]).toBe("process/0")
    expect(result.taskScopes["process/1-build"]).toBe("process/1")
    expect(result.originalNames["process/0-build"]).toBe("build")
    expect(result.originalNames["process/1-build"]).toBe("build")
  })

  it("resolves internal dependencies to full instance names", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "with-deps" },
      spec: {
        run: { entrypoint: "process", timeout: "300s" },
        tasks: [
          {
            name: "process",
            template: "step",
            arguments: { forEach: { valueFrom: { ref: "inputs.parameters.items" }, as: "item" } }
          },
          {
            name: "step",
            tasks: [
              { name: "build", agent: { executorRef: "builder", prompt: { content: "Build" } } },
              { name: "check", dependencies: ["build"], agent: { executorRef: "checker", prompt: { content: "Check" } } }
            ]
          }
        ]
      },
      agentRegistry: new Map([
        ["builder", makeAgentManifest("builder")],
        ["checker", makeAgentManifest("checker")]
      ])
    }
    const result = await Effect.runPromise(
      Effect.scoped(Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(spec, { parameters: { items: ["x"] } }, undefined).pipe(Effect.mapError(e => new Error(e.message))))
        const { expandTemplate } = yield* _(Effect.promise(() => import("../../src/workflow/template-expander.js")))
        const bus = yield* _(EventBus)
        return yield* _(expandTemplate(ctx, spec.spec.tasks[0], spec, { project_dir: tmpHome, parameters: { items: ["x"] } }, 0))
      })).pipe(Effect.provide(EventBusLive))
    )
    expect(result.inserted).toContain("process/0-check")
    // Verify the DB stored resolved dependency
    const rows = getTasksByRunId(ctx.db, ctx.runId) // ctx available from closure — use collected events instead
  })
})
```

> Note: `expandTemplate` still dispatches inline at this point — the test verifies `ExpansionResult` fields. Full `TaskInserted` event verification happens in Task 7 when the outer loop dispatches.

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun --bun vitest run tests/workflow/template-expander.test.ts`
Expected: FAIL — `expandTemplate` signature doesn't match (old 13-param version).

- [ ] **Step 3: Change `expandTemplate` signature and add return construction**

In `src/workflow/template-expander.ts`:

1. Add `ExpansionResult` interface and `taskConfigFrom` helper:

```typescript
export interface ExpansionResult {
  inserted: string[]
  taskScopes: Record<string, string>
  originalNames: Record<string, string>
}

function taskConfigFrom(t: WorkflowTask): Record<string, unknown> {
  return {
    agent: t.agent ?? undefined,
    script: t.script ?? undefined,
    template: t.template ?? undefined,
    arguments: t.arguments ?? undefined,
    when: t.when ?? undefined,
    tasks: t.tasks ?? undefined
  }
}
```

2. Change function signature to:

```typescript
export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  depth: number,
  namePrefix?: string
): Effect.Effect<ExpansionResult, unknown, EventBus | Scope.Scope>
```

3. At the top of the function body, add accumulator variables:

```typescript
const inserted: string[] = []
const taskScopes: Record<string, string> = {}
const originalNames: Record<string, string> = {}
```

4. In every `ctx.insertDynamicTask(...)` call (lines 82, 92, 103), change to pass depth + resolved deps + config:

   - Line 82 (`subRef = ...`): Replace with:
     ```typescript
     const resolvedDeps = (subTask.dependencies ?? []).map(dep => buildTaskInstanceName(instanceName, dep))
     const config = taskConfigFrom(subTask)
     yield* _(ctx.insertDynamicTask(subInstanceName, subRef, depth + 1, resolvedDeps, config))
     ```

   - Line 92 (`subRef = ...`): Replace with:
     ```typescript
     const resolvedDeps = (subTask.dependencies ?? []).map(dep => buildTaskInstanceName(instanceName, dep))
     const config = taskConfigFrom(subTask)
     yield* _(ctx.insertDynamicTask(subInstanceName, subRef, depth + 1, resolvedDeps, config))
     ```

   - Line 103 (`const ref = ...`): Replace with:
     ```typescript
     const resolvedDeps = (templateTask.dependencies ?? [])
     const config = taskConfigFrom(templateTask)
     yield* _(ctx.insertDynamicTask(instanceName, ref, depth + 1, resolvedDeps, config))
     ```

5. After each `insertDynamicTask`, publish `TaskInserted` and record metadata:

   ```typescript
   const taskId = ctx.compoundTaskIds.get(subInstanceName) ?? subInstanceName
   yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId, taskName: subInstanceName, scopeKey: instanceName, depth: depth + 1 }))
   inserted.push(subInstanceName)
   taskScopes[subInstanceName] = instanceName
   originalNames[subInstanceName] = subTask.name
   ```

6. At the end of the function, after the for loop closes, add:

   ```typescript
   return { inserted, taskScopes, originalNames }
   ```

7. Keep all existing `dispatchTask` calls, `when` handling, `currentIteration` save/restore, and `Ref` logic — they're removed in Task 7.

8. Remove unused params from signature (keep them as ignored for now to minimize diff). Remove `state`, `parentCompoundId`, `maxDepth`, `guidelineFiles`, `allRules`, `skillRegistry`, `templateOptions`, `scriptConfig` — replace with `depth` and `namePrefix?`.

- [ ] **Step 4: Update `runner.ts` call site to match new signature**

In `runner.ts`, update the `expandTemplate` call:

```typescript
if (task.template) {
  const maxDepth = resolveMaxRecursionDepth()
  yield* _(expandTemplate(ctx, task, spec, workflowEnv, 0))
  continue
}
```

- [ ] **Step 5: Run expandTemplate unit tests**

Run: `bun --bun vitest run tests/workflow/template-expander.test.ts`
Expected: PASS. ExpansionResult returned with correct inserted/taskScopes/originalNames.

- [ ] **Step 6: Run full test suite**

Run: `bun --bun vitest run`
Expected: All existing tests pass. `expandTemplate` still dispatches tasks inline, just with new signature and return value.

- [ ] **Step 7: Commit**

```bash
git add src/workflow/template-expander.ts src/workflow/runner.ts tests/workflow/template-expander.test.ts
git commit -m "refactor: expandTemplate returns ExpansionResult, emits TaskInserted, passes task_def to DB"
```

---

### Task 6: Add outer `while` loop to `runner.ts`

**Files:**
- Modify: `src/workflow/runner.ts`

**Goal:** Replace single-pass `for` loop with `while (pending)` loop. `collectAllTasksFromDb` feeds `topologicalSort`. Template tasks still dispatched inline by `expandTemplate`, so dynamic tasks are executed before the next loop — the loop is effectively a no-op for now. Static task behavior unchanged.

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `bun --bun vitest run tests/workflow/runner.test.ts`
Expected: All pass.

- [ ] **Step 2: Replace the `for` loop in `runner.ts` with `while (pending)`**

Replace the existing `for (const task of sortedTasks)` block (from line 118) with:

```typescript
const taskScopes: Record<string, string> = {}
const originalNames: Record<string, string> = {}
let pending = true

while (pending) {
  const allTasks = collectAllTasksFromDb(ctx)
  const sorted = topologicalSort(allTasks)
  pending = false

  for (const task of sorted) {
    const currentStatus = yield* _(Ref.get(workflowStatus))
    if (currentStatus === "failed") break

    if (task.when) {
      const maxDepth = resolveMaxRecursionDepth()
      const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
      if (depthResult === "fail") break

      const whenResult = handleWhenGuard(task, workflowEnv)
      if (whenResult === "skip") {
        yield* _(ctx.transitionTask(task.name, "complete"))
        continue
      }
      if (typeof whenResult === "object" && whenResult._tag === "error") {
        yield* _(ctx.transitionTask(task.name, "fail"))
        yield* _(ctx.fail(whenResult.message))
        yield* _(Ref.set(workflowStatus, "failed"))
        break
      }
    }

    if (task.template) {
      const result = yield* _(expandTemplate(ctx, task, spec, workflowEnv, 0))
      Object.assign(taskScopes, result.taskScopes)
      Object.assign(originalNames, result.originalNames)
      yield* _(ctx.transitionTask(task.name, "complete"))
      pending = true
      break
    }

    if (!task.agent && !task.script) continue

    const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
    if (!shouldExec) continue

    const shouldPauseResult = yield* _(ctx.shouldPause())
    if (shouldPauseResult) {
      yield* _(bus.publish({ _tag: "TaskPaused", runId: ctx.runId, taskId: task.name, taskName: task.name }))
      yield* _(Ref.set(workflowStatus, "paused"))
      break
    }

    const resolvedArgs = resolveArguments(task, workflowEnv)
    const taskEnv: WorkflowEnv = {
      ...workflowEnv,
      parameters: resolvedArgs.parameters
    }
    yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))
  }
}
```

Remove the old `const staticTasks = collectReachableTasks(...)` and `const sortedTasks = topologicalSort(...)` at the top (lines ~48-49). Remove the unused `collectReachableTasks` import.

- [ ] **Step 3: Run tests**

Run: `bun --bun vitest run`
Expected: All pass. `expandTemplate` still dispatches inline, so the loop is a no-op. Static tasks execute same as before.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "feat: add while loop to runner, collectAllTasksFromDb drives topological sort"
```

---

### Task 7: Remove `dispatchTask` from `expandTemplate`

**Files:**
- Modify: `src/workflow/template-expander.ts`

**Goal:** Delete all remaining `dispatchTask` calls, `when`-handling, failure propagation, and `currentIteration` save/restore from `expandTemplate`. The outer loop now picks up inserted tasks and dispatches them. `expandTemplate` becomes a pure graph mutator.

- [ ] **Step 1: Remove `dispatchTask` and old imports from `expandTemplate`**

The `expandTemplate` function from Task 5 already has the pure structure but still calls `dispatchTask` internally. In this step, verify that no dispatchTask calls remain, and all old state-manipulation code is gone. Since we already rewrote `expandTemplate` in Task 5 Step 3 with the pure structure, this task is primarily cleanup and verification.

Review `src/workflow/template-expander.ts` and confirm:
- No `dispatchTask` import or call
- No `Ref` import
- No `checkRecursionDepth` / `handleWhenGuard` (when-handling)
- No `currentIteration` save/restore
- Only imports: `Effect`, `EventBus`, types, `resolveArguments`, `buildTaskInstanceName`, `topologicalSort`
- Function signature: `(ctx, task, spec, env, depth, namePrefix?): Effect<ExpansionResult, never, EventBus>`

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`
Expected: Template tests pass. Dynamic tasks are now dispatched by `runner.ts`'s outer loop via `collectAllTasksFromDb` + `dispatchTask`.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/template-expander.ts
git commit -m "refactor: remove dispatchTask from expandTemplate — pure graph mutation"
```

---

### Task 8: Add per-task `currentIteration` injection to `runner.ts`

**Files:**
- Modify: `src/workflow/runner.ts`

**Goal:** Inject `currentIteration` into `taskEnv` per-task based on `taskScopes`. Accumulate outputs into `iterationOutputs`. Remove the old `currentIteration` save/restore from `expandTemplate` (already gone from Task 7).

- [ ] **Step 1: Write test for currentIteration per-task injection**

Add to `tests/workflow/runner.test.ts` (the existing `"cleans up currentIteration after template iteration completes"` and `"does not leak currentIteration between forEach iterations"` tests already exist at lines 657 and 696 — they should continue to pass):

Verify the existing tests still pass after the refactor. No new test needed — the existing tests enforce the contract.

- [ ] **Step 2: Add `iterationOutputs` accumulator and per-task injection to `runner.ts`**

Add at the top of the body Effect.gen block (near `workflowStatus` Ref creation):

```typescript
const iterationOutputs: Record<string, Record<string, { outputs: Record<string, unknown> }>> = {}
```

Replace the dispatch block inside the inner for loop (the part that builds `taskEnv` and calls `dispatchTask`) with:

```typescript
const scopeKey = taskScopes[task.name]
const resolvedArgs = resolveArguments(task, workflowEnv)
const taskEnv: WorkflowEnv = scopeKey
  ? {
      ...workflowEnv,
      currentIteration: { tasks: iterationOutputs[scopeKey] ?? {} },
      parameters: resolvedArgs.parameters
    }
  : { ...workflowEnv, parameters: resolvedArgs.parameters }

yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))

const originalName = originalNames[task.name]
const output = workflowEnv.tasks?.[task.name]
if (scopeKey && originalName && output) {
  (iterationOutputs[scopeKey] ??= {})[originalName] = output
}
```

- [ ] **Step 3: Run existing currentIteration tests**

Run: `bun --bun vitest run tests/workflow/runner.test.ts -t "currentIteration"`
Expected: Both tests pass — `currentIteration` cleaned up after template completes, no leak between iterations.

- [ ] **Step 4: Run full test suite**

Run: `bun --bun vitest run`
Expected: All ~155 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "feat: per-task currentIteration injection via taskScopes, no shared mutable state"
```

---

### Task 9: Final cleanup and verification

**Files:**
- Modify: `src/workflow/runner.ts` (remove unused imports)
- Run: `bun run build` (typecheck)

- [ ] **Step 1: Remove unused imports from `src/workflow/runner.ts`**

Remove `collectReachableTasks` from imports (no longer called). Remove `checkRecursionDepth` if it's only used in `handleWhenGuard` (it's still called directly in runner.ts — keep it). Remove any other dead imports.

- [ ] **Step 2: Run typecheck**

Run: `bun run build`
Expected: No errors.

- [ ] **Step 3: Run full test suite one final time**

Run: `bun --bun vitest run`
Expected: All ~155 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "chore: clean up dead imports after template-expander refactor"
```
