# Refactor `expandTemplate` to Pure Graph Mutation

## Overview

Refactor `src/workflow/template-expander.ts` from a god function that both discovers
sub-tasks **and** executes them inline (calling `dispatchTask` directly) into a pure graph
mutator that only inserts tasks into the execution graph. Move all execution responsibility
into `runWorkflow`, which becomes the single execution loop for all tasks — static and
dynamic alike.

Along the way, make the database the sole source of truth for the execution graph by
storing `dependencies` alongside each task row. This eliminates the need to round-trip
through the YAML spec to reconstruct the DAG at runtime.

This addresses 8 issues identified in the code-quality audit of `template-expander.ts`
(SRP, OCP, DIP, DRY when-handling, DRY argument construction, deep nesting, mutation-heavy
design, double-fail on task transition).

### Files touched

| File | Change |
|---|---|
| `src/db/schema.ts` | Add `dependencies` and `task_def` columns, drop `parent_task_id` |
| `src/db/migrations.ts` | Migration 7: alter table for `dependencies` and `task_def`, drop `parent_task_id` |
| `src/db/queries.ts` | `insertTask` unified, gains `taskConfig` param; `TaskRow` gains `dependencies` + `task_def`, drops `parent_task_id` |
| `src/workflow/run-state-machine.ts` | `insertDynamicTask` gains `depth`, `dependencies`, `taskConfig`; drops `parentTaskId`; `createWorkflowRuntime` serializes config |
| `src/workflow/template-expander.ts` | Rewrite: pure graph mutation, passes resolved deps to `insertDynamicTask`, emits `TaskInserted` |
| `src/workflow/when-guard.ts` | Add `handleWhenGuard()` extracted from both `runner.ts` and `template-expander.ts` |
| `src/workflow/runner.ts` | Outer `while` loop reads DAG from DB, per-task `currentIteration` injection, uses `handleWhenGuard` |
| `src/events/bus.ts` | Add `TaskInserted` event type |
| `src/observability/workflow-logger.ts` | Handle `TaskInserted` event for `events.jsonl` |
| `tests/workflow/template-expander.test.ts` | New: tests for the refactored `expandTemplate` |
| `tests/workflow/runner.test.ts` | Update: adapt to new `while`-loop and per-task `currentIteration` behavior |

### What does NOT change

- `task-executor.ts` — `dispatchTask` and `withTaskLifecycle` unchanged
- `engine.ts` — `topologicalSort`, `buildTaskInstanceName`, `buildTaskId` unchanged
- `WorkflowTask` and `WorkflowEnv` types — unchanged
- `arguments.ts` — `resolveArguments` unchanged
- All agent manifests, workflow YAML specs, bundle files — unchanged

---

## Architecture

### Before (AS-IS)

```
runWorkflow
  ├── topologicalSort(staticTasks)
  └── for task in sorted:
        ├── if task.template → expandTemplate()
        │                        ├── topologicalSort(templateSubTasks)
        │                        ├── for each subTask:
        │                        │     ├── when-guard (duplicated)
        │                        │     ├── insertDynamicTask()
        │                        │     ├── dispatchTask()  ← inline execution
        │                        │     └── currentIteration save/restore
        │                        └── dispatchTask(templateLeaf)  ← inline execution
        └── else             → dispatchTask()
```

Two execution paths. Template sub-tasks never pass through `runWorkflow`'s loop — no pause
checks, no unified token tracking, no transition validation.

### After (TO-BE)

```
runWorkflow
  ├── while pending:
  │     ├── topologicalSort(allTasks from DB)
  │     ├── for task in sorted:
  │     │     ├── handleWhenGuard(task)    ← unified, before any branch
  │     │     │     skip → continue
  │     │     │     fail → break
  │     │     ├── if task.template:
  │     │     │     expandTemplate()       ← pure: inserts tasks, emits TaskInserted
  │     │     │     transitionTask("complete")  ← so it won't re-expand
  │     │     │     pending = true; break  ← re-sort immediately with new tasks
  │     │     ├── build taskEnv with per-task currentIteration
  │     │     ├── dispatchTask(task)
  │     │     └── update iterationOutputs
  │     └── if no new tasks → break
  └── complete / fail
```

Single execution path. Every task goes through the same when-guard, pause check, and
dispatch pipeline.

---

