# Composite Task Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `forEach` iteration ordering by modeling task groups as first-class composite nodes with drain-complete semantics, so `implementTask·0` (code→test→verify→feedback) fully drains before `implementTask·1` starts.

**Architecture:** Add `kind` (leaf/composite) and `parent_task_name` columns to the tasks table. The template expander creates composite boundaries (the iteration wrappers) with cross-iteration ordering edges instead of flat leaves. The runner loop gains a composite drain barrier filter: a task is only eligible if its parent composite is active. Composites drain when all descendants complete; drain enables successors via the existing topological sort. The manual `taskScopes`/`iterationOutputs`/`currentIteration` plumbing is removed — composite structure encodes iteration ownership.

**Tech Stack:** TypeScript, Effect-TS, bun:sqlite, vitest

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | Add `kind` field to `WorkflowTask` |
| `src/db/schema.ts` | Modify | Add `kind` and `parent_task_name` columns to tasks CREATE TABLE |
| `src/db/migrations.ts` | Modify | Add migration v9 for new columns |
| `src/db/queries.ts` | Modify | Add `kind` and `parent_task_name` to `TaskRow`, new queries: `getChildrenOfTask`, `hasPendingDescendants` |
| `src/workflow/engine.ts` | Modify | Add `isTaskEligible()` composite drain barrier |
| `src/workflow/template-expander.ts` | Modify | Create composite boundaries + children instead of flat leaves |
| `src/workflow/run-state-machine.ts` | Modify | Add `parent_task_name` to `insertDynamicTask`, update `collectLeafTaskDefs` to seed composite kinds |
| `src/workflow/runner.ts` | Modify | Composite-aware loop, eligibility filter, drain checking, remove manual `taskScopes`/`iterationOutputs` |
| `tests/workflow/composite-nodes.test.ts` | Create | Sequential ordering, drain, feedback loop, regression tests |
| `tests/db/queries.test.ts` | Modify | Test new columns and `getChildrenOfTask`, `hasPendingDescendants` |

---

### Task 1: Add `kind` to WorkflowTask type

**Files:**
- Modify: `src/types.ts:98-107`

- [ ] **Step 1: Add `kind` field to the `WorkflowTask` interface**

```typescript
export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  script?: TaskScript
  template?: string
  arguments?: Arguments
  tasks?: WorkflowTask[]
  when?: string
  kind?: "leaf" | "composite"
}
```

- [ ] **Step 2: Run build to verify no breaking compilation errors**

Run: `bun run build`
Expected: PASS (no type errors — `kind` is optional so all existing code compiles)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add kind field to WorkflowTask for composite node support"
```

---

### Task 2: Add `kind` and `parent_task_name` columns to DB schema

**Files:**
- Modify: `src/db/schema.ts:17-35`
- Modify: `src/db/migrations.ts`

- [ ] **Step 1: Update the CREATE TABLE statement in schema.ts**

```typescript
// In src/db/schema.ts, update the tasks CREATE TABLE:
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
  kind TEXT NOT NULL DEFAULT 'leaf',
  parent_task_name TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

- [ ] **Step 2: Add migration v9 in migrations.ts**

```typescript
// Add after migration 8 in the MIGRATIONS record:
9: (db) => {
  try { db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'leaf'") }
  catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  try { db.exec("ALTER TABLE tasks ADD COLUMN parent_task_name TEXT") }
  catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
},
```

- [ ] **Step 3: Run existing DB tests to verify migration works**

Run: `bun --bun vitest run tests/db/migrations.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts
git commit -m "feat: add kind and parent_task_name columns to tasks table (migration v9)"
```

---

### Task 3: Update DB queries for composite support

**Files:**
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Add `kind` and `parent_task_name` to `TaskRow` interface**

```typescript
// At src/db/queries.ts:16-33, add two fields:
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
  kind: string
  parent_task_name: string | null
}
```

- [ ] **Step 2: Add `getChildrenOfTask` query**

```typescript
export function getChildrenOfTask(db: Database, runId: string, parentTaskName: string): TaskRow[] {
  return db.prepare(
    `SELECT * FROM tasks WHERE run_id = ? AND parent_task_name = ?`
  ).all(runId, parentTaskName) as TaskRow[]
}
```

- [ ] **Step 3: Add `hasPendingDescendants` query for drain checking**

Uses a recursive CTE to find any pending/running task in the subtree:

```typescript
export function hasPendingDescendants(db: Database, runId: string, taskName: string): boolean {
  const row = db.prepare(`
    WITH RECURSIVE subtree AS (
      SELECT task_name, status FROM tasks WHERE run_id = ? AND task_name = ?
      UNION ALL
      SELECT t.task_name, t.status FROM tasks t
      JOIN subtree s ON t.parent_task_name = s.task_name
      WHERE t.run_id = ?
    )
    SELECT 1 FROM subtree WHERE task_name != ? AND status IN ('pending', 'running') LIMIT 1
  `).get(runId, taskName, runId, taskName) as { "1": number } | null
  return row !== null
}
```

- [ ] **Step 4: Write DB query tests**

Create these tests in `tests/db/queries.test.ts` (append to the existing describe block):

```typescript
it("stores and retrieves kind and parent_task_name", () => {
  const db = tempDb()
  createSchema(db)
  insertRun(db, "run-1", "test", new Date().toISOString())
  const taskId = buildTaskId("run-1", "parent-task")
  insertTask(db, "run-1", taskId, "planner", "parent-task", 0, 0, [], { kind: "composite" })
  const childId = buildTaskId("run-1", "child-task")
  insertTask(db, "run-1", childId, "coder", "child-task", 1, 1, [], { kind: "leaf" })
  db.prepare("UPDATE tasks SET kind = 'composite' WHERE id = ?").run(taskId)
  db.prepare("UPDATE tasks SET parent_task_name = 'parent-task' WHERE id = ?").run(childId)

  const parent = db.prepare("SELECT kind FROM tasks WHERE id = ?").get(taskId) as { kind: string }
  expect(parent.kind).toBe("composite")

  const children = getChildrenOfTask(db, "run-1", "parent-task")
  expect(children.length).toBe(1)
  expect(children[0]!.task_name).toBe("child-task")
  expect(children[0]!.parent_task_name).toBe("parent-task")
})

it("hasPendingDescendants returns true when child is pending", () => {
  const db = tempDb()
  createSchema(db)
  insertRun(db, "run-1", "test", new Date().toISOString())

  const parentId = buildTaskId("run-1", "parent")
  insertTask(db, "run-1", parentId, "planner", "parent", 0, 0, [], { kind: "composite" })
  db.prepare("UPDATE tasks SET kind = 'composite' WHERE id = ?").run(parentId)

  const childId = buildTaskId("run-1", "child")
  insertTask(db, "run-1", childId, "coder", "child", 1, 1, [], { kind: "leaf" })
  db.prepare("UPDATE tasks SET parent_task_name = 'parent' WHERE id = ?").run(childId)

  expect(hasPendingDescendants(db, "run-1", "parent")).toBe(true)
})

it("hasPendingDescendants returns false when all children completed", () => {
  const db = tempDb()
  createSchema(db)
  insertRun(db, "run-1", "test", new Date().toISOString())

  const parentId = buildTaskId("run-1", "parent")
  insertTask(db, "run-1", parentId, "planner", "parent", 0, 0, [], { kind: "composite" })
  db.prepare("UPDATE tasks SET kind = 'composite' WHERE id = ?").run(parentId)

  const childId = buildTaskId("run-1", "child")
  insertTask(db, "run-1", childId, "coder", "child", 1, 1, [], { kind: "leaf" })
  db.prepare("UPDATE tasks SET parent_task_name = 'parent', status = 'completed' WHERE id = ?").run(childId)

  expect(hasPendingDescendants(db, "run-1", "parent")).toBe(false)
})

it("hasPendingDescendants works with nested composites", () => {
  const db = tempDb()
  createSchema(db)
  insertRun(db, "run-1", "test", new Date().toISOString())

  const grandparentId = buildTaskId("run-1", "grandparent")
  insertTask(db, "run-1", grandparentId, "planner", "grandparent", 0, 0, [], { kind: "composite" })
  db.prepare("UPDATE tasks SET kind = 'composite' WHERE id = ?").run(grandparentId)

  const parentId = buildTaskId("run-1", "parent")
  insertTask(db, "run-1", parentId, "planner", "parent", 1, 1, [], { kind: "composite" })
  db.prepare("UPDATE tasks SET kind = 'composite', parent_task_name = 'grandparent' WHERE id = ?").run(parentId)

  const childId = buildTaskId("run-1", "child")
  insertTask(db, "run-1", childId, "coder", "child", 2, 2, [], { kind: "leaf" })
  db.prepare("UPDATE tasks SET parent_task_name = 'parent', status = 'pending' WHERE id = ?").run(childId)

  expect(hasPendingDescendants(db, "run-1", "grandparent")).toBe(true)

  db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(childId)
  expect(hasPendingDescendants(db, "run-1", "grandparent")).toBe(false)
})
```

Note: These tests require importing the `tempDb` helper and `createSchema` from the existing test file patterns. Add the import of `getChildrenOfTask` and `hasPendingDescendants` from `../../src/db/queries.js`.

- [ ] **Step 5: Run DB query tests**

Run: `bun --bun vitest run tests/db/queries.test.ts`
Expected: All tests PASS (existing + new)

- [ ] **Step 6: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts
git commit -m "feat: add composite DB queries (getChildrenOfTask, hasPendingDescendants)"
```

---

### Task 4: Add composite drain barrier filter to engine

**Files:**
- Modify: `src/workflow/engine.ts`

- [ ] **Step 1: Write failing tests for `isTaskEligible`**

```typescript
// In tests/workflow/engine.test.ts, add after existing tests:

import { isTaskEligible } from "../../src/workflow/engine.js"

it("top-level task is always eligible", () => {
  expect(isTaskEligible({ name: "plan", agent: { executorRef: "planner", prompt: { content: "" } } }, new Map())).toBe(true)
})