## Component 1: DB as Source of Truth for the Execution Graph

### Migration 7: add `task_def` and `dependencies`, drop `parent_task_id`

```sql
ALTER TABLE tasks ADD COLUMN dependencies TEXT;
ALTER TABLE tasks ADD COLUMN task_def TEXT;
```

`TaskRow` gains `dependencies: string | null` and `task_def: string | null`, loses
`parent_task_id`. `depth` stays. Migration 7 in `src/db/migrations.ts`, schema in
`src/db/schema.ts`.

### `insertTask` — unified signature

`insertTaskWithParent` is removed. `insertTask` becomes the single insertion function:

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
): void
```

Stores `JSON.stringify(dependencies)` and `JSON.stringify(taskConfig)`. Empty
dependencies stored as `"[]"`, empty config as `"{}"`.

### `insertTasks` — batch variant

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
): void
```

### `insertDynamicTask` — simplified signature

```typescript
insertDynamicTask(
  taskName: string,
  agentName: string,
  depth: number,
  dependencies?: string[],
  taskConfig?: Record<string, unknown>
): Effect.Effect<void, EngineError>
```

No `parentCompoundId` param. Caller passes `depth` and full task config directly.

### `taskDef` content

The JSON stored in `task_def` contains all `WorkflowTask` fields except `name` and
`dependencies` (which have dedicated columns). Includes:

```typescript
{
  agent,        // TaskAgent | undefined
  script,       // TaskScript | undefined
  template,     // string | undefined
  arguments,    // Arguments | undefined
  when,         // string | undefined
  tasks         // WorkflowTask[] | undefined (template sub-tasks)
}
```

### `createWorkflowRuntime` — serialize static task config

When inserting initial static tasks, extract the config from the spec:

```typescript
insertTasks(db, runId, taskEntries.map((t, i) => ({
  taskName: t.taskName,
  agentName: t.agentName,
  executionIndex: i,
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
})))
```

### `expandTemplate` — serialize dynamic task config, resolve deps

When inserting dynamic sub-tasks, serialize the subTask config and resolve dependency names:

```typescript
const resolvedDeps = (subTask.dependencies ?? []).map(dep =>
  buildTaskInstanceName(prefix, dep)
)
const config = {
  agent: subTask.agent ?? undefined,
  script: subTask.script ?? undefined,
  template: subTask.template ?? undefined,
  arguments: subTask.arguments ?? undefined,
  when: subTask.when ?? undefined,
  tasks: subTask.tasks ?? undefined
}
ctx.insertDynamicTask(instanceName, executorRef, depth + 1, resolvedDeps, config)
```

### `collectAllTasksFromDb` — full task from DB only

Reads pending/running task rows and reconstructs complete `WorkflowTask` objects from
stored config. No spec lookups:

```typescript
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

Dynamic template tasks come back with `template` and `arguments` intact — ready for
re-expansion on the next loop iteration. The DB is the sole source of truth for every
field on every task.

---

## Component 2: `expandTemplate` — Pure Graph Mutator

### New signature

```typescript
interface ExpansionResult {
  inserted: string[]
  taskScopes: Record<string, string>
  originalNames: Record<string, string>
}

function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  depth: number,
  namePrefix?: string
): Effect.Effect<ExpansionResult, never, EventBus>
```

Parameters cut from 13 to 6. Dropped: `maxDepth`, `guidelineFiles`, `allRules`,
`skillRegistry`, `templateOptions`, `scriptConfig`, `state`, `parentCompoundId`.
Added: `depth` for template nesting level, passed through to `insertDynamicTask`.

Only needs `EventBus` — no `Scope` requirement.

### Behavior

1. Resolve `task.arguments` to determine `itemsCount` and parameter overrides.
2. Look up the template task by name (`task.template`) in the spec.
3. For each iteration `i` in `0..itemsCount`:
   a. Build the instance name prefix: `buildTaskInstanceName(namePrefix ?? task.name, i)`.
   b. If the template task has sub-tasks:
      - Topologically sort them.
      - For each sub-task:
        - Build its full instance name: `buildTaskInstanceName(prefix, subTask.name)`.
        - If the sub-task itself has `template`, recurse into `expandTemplate`, merging
          the child `ExpansionResult`.
        - Otherwise, determine `executorRef` from `subTask.agent?.executorRef ?? "script"`.
        - Resolve dependencies to full instance names:
          `(subTask.dependencies ?? []).map(dep => buildTaskInstanceName(prefix, dep))`.
        - Serialize subTask config (agent, script, template, arguments, when, tasks).
        - Call `ctx.insertDynamicTask(instanceName, executorRef, depth + 1, resolvedDeps, config)`.
        - Publish `bus.publish({ _tag: "TaskInserted", runId, taskId, taskName: instanceName, scopeKey: prefix, depth: depth + 1 })`.
        - Record `taskScopes[instanceName] = prefix` and `originalNames[instanceName] = subTask.name`.
   c. If the template task is a leaf (agent or script):
      - Determine `executorRef`.
      - Serialize templateTask config (agent, script, template, arguments, when, tasks).
      - Call `ctx.insertDynamicTask(prefix, executorRef, depth + 1, resolvedDeps, config)`.
      - Publish `bus.publish({ _tag: "TaskInserted", runId, taskId, taskName: prefix, scopeKey: namePrefix ?? task.name, depth: depth + 1 })`.
      - Record `taskScopes[prefix] = namePrefix ?? task.name` and `originalNames[prefix] = task.name`.
4. Return the `ExpansionResult` with merged `taskScopes` and `originalNames`.

`originalNames` maps instance name → original task name. Needed by `runWorkflow` for
`currentIteration` output scoping (copying outputs from `workflowEnv.tasks[instanceName]`
to `iterationOutputs[scopeKey][originalName]`).

### What it does NOT do

- Does NOT call `dispatchTask`.
- Does NOT call `ctx.transitionTask`.
- Does NOT call `ctx.fail`.
- Does NOT call `Ref.set` / `Ref.get`.
- Does NOT evaluate `when` conditions.
- Does NOT check recursion depth.
- Does NOT save/restore `state.workflowEnv.currentIteration`.

### scopeKey definition

`scopeKey` is the instance name prefix at the time of expansion. For flat templates:
`taskScopes["process/0-build"] = "process/0"`. For nested templates:
`taskScopes["parent/0-sub/1-leaf"] = "parent/0-sub/1"`.

Computed at expansion time — no string parsing needed later. The same string that was
passed to `buildTaskInstanceName` as the name prefix becomes the scope key. Also used by
`expandTemplate` internally to resolve sub-task dependencies to full instance names.

### depth parameter

`depth` tracks template nesting level for the recursion guard (`max_recursion_depth`).
`runWorkflow` passes `depth = 0` in the initial call. Each recursive call or leaf insertion
passes `depth + 1` to `insertDynamicTask`, which stores it in the `tasks.depth` column.

`getTaskDepth` reads `depth` directly from the DB row — no need to walk a parent chain.

### Empty result case

If `task.arguments.forEach` resolves to an empty array, `expandTemplate` returns
`{ inserted: [], taskScopes: {}, originalNames: {} }` and inserts no tasks.

If the task has no `template` field at all, returns the same empty result.

---

## Component 3: `handleWhenGuard` — Pure When Evaluation

### Signature

```typescript
function handleWhenGuard(
  task: WorkflowTask,
  env: WorkflowEnv
): "proceed" | "skip" | { _tag: "error"; message: string }
```

Added to `src/workflow/when-guard.ts`. Pure function — no `Effect`, no `ctx`, no `Ref`.
Just evaluates `task.when` against `env`.

### Internal logic

```
1. If task.when is not set → return "proceed"
2. result = evaluateWhenCondition(task, env)
   → if "skip": return "skip"
   → if error:  return error
   → else: return "proceed"