it("child of running composite is eligible", () => {
  const parentStates = new Map<string, string>()
  parentStates.set("applyPlan", "running")
  expect(isTaskEligible({ name: "applyPlan/0-code", agent: { executorRef: "coder", prompt: { content: "" } } }, parentStates, "applyPlan/0")).toBe(true)
})

it("child of pending composite is NOT eligible", () => {
  const parentStates = new Map<string, string>()
  parentStates.set("applyPlan", "running")
  parentStates.set("applyPlan/0", "pending")
  expect(isTaskEligible({ name: "applyPlan/0-code", agent: { executorRef: "coder", prompt: { content: "" } } }, parentStates, "applyPlan/0")).toBe(false)
})

it("child of completed composite is NOT eligible", () => {
  const parentStates = new Map<string, string>()
  parentStates.set("applyPlan/0", "completed")
  expect(isTaskEligible({ name: "applyPlan/0-code", agent: { executorRef: "coder", prompt: { content: "" } } }, parentStates, "applyPlan/0")).toBe(false)
})

it("composite itself is eligible when pending (so it can be entered)", () => {
  const parentStates = new Map<string, string>()
  expect(isTaskEligible({ name: "applyPlan/0", kind: "composite" }, parentStates)).toBe(true)
})

it("composite with parent is eligible when parent is running", () => {
  const parentStates = new Map<string, string>()
  parentStates.set("applyPlan", "running")
  expect(isTaskEligible({ name: "applyPlan/0", kind: "composite", dependencies: [] }, parentStates, "applyPlan")).toBe(true)
})