```

### Call site (runner.ts)

```typescript
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
```

Recursion depth checking stays separate — called before `handleWhenGuard` in runner.ts
and its state transitions also live in runner.ts.

---

## Component 4: `TaskInserted` Event

### Event type

```typescript
{ readonly _tag: "TaskInserted"; readonly runId: string; readonly taskId: string; readonly taskName: string; readonly scopeKey?: string; readonly depth: number }
```

Added to the `Event` union in `src/events/bus.ts`.

`scopeKey` is present only for tasks produced by a `forEach` loop. Undefined for leaf
template tasks without iteration.

### Subscriber

Handled in `src/observability/workflow-logger.ts`:

```typescript
if (event._tag === "TaskInserted") {
  return appendEngineLog(event.runId, {
    event: "task_inserted",
    taskId: event.taskId,
    taskName: event.taskName,
    scopeKey: event.scopeKey,
    depth: event.depth
  }).pipe(Effect.catchAll(() => Effect.void))
}
```

Purpose is purely observability — writes to `events.jsonl`. Does not drive control flow.

---

## Component 5: `runner.ts` — Outer Loop & Per-Task `currentIteration`

### 5a. Outer `while` loop

Replace the single-pass `for` with a loop that reads the DAG from the DB and re-sorts
when new tasks are inserted:

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

    if (task.template) {
      const result = yield* _(expandTemplate(ctx, task, spec, workflowEnv, 0))
      Object.assign(taskScopes, result.taskScopes)
      Object.assign(originalNames, result.originalNames)
      yield* _(ctx.transitionTask(task.name, "complete"))
      pending = true
      break
    }

    // ... pause check, dispatch (with taskEnv built from taskScopes) ...
  }
}
```

### 5b. `collectAllTasksFromDb`

Reads pending/running task rows from the DB and maps each to a `WorkflowTask` with
`dependencies` parsed from the stored JSON. No spec lookups — the DB is the sole source
of truth for the execution graph. (See Component 1 for full implementation.)

### 5c. Recursion depth + when-handling (before any branch)

Recursion depth is checked first (stays an `Effect` since it reads from the DB).
`handleWhenGuard` is pure — it only evaluates the `when` condition. All status
transitions live in `runner.ts`:

```typescript
const maxDepth = resolveMaxRecursionDepth()
const whenResult = yield* _(handleWhenGuard(task, task.name, ctx, workflowEnv, workflowStatus, maxDepth))
if (whenResult === "skip") continue
if (whenResult === "fail") break
```

### 5d. Per-task `currentIteration` injection

```typescript
const iterationOutputs: Record<string, Record<string, { outputs: Record<string, unknown> }>> = {}

// ... inside the task loop, before dispatch:

const scopeKey = taskScopes[taskName]
const resolvedArgs = resolveArguments(task, workflowEnv)
const taskEnv: WorkflowEnv = scopeKey
  ? {
      ...workflowEnv,
      currentIteration: { tasks: iterationOutputs[scopeKey] ?? {} },
      parameters: resolvedArgs.parameters
    }
  : { ...workflowEnv, parameters: resolvedArgs.parameters }

yield* _(dispatchTask(task, taskEnv, taskName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))

const originalName = originalNames[taskName]
const output = workflowEnv.tasks?.[taskName]
if (scopeKey && originalName && output) {
  (iterationOutputs[scopeKey] ??= {})[originalName] = output
}
```

Key properties:
- `currentIteration` only appears on `taskEnv` for tasks produced by a `forEach` loop.
- `currentIteration` is never stored on the shared `workflowEnv`.
- No save/restore — each dispatch gets a snapshot of the current `iterationOutputs`.
- Nested loops naturally isolated by hierarchical scope key prefixes.

### 5e. Pause check applies to all tasks

Since template sub-tasks now pass through the main loop, the existing `shouldPause()`
check applies to them automatically. No special handling needed.

---

## Migration Plan

### Step 1: Add `task_def` + `dependencies`, drop `parent_task_id` (migration 7 + schema + queries)

Zero behavioral change. Migration adds two columns, schema updated. `TaskRow` gains
`dependencies` and `task_def`, loses `parent_task_id`. `insertTaskWithParent` merged
into `insertTask` (unified signature with `depth`, `dependencies`, `taskConfig`).
All callers updated.

### Step 2: `insertDynamicTask` gains `depth`, `dependencies`, `taskConfig`; drops `parentTaskId`

`createWorkflowRuntime` passes `depth: 0`, `dependencies`, and serialized `taskConfig`
for static tasks. `expandTemplate` passes `depth + 1`, resolved dependencies, and
serialized subTask config for dynamic tasks.

### Step 3: Extract `handleWhenGuard`

Add `handleWhenGuard` to `when-guard.ts`. Call it from both `runner.ts` and
`template-expander.ts` (replacing their duplicate blocks). Zero behavioral change.

### Step 4: Add `TaskInserted` event and subscriber

Add the event type to `EventBus`, handle in `WorkflowLogger`. No behavioral change
since nothing publishes it yet.