it("composite with parent is NOT eligible when parent is pending", () => {
  const parentStates = new Map<string, string>()
  parentStates.set("applyPlan", "pending")
  expect(isTaskEligible({ name: "applyPlan/0", kind: "composite", dependencies: [] }, parentStates, "applyPlan")).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/workflow/engine.test.ts`
Expected: FAIL — `isTaskEligible is not defined`

- [ ] **Step 3: Implement `isTaskEligible` in `src/workflow/engine.ts`**

```typescript
export function isTaskEligible(
  task: { name: string; kind?: string },
  compositeStates: Map<string, string>,
  parentTaskName?: string | null
): boolean {
  if (!parentTaskName) return true

  const parentState = compositeStates.get(parentTaskName)
  if (!parentState) return true

  return parentState === "running"
}
```

The `compositeStates` map tracks the status of every composite task. The runner populates it from the DB (all tasks with `kind = 'composite'` from `getTasksByRunId`). A task is eligible if it has no parent, or if its parent composite is `running` (entered but not yet drained).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/workflow/engine.test.ts`
Expected: PASS (all existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add src/workflow/engine.ts tests/workflow/engine.test.ts
git commit -m "feat: add isTaskEligible composite drain barrier filter"
```

---

### Task 5: Update run-state-machine for composite support

**Files:**
- Modify: `src/workflow/run-state-machine.ts`

Three changes needed:
1. `insertDynamicTask` accepts `parentTaskName` and `kind`
2. `collectLeafTaskDefs` sets `kind: "composite"` for tasks with `forEach` or nested `tasks`
3. Add `enterComposite` method to `WorkflowRuntime`

- [ ] **Step 1: Update the `WorkflowRuntime` interface to add `enterComposite` and extend `insertDynamicTask`**

```typescript
// In the WorkflowRuntime interface (line 53-69), update insertDynamicTask and add enterComposite:
export interface WorkflowRuntime {
  readonly db: Database
  readonly runId: string
  readonly state: RunState
  readonly spec: WorkflowSpec
  readonly compoundTaskIds: ReadonlyMap<string, string>

  readonly shouldExecuteTask: (taskName: string) => Effect.Effect<boolean, EngineError>
  readonly shouldPause: () => Effect.Effect<boolean, EngineError>
  readonly transitionTask: (taskName: string, transition: "start" | "complete" | "fail") => Effect.Effect<void, EngineError>
  readonly insertDynamicTask: (taskName: string, agentName: string, depth: number, dependencies?: string[], taskConfig?: Record<string, unknown>, parentTaskName?: string, kind?: "leaf" | "composite") => Effect.Effect<void, EngineError>
  readonly enterComposite: (taskName: string) => Effect.Effect<void, EngineError>
  readonly getTaskDepth: (taskName: string) => Effect.Effect<number | null, EngineError>
  readonly pause: () => Effect.Effect<void, EngineError>
  readonly complete: () => Effect.Effect<void, EngineError>
  readonly fail: (error: string) => Effect.Effect<void, EngineError>
  readonly close: () => Effect.Effect<void>
}
```

- [ ] **Step 2: Update `insertDynamicTask` implementation to accept `parentTaskName` and `kind`**

```typescript
// In WorkflowRuntimeImpl class (line 141-149):
insertDynamicTask(taskName: string, agentName: string, depth: number, dependencies: string[] = [], taskConfig: Record<string, unknown> = {}, parentTaskName?: string, kind: "leaf" | "composite" = "leaf"): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    const taskId = buildTaskId(this._runId, taskName)
    const idx = this._nextExecutionIndex++
    insertTask(this._db, this._runId, taskId, agentName, taskName, idx, depth, dependencies, taskConfig)
    if (parentTaskName) {
      this._db.prepare("UPDATE tasks SET parent_task_name = ? WHERE id = ?").run(parentTaskName, taskId)
    }
    if (kind === "composite") {
      this._db.prepare("UPDATE tasks SET kind = 'composite' WHERE id = ?").run(taskId)
    }
    this._taskStates.set(taskName, "pending")
    this._compoundTaskIds.set(taskName, taskId)
  })
}
```

- [ ] **Step 3: Add `enterComposite` method to `WorkflowRuntimeImpl`**

```typescript
// Add after insertDynamicTask in the WorkflowRuntimeImpl class:
enterComposite(taskName: string): Effect.Effect<void, EngineError> {
  return Effect.gen(this, function* (_) {
    const currentTaskState = this._taskStates.get(taskName) ?? "pending"
    if (currentTaskState !== "pending") {
      return yield* Effect.fail(
        new EngineError({
          runId: this._runId,
          message: `Cannot enter composite ${taskName}: current state is ${currentTaskState}`
        })
      )
    }

    const compoundId = this._compoundTaskIds.get(taskName) ?? taskName
    const now = new Date().toISOString()
    updateTaskStarted(this._db, this._runId, compoundId, now)
    this._taskStates.set(taskName, "running")
  })
}
```

- [ ] **Step 4: Update `collectLeafTaskDefs` to propagate composite kinds**

In `collectLeafTaskDefs`, only set `kind: "composite"` in `taskConfig` when the task has `template` + `arguments.forEach`, or has nested `tasks`. The children of composites also need their `kind` set.

```typescript
// In collectLeafTaskDefs (line 221-255), update the taskConfig construction:
function collectLeafTaskDefs(
  spec: WorkflowSpec,
  runId: string
): Array<{ taskName: string; agentName: string; taskId: string; executionIndex: number; depth: number; dependencies: string[]; taskConfig: Record<string, unknown> }> {
  const result: ReturnType<typeof collectLeafTaskDefs> = []
  let idx = 0

  function walk(tasks: WorkflowSpec["spec"]["tasks"], parentTaskName?: string): void {
    for (const t of tasks) {
      const agentName = t.agent?.executorRef ?? (t.script ? "script" : "unknown")
      const isComposite = !!(t.tasks && t.tasks.length > 0) || !!(t.template && t.arguments?.forEach)
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
          tasks: t.tasks ?? undefined,
          kind: isComposite ? "composite" : "leaf"
        }
      })
      if (t.tasks) {
        walk(t.tasks, t.name)
      }
    }
  }

  walk(spec.spec.tasks)
  return result
}
```

Note: The `parentTaskName` parameter is passed through but since template definitions (like `implementTask` and its children `code`, `test`, etc.) are not part of the reachable set, they get marked complete early in the runner. The actual parent-child relationships are established by the template expander at runtime.

- [ ] **Step 5: Update `insertTasks` call in `createWorkflowRuntime` to pass `parentTaskName`**

In `createWorkflowRuntime` (around line 326-334), the `insertTasks` call uses `taskConfig` which now includes `kind`. We need to also pass `parent_task_name` for template subtask definitions. Since `insertTasks` uses a generic `taskConfig` JSON, the `kind` field is already serialized. For `parent_task_name`, we can add a post-insert step:

```typescript
// After insertTasks(db, runId, taskEntries.map(...)), add:
for (const entry of taskEntries) {
  if (entry.taskConfig.kind === "composite") {
    db.prepare("UPDATE tasks SET kind = 'composite' WHERE task_name = ? AND run_id = ?").run(entry.taskName, runId)
  }
}
```

This ensures the initial seed sets `kind` correctly. The `taskConfig` JSON already includes `kind` via the spread, but the `insertTasks` query only stores specific columns — it doesn't write `kind` separately. We need the explicit UPDATE.

- [ ] **Step 6: Run state machine tests**

Run: `bun --bun vitest run tests/workflow/run-state-machine.test.ts`
Expected: PASS (existing tests should still pass since new parameters have defaults)

- [ ] **Step 7: Commit**

```bash
git add src/workflow/run-state-machine.ts
git commit -m "feat: add composite support to run-state-machine (enterComposite, kind tracking)"
```

---

### Task 6: Update template expander to create composite boundaries

**Files:**
- Modify: `src/workflow/template-expander.ts`

This is the core change. Instead of inserting all subtask leaves flat, the expander now:
1. Creates the iteration instance as a **composite** task
2. Inserts its subtask children with `parent_task_name` pointing to the composite
3. Adds sequential ordering edges between iteration composites

- [ ] **Step 1: Rewrite `expandTemplate` to create composite boundaries**

```typescript
export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  depth: number,
  namePrefix?: string,
  parentTaskName?: string
): Effect.Effect<ExpansionResult, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)

    const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
    if (!templateTask) return { inserted: [], taskScopes: {}, originalNames: {} }

    const resolvedArgs = resolveArguments(task, env)

    const inserted: string[] = []
    const taskScopes: Record<string, string> = {}
    const originalNames: Record<string, string> = {}
    let previousCompositeName: string | null = null

    for (let i = 0; i < resolvedArgs.itemsCount; i++) {
      const instanceName = namePrefix
        ? buildTaskInstanceName(namePrefix, i)
        : buildTaskInstanceName(task.name, i)

      if (templateTask.tasks && templateTask.tasks.length > 0) {
        const crossIterationDeps: string[] = previousCompositeName ? [previousCompositeName] : []
        const effectiveParent = parentTaskName ?? namePrefix ?? task.name
        yield* _(ctx.insertDynamicTask(instanceName, "composite", depth + 1, crossIterationDeps, { kind: "composite" }, effectiveParent, "composite"))
        yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(instanceName) ?? instanceName, taskName: instanceName, scopeKey: namePrefix ?? task.name, depth: depth + 1 }))
        inserted.push(instanceName)
        taskScopes[instanceName] = namePrefix ?? task.name

        const sub = topologicalSort(templateTask.tasks)
        for (const subTask of sub) {
          const subInstanceName = buildTaskInstanceName(instanceName, subTask.name)
          const subRef = subTask.agent?.executorRef ?? "script"
          const subResolvedDeps = (subTask.dependencies ?? []).map(dep => buildTaskInstanceName(instanceName, dep))
          const subConfig = taskConfigFrom(subTask)
          const subKind: "leaf" | "composite" = (subTask.template && subTask.arguments?.forEach) ? "composite" : "leaf"
          yield* _(ctx.insertDynamicTask(subInstanceName, subRef, depth + 2, subResolvedDeps, subConfig, instanceName, subKind))
          yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(subInstanceName) ?? subInstanceName, taskName: subInstanceName, scopeKey: instanceName, depth: depth + 2 }))
          inserted.push(subInstanceName)
          taskScopes[subInstanceName] = instanceName
          originalNames[subInstanceName] = subTask.name
        }

        previousCompositeName = instanceName
      } else if (templateTask.agent || templateTask.script) {
        const ref = templateTask.agent?.executorRef ?? "script"
        const resolvedDeps = (templateTask.dependencies ?? [])
        const config = taskConfigFrom(templateTask)
        yield* _(ctx.insertDynamicTask(instanceName, ref, depth + 1, resolvedDeps, config, namePrefix ?? task.name))
        yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(instanceName) ?? instanceName, taskName: instanceName, scopeKey: namePrefix ?? task.name, depth: depth + 1 }))
        inserted.push(instanceName)
        taskScopes[instanceName] = namePrefix ?? task.name
        originalNames[instanceName] = task.name
      }
    }

    return { inserted, taskScopes, originalNames }
  })
}
```

Key changes from the original:
- The iteration instance (`applyPlan/0`, `applyPlan/1`, etc.) is inserted as a `"composite"` kind with `parent_task_name` pointing to the parent template task
- Cross-iteration ordering edges: `applyPlan/1` depends on `applyPlan/0`, `applyPlan/2` depends on `applyPlan/1`, etc.
- Subtask children have `parent_task_name` pointing to their composite instance
- Template subtasks that themselves have `forEach` (nested composites for feedback loops) get `kind: "composite"`

- [ ] **Step 2: Run build to verify compilation**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/workflow/template-expander.ts
git commit -m "feat: create composite boundaries in template expander with cross-iteration ordering edges"
```