### Step 5: Refactor `expandTemplate` signature and add return value

Change `expandTemplate` to return `ExpansionResult`, pass resolved dependencies to
`insertDynamicTask`, emit `TaskInserted` events. Keep it calling `dispatchTask` internally
for now. The return value is unused by callers. All existing tests pass.

### Step 6: Add outer loop to `runWorkflow`

Add the `while (pending)` loop and `collectAllTasksFromDb`. At this point `expandTemplate`
still calls `dispatchTask` — inserted tasks are already executed before the next loop
iteration, so `collectAllTasksFromDb` finds no pending dynamic tasks. The loop is a no-op.
All existing tests pass.

### Step 7: Remove `dispatchTask` from `expandTemplate`

Delete the `dispatchTask` calls, when-handling, failure propagation, and
`currentIteration` management from `expandTemplate`. The outer loop now picks up
inserted tasks (with `dependencies` from the DB) and dispatches them.

### Step 8: Add per-task `currentIteration` injection to `runWorkflow`

Wire `taskScopes` and `originalNames` into the dispatch flow inside `runWorkflow`.
Delete the `currentIteration` save/restore from `expandTemplate`.

---

## Test Strategy

### New tests (`tests/workflow/template-expander.test.ts`)

| Test | What it verifies |
|---|---|
| Returns empty result for non-template task | `{ inserted: [], taskScopes: {}, originalNames: {} }` |
| Returns empty result when forEach resolves to empty array | No tasks inserted |
| Inserts correct task names for flat template | Instance names like `process/0-build`, `process/1-build` |
| Stores resolved dependencies in DB | `process/0-check` depends on `process/0-build` (not `build`) |
| Emits TaskInserted events with correct data | runId, taskName, scopeKey |
| Handles nested templates | Names like `parent/0-sub/1-leaf`, correct scope keys and deps |
| Merges child ExpansionResults | taskScopes and originalNames from recursion are merged |
| Does not mutate shared workflowEnv | workflowEnv.tasks and workflowEnv.currentIteration untouched after call |

### Updated tests (`tests/workflow/runner.test.ts`)

| Test | What it verifies |
|---|---|
| `currentIteration` cleanup after template completes | Existing test, still passes |
| No `currentIteration` leak between iterations | Existing test, still passes |
| Template sub-tasks dispatched in correct order | DAG from DB drives topological sort, sub-tasks execute sequentially |
| Conditional template (when=skip) not expanded | `expandTemplate` never called when `handleWhenGuard` returns skip |
| Static task dependencies stored in DB at startup | `collectAllTasksFromDb` reads them back |

### Shared behavior (no changes needed)

Tests for `dispatchTask`, `topologicalSort`, `buildTaskInstanceName`, `resolveArguments`,
and `evaluateWhenCondition` are unaffected — their contracts don't change.

---

## Before/After

| Metric | Before | After |
|---|---|---|
| `expandTemplate` LOC | 108 | ~35 |
| `expandTemplate` params | 13 | 6 (`ctx`, `task`, `spec`, `env`, `depth`, `namePrefix?`) |
| `expandTemplate` responsibilities | 10 | 1 (graph mutation) |
| When-handler duplicates | 2 (`runner.ts` + `template-expander.ts`) | 1 (`when-guard.ts`) |
| Execution paths | 2 (runner loop + expandTemplate inline) | 1 (runner loop only) |
| Max nesting depth in expandTemplate | 4 | 2 |
| Mutations in `expandTemplate` | 7 categories | 2 (`insertDynamicTask`, `EventBus.publish`) |
| `expandTemplate` return | `void` | `ExpansionResult { inserted, taskScopes, originalNames }` |
| `currentIteration` location | mutated on shared `workflowEnv` | injected per-task into `taskEnv` |
| DAG source of truth | YAML spec + in-memory lookups | database |
| DAG reads from runner | `topologicalSort(spec.spec.tasks)` | `topologicalSort(collectAllTasksFromDb(ctx))` |
| DB columns in `tasks` | `parent_task_id`, `depth` | `depth`, `dependencies`, `task_def` |
| `insertTask` variants | `insertTask` + `insertTaskWithParent` | single `insertTask` |
| `collectAllTasksFromDb` source | n/a (doesn't exist) | DB only, no spec lookups |