---

### Task 7: Update runner for composite-aware execution

**Files:**
- Modify: `src/workflow/runner.ts`

This is the largest change. The runner loop must:
1. Build a `compositeStates` map from the DB
2. Filter tasks by eligibility using `isTaskEligible`
3. Enter composites (transition pending→running) when encountered
4. Template tasks do NOT complete on expansion — they stay open if they are composites
5. After a leaf completes, check if its parent composite has drained
6. Remove the manual `taskScopes`/`iterationOutputs`/`currentIteration` plumbing

- [ ] **Step 1: Write failing integration test for sequential forEach execution**

Create `tests/workflow/composite-nodes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Scope } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  const { EventBus } = require("../../src/events/bus.js")
  return {
    executeWithPi: vi.fn((config: any) =>
      E.gen(function* (_: any) {
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system-prompt",
          taskPrompt: `mock-task: ${config.taskId}`,
          memoryContext: config.prompt?.memoryContext ?? ""
        }))
        return { status: "done" }
      })
    ),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/prompts/system.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    SystemPromptFragmentsNotFoundError: class SystemPromptFragmentsNotFoundError extends Error {}
  }
})

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: { settings: { model: "default" }, systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` } },
  systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
})

let tmpHome: string
const origHome = process.env.HOME

beforeEach(() => {
  tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-composite-"))
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

describe("composite task nodes", () => {
  it("executes forEach iterations sequentially — story 0 fully completes before story 1 starts", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "sequential-foreach" },
      spec: {
        run: { entrypoint: "process", timeout: "300s" },
        tasks: [
          {
            name: "process",
            template: "step",
            arguments: {
              forEach: {
                valueFrom: { ref: "inputs.parameters.items" },
                as: "item"
              }
            }
          },
          {
            name: "step",
            tasks: [
              { name: "code", agent: { executorRef: "coder", prompt: { content: "Code {{inputs.parameters.item}}" } } },
              { name: "test", dependencies: ["code"], agent: { executorRef: "tester", prompt: { content: "Test {{inputs.parameters.item}}" } } },
              { name: "verify", dependencies: ["test"], agent: { executorRef: "verifier", prompt: { content: "Verify {{inputs.parameters.item}}" } } }
            ]
          }
        ]
      },
      agentRegistry: new Map([
        ["coder", makeAgentManifest("coder")],
        ["tester", makeAgentManifest("tester")],
        ["verifier", makeAgentManifest("verifier")]
      ])
    }

    const events: Event[] = []
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              (s: any) => {
                const { Stream } = require("effect")
                return Stream.tap(s, (e: Event) => Effect.sync(() => events.push(e)))
              },
              (s: any) => (s as any).runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          return yield* _(runWorkflow(spec, { parameters: { items: ["a", "b", "c"] }, project_dir: tmpHome }, { strict: false }, [], null))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.status).toBe("completed")

    const started = events.filter(e => e._tag === "TaskStarted").map((e: any) => e.taskId)

    const story0CodeIdx = started.findIndex((id: string) => id.includes("process/0-code"))
    const story0TestIdx = started.findIndex((id: string) => id.includes("process/0-test"))
    const story0VerifyIdx = started.findIndex((id: string) => id.includes("process/0-verify"))
    const story1CodeIdx = started.findIndex((id: string) => id.includes("process/1-code"))

    expect(story0CodeIdx).toBeLessThan(story0TestIdx)
    expect(story0TestIdx).toBeLessThan(story0VerifyIdx)
    expect(story0VerifyIdx).toBeLessThan(story1CodeIdx)

    expect(result.taskResults["process/0-code"]).toBe("done")
    expect(result.taskResults["process/0-test"]).toBe("done")
    expect(result.taskResults["process/0-verify"]).toBe("done")
    expect(result.taskResults["process/1-code"]).toBe("done")
    expect(result.taskResults["process/1-test"]).toBe("done")
    expect(result.taskResults["process/1-verify"]).toBe("done")
    expect(result.taskResults["process/2-code"]).toBe("done")
  })

  it("task after forEach composite only starts after all iterations drain", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "drain-gated-join" },
      spec: {
        run: { entrypoint: "process", timeout: "300s" },
        tasks: [
          {
            name: "process",
            template: "step",
            arguments: {
              forEach: {
                valueFrom: { ref: "inputs.parameters.items" },
                as: "item"
              }
            }
          },
          {
            name: "step",
            tasks: [
              { name: "build", agent: { executorRef: "builder", prompt: { content: "Build {{inputs.parameters.item}}" } } }
            ]
          },
          {
            name: "finalize",
            dependencies: ["process"],
            agent: { executorRef: "finalizer", prompt: { content: "Finalize" } }
          }
        ]
      },
      agentRegistry: new Map([
        ["builder", makeAgentManifest("builder")],
        ["finalizer", makeAgentManifest("finalizer")]
      ])
    }

    const events: Event[] = []
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              (s: any) => {
                const { Stream } = require("effect")
                return Stream.tap(s, (e: Event) => Effect.sync(() => events.push(e)))
              },
              (s: any) => (s as any).runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          return yield* _(runWorkflow(spec, { parameters: { items: ["a", "b"] }, project_dir: tmpHome }, { strict: false }, [], null))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.status).toBe("completed")

    const started = events.filter(e => e._tag === "TaskStarted").map((e: any) => e.taskId)
    const allIterTasksEnd = Math.max(
      started.findLastIndex((id: string) => id.includes("process/0-build")),
      started.findLastIndex((id: string) => id.includes("process/1-build"))
    )
    const finalizeIdx = started.findIndex((id: string) => id.includes("finalize"))

    expect(finalizeIdx).toBeGreaterThan(allIterTasksEnd)
    expect(result.taskResults["finalize"]).toBe("done")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --bun vitest run tests/workflow/composite-nodes.test.ts`
Expected: FAIL — task ordering is wrong (story 0-verify after story 1-code)

- [ ] **Step 3: Rewrite the runner loop for composite-aware execution**

Replace the main execution loop in `runner.ts` (lines 142-245). The key changes:
1. Build `compositeStates` map from DB
2. Template tasks with `forEach` (composites) do NOT complete on expansion
3. Enter composites (pending → running) before dispatching their children
4. Check drain after each leaf completion
5. Remove `taskScopes`/`iterationOutputs`/`originalNames`/`currentIteration` plumbing

```typescript
const body = Effect.gen(function* () {
  yield* _(createSubscriber(
    (b) => b.subscribeTo("TokenUsage"),
    (event) => Effect.sync(() => {
      totalTokensIn += event.tokensIn
      totalTokensOut += event.tokensOut
    })
  ))

  yield* _(Ref.set(workflowStatus, "in-progress"))
  yield* _(bus.publish({ _tag: "WorkflowStatusChanged", runId: ctx.runId, status: "in-progress" }))

  const reachableTaskNames = new Set(collectReachableTasks(spec.spec.tasks, spec.spec.run.entrypoint).map(t => t.name))
  const initialTaskNames = getTasksByRunId(ctx.db, ctx.runId).map(r => r.task_name)
  for (const name of initialTaskNames) {
    if (!reachableTaskNames.has(name)) {
      yield* _(ctx.transitionTask(name, "complete"))
    }
  }

  let hasWork = true

  while (hasWork) {
    hasWork = false
    const allRows = getTasksByRunId(ctx.db, ctx.runId)

    const compositeStates = new Map<string, string>()
    for (const row of allRows) {
      if (row.kind === "composite") {
        compositeStates.set(row.task_name, row.status)
      }
    }

    const allTasks = allRows
      .filter(r => r.status === "pending" || r.status === "running")
      .map(r => {
        const dependencies: string[] = r.dependencies ? JSON.parse(r.dependencies) : []
        const config = r.task_def ? JSON.parse(r.task_def) : {}
        return {
          name: r.task_name,
          dependencies,
          parentTaskName: r.parent_task_name,
          kind: r.kind,
          ...config
        }
      })

    const sorted = topologicalSort(allTasks)

    for (const task of sorted) {
      const currentStatus = yield* _(Ref.get(workflowStatus))
      if (currentStatus === "failed") break

      if (!isTaskEligible(task, compositeStates, task.parentTaskName ?? null)) continue

      if (task.when) {
        const maxDepth = resolveMaxRecursionDepth()
        const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
        if (depthResult === "fail") {
          yield* _(Ref.set(workflowStatus, "failed"))
          break
        }

        const whenResult = handleWhenGuard(task, workflowEnv)
        if (whenResult === "skip") {
          yield* _(ctx.transitionTask(task.name, "complete"))
          checkDrain(yield* _, ctx, compositeStates, task.parentTaskName)
          continue
        }
        if (typeof whenResult === "object" && whenResult._tag === "error") {
          yield* _(ctx.transitionTask(task.name, "fail"))
          yield* _(ctx.fail(whenResult.message))
          yield* _(Ref.set(workflowStatus, "failed"))
          break
        }
      }

      if (task.kind === "composite" && compositeStates.get(task.name) === "pending") {
        yield* _(ctx.enterComposite(task.name))
        hasWork = true
        break
      }

      if (task.template) {
        const parentName = task.parentTaskName ?? undefined
        const result = yield* _(expandTemplate(ctx, task, spec, workflowEnv, 0, undefined, parentName))
        if (task.kind !== "composite") {
          yield* _(ctx.transitionTask(task.name, "complete"))
        }
        hasWork = true
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
      const taskEnv: WorkflowEnv = { ...workflowEnv, parameters: resolvedArgs.parameters }

      let memoryContext = ""
      if (memoryReader) {
        const llmClient = createLLMClient({ bus: yield* _(EventBus) })
        const curator = createCurator(llmClient)
        const memoryFilters = yield* _(Effect.promise(() => curator.suggestMemoryFilters(task.name, [])))
        const memoryAtoms = yield* _(Effect.promise(() => memoryReader.retrieveRelevant(memoryFilters, 5)))
        memoryContext = buildMemoryContext(memoryAtoms)
      }

      yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, memoryContext, guidelineRules, skillRegistry, templateOptions, scriptConfig, execState, hookRuntime))

      const output = workflowEnv.tasks?.[task.name]
      if (output) {
        workflowEnv.tasks![task.name] = output
      }

      yield* _(checkDrainAfterLeaf(yield* _, ctx, compositeStates, task.parentTaskName ?? null))
    }
  }

  // ... rest remains the same (status check, complete/fail, summary, hooks)
})
```

Helper function to add at the top of the `body` Effect (before the while loop):

```typescript
function checkDrainAfterLeaf(
  _gen: any,
  ctx: WorkflowRuntime,
  compositeStates: Map<string, string>,
  parentTaskName: string | null
): Effect.Effect<void, Error> {
  return Effect.gen(function* (_) {
    if (!parentTaskName) return

    let current = parentTaskName
    while (current) {
      const hasPending = hasPendingDescendants(ctx.db, ctx.runId, current)
      if (!hasPending) {
        yield* _(ctx.transitionTask(current, "complete"))
        compositeStates.set(current, "completed")

        const parentRow = ctx.db.prepare(
          "SELECT parent_task_name FROM tasks WHERE run_id = ? AND task_name = ?"
        ).get(ctx.runId, current) as { parent_task_name: string | null } | null
        current = parentRow?.parent_task_name ?? null
      } else {
        break
      }
    }
  })
}
```

- [ ] **Step 4: Add the necessary imports to runner.ts**

```typescript
// Add to existing imports:
import { isTaskEligible } from "../workflow/engine.js"
import { hasPendingDescendants } from "../db/queries.js"
```

- [ ] **Step 5: Remove the `taskScopes`/`iterationOutputs`/`originalNames` declarations**

Delete lines 162-164 from runner.ts:
```typescript
// REMOVE these lines:
const taskScopes: Record<string, string> = {}
const originalNames: Record<string, string> = {}
const iterationOutputs: Record<string, Record<string, { outputs: Record<string, unknown> }>> = {}
```

And remove lines 218-243 (the scopeKey/taskEnv/currentIteration plumbing) since composite structure replaces it.

- [ ] **Step 6: Run composite test to verify it passes**

Run: `bun --bun vitest run tests/workflow/composite-nodes.test.ts`
Expected: PASS — sequential ordering is correct

- [ ] **Step 7: Run existing runner tests to verify no regressions**

Run: `bun --bun vitest run tests/workflow/runner.test.ts`
Expected: PASS — all existing tests still pass (or identify adjustments needed)

- [ ] **Step 8: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/composite-nodes.test.ts
git commit -m "feat: composite-aware runner loop with drain barrier and sequential forEach"
```

---

### Task 8: Regression — run full test suite

- [ ] **Step 1: Run the complete test suite**

Run: `bun --bun vitest run`
Expected: All 631+ tests PASS

- [ ] **Step 2: Run the build**

Run: `bun run build`
Expected: PASS (no type errors)

- [ ] **Step 3: Fix any remaining tests that break**

If existing tests referencing `taskScopes` or `currentIteration` fail:
- `taskScopes` tests: these are used in the runner for iteration outputs. With composites, `workflowEnv.tasks` still gets populated by `dispatchTask` (via the output schema). The `expandTemplate` function still returns `taskScopes` and `originalNames` — the runner just doesn't use them for eligibility anymore. Adjust tests that relied on `currentIteration` to use `workflowEnv.tasks` directly.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: update tests for composite-aware runner changes"
```

---

### Task 9: Verify with feature-dev workflow

- [ ] **Step 1: Run the feature-dev workflow end-to-end**

Run: `bun run build && bun run install-local && hamilton workflow run feature-dev --project-dir /tmp/test-composite --input '{"spec": "Add a hello world function"}'`
Expected: Iterations execute sequentially — story 0 fully completes (code→test→verify) before story 1 starts.

- [ ] **Step 2: Check the status output for correct ordering**

Run: `hamilton workflow status <run-id>`
Expected: Tasks show in per-iteration order, not batched by role.

- [ ] **Step 3: Commit if changes were needed**

```bash
git add -A
git commit -m "fix: final adjustments for feature-dev composite execution"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Covered by |
|---|---|
| Node kinds (leaf/composite) | Task 1 (types), Task 2 (schema), Task 3 (queries) |
| Transitions (ordinary edges, scope entry, guard) | Task 6 (expander creates edges), Task 7 (runner handles guards) |
| Drain-complete rule | Task 3 (`hasPendingDescendants`), Task 7 (drain check after leaf) |
| Failure rule (fail-fast, no composite retry) | Task 7 (runner propagates failure via existing fail path) |
| Invariant: edges on boundaries | Task 6 (cross-iteration edges between composites, not leaves) |
| Invariant: drain-gated downstream join | Task 7 (eligibility filter + drain check) |
| Reference topology | Task 6 (expander creates the nesting structure), Task 7 (runner executes it) |
| Impact: state machine | Task 5 (`enterComposite`, `insertDynamicTask` extended) |
| Impact: schema | Task 2 (columns), Task 3 (queries) |
| Impact: sort/reachability | Task 4 (`isTaskEligible` filter) |
| Impact: scope ownership | Task 7 (remove manual `taskScopes`/`iterationOutputs`) |
| Impact: materialization | Task 6 (eager iteration boundaries, lazy feedback loop subtrees by re-expansion) |
| Design decisions: parallel deferred | Task 5 (kind field exists but only sequential edges created in Task 6) |
| Design decisions: fail-fast only | Task 7 (standard failure propagation, no continueOnError) |
| Design decisions: no composite retry | Task 7 (no composite-level on_failure in runner) |

### 2. Placeholder scan

No "TBD", "TODO", or vague instructions found. Every task has concrete code and assertions.

### 3. Type consistency

- `kind: "leaf" | "composite"` added to `WorkflowTask` in Task 1 → reused in Task 5 (`collectLeafTaskDefs`), Task 6 (expander), Task 7 (runner)
- `parent_task_name` column in Task 2 → queried in Task 3 (`getChildrenOfTask`, `hasPendingDescendants`) → written in Task 5 (`insertDynamicTask`) → filtered in Task 4 (`isTaskEligible`) → checked in Task 7 (drain check)
- `insertDynamicTask` signature extended in Task 5 with optional `parentTaskName` and `kind` params (defaulting to preserve backward compat) → called in Task 6 (expander)
- `isTaskEligible(task, compositeStates, parentTaskName)` in Task 4 → called in Task 7 (runner loop)
- `hasPendingDescendants(db, runId, taskName)` in Task 3 → called in Task 7 (drain check)
- `enterComposite(taskName)` in Task 5 → called in Task 7 (runner)
