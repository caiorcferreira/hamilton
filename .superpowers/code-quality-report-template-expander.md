# Code Quality Audit & Refactor Proposal: `src/workflow/template-expander.ts`

## 1. Current Architecture (AS-IS)

```
runWorkflow (runner.ts)
  │
  ├── collectReachableTasks(spec.tasks, entrypoint)
  ├── topologicalSort(staticTasks)
  │
  └── for task in sortedTasks:
        ├── if task.template ──► expandTemplate() ──calls dispatchTask──► EXECUTES INLINE
        └── else            ──► dispatchTask() ─────────────────────────► EXECUTES INLINE
                                        ▲
                          expandTemplate calls dispatchTask directly,
                          bypassing the runWorkflow execution loop
                          for ALL sub-tasks of the template.
```

**The fork**: template sub-tasks never pass through `runWorkflow`'s main loop. They are discovered, sorted, and executed entirely inside `expandTemplate`, which means:
- No pause/suspend check on sub-tasks (line 154 of `runner.ts` is never reached for them)
- No unified token tracking path
- No single point of status-transition validation

---

## 2. Issues by Principle

### 2.1 SRP — expandTemplate does too many things

| Responsibility | Lines | Should live in |
|---|---|---|
| Resolve `arguments.forEach` for iteration count | 35 | `runner.ts` (pre-expansion) |
| Build instance names (`buildTaskInstanceName`) | 43–45 | expansion only |
| Check `maxDepth` recursion guard | 61–65 | `runner.ts` (unified when-block) |
| Evaluate `when` condition | 67 | `runner.ts` (unified when-block) |
| Topological-sort sub-tasks | 54 | `engine.ts` (already there — reused) |
| Insert dynamic tasks into the DB | 82, 92, 103 | expansion only |
| Execute leaf sub-tasks via `dispatchTask` | 93, 104 | **runner.ts only** |
| Recurse into nested templates | 83 | expansion only |
| Scoped `currentIteration` management | 52–53, 85–87, 94–97, 99–100 | `runner.ts` (iteration-group context) |
| Failure propagation (`Ref.set`, `ctx.fail`) | 63, 73–76 | `runner.ts` only |

Verdict: **a god function. 5 of 10 responsibilities belong elsewhere.**

### 2.2 OCP — 14 positional parameters

```typescript
export function expandTemplate(
  ctx: WorkflowRuntime,        //  1
  task: WorkflowTask,          //  2
  spec: WorkflowSpec,          //  3
  env: WorkflowEnv,            //  4
  maxDepth: number | null,     //  5
  guidelineFiles: ...,         //  6
  allRules: CompiledRule[],    //  7
  skillRegistry: ...,          //  8
  templateOptions: ...,        //  9
  scriptConfig: ...,           // 10
  state: TaskExecutionState,   // 11
  parentCompoundId?: string,   // 12
  namePrefix?: string          // 13
): Effect.Effect<void, ...>    // no meaningful return value
```

Adding support for a new expansion strategy (e.g., `parallel`, `matrix`) requires changing the signature and every call site (currently 2: `runner.ts:145` and `template-expander.ts:83`).

### 2.3 DIP — direct dependency on `dispatchTask`

```typescript
import { dispatchTask, type TaskExecutionState } from "./task-executor.js"
```

`expandTemplate` depends on a concrete executor. If we ever wanted to swap execution strategies (dry-run, simulation, remote dispatch), this coupling makes it impossible without editing `expandTemplate` directly.

### 2.4 DRY — duplicated when-handling

#### runner.ts:122–141

```typescript
if (task.when) {
  const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
  if (depthResult === "fail") { yield* _(Ref.set(workflowStatus, "failed")); break }
  const whenResult = evaluateWhenCondition(task, workflowEnv)
  if (whenResult === "skip") { yield* _(ctx.transitionTask(task.name, "complete")); continue }
  if (typeof whenResult === "object" && whenResult._tag === "error") {
    yield* _(ctx.transitionTask(task.name, "fail"))
    yield* _(ctx.fail(whenResult.message))
    yield* _(Ref.set(workflowStatus, "failed"))
    break
  }
}
```

#### template-expander.ts:60–78 (identical logic)

```typescript
if (subTask.when) {
  const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, subInstanceName))
  if (depthResult === "fail") {
    yield* _(Ref.set(state.workflowStatus, "failed"))
    break
  }
  const whenResult = evaluateWhenCondition(subTask, state.workflowEnv)
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

The only difference is the variable names (`task` vs `subTask`, `task.name` vs `subInstanceName`). This is a **textbook extract-method** case.

### 2.5 DRY — argument/Env construction duplicated

`runner.ts:161–165` and `template-expander.ts:35, 46–49` both resolve arguments and build a task-scoped `WorkflowEnv` the same way.

### 2.6 Clean Code — deep nesting

```
for i in 0..itemsCount             ← level 1
  if templateTask.tasks.length>0   ← level 2
    for subTask in sorted          ← level 3
      if subTask.when              ← level 4  (7 lines of logic)
      if subTask.template          ← level 4  (8 lines of logic)
      else                         ← level 4  (4 lines of logic)
  else if templateTask.agent/script ← level 2
```

Cyclomatic complexity is high. The inner loops are not named, tested, or reusable.

### 2.7 Mutation-heavy design

| Mutation | Location |
|---|---|
| `state.workflowEnv.currentIteration` set | 53 |
| `state.workflowEnv.currentIteration.tasks[x]` set | 86, 96 |
| `state.workflowEnv.currentIteration` deleted + restored | 99–100 |
| `Ref.set(state.workflowStatus, "failed")` | 63, 75 |
| `ctx.transitionTask(x, "fail"/"complete")` | 69, 73 |
| `ctx.insertDynamicTask(x, ...)` | 82, 92, 103 |
| `ctx.fail(msg)` | 74 |

All side effects, spread across multiple points within nested loops. No return value (`Effect<void>`).

### 2.8 Potential double-fail on task transition

When a `when` error occurs in `expandTemplate` (line 73–76):

```typescript
yield* _(ctx.transitionTask(subInstanceName, "fail"))  // transition to "failed"
yield* _(ctx.fail(whenResult.message))
yield* _(Ref.set(state.workflowStatus, "failed"))
```

But if `dispatchTask` also fails (e.g., in `withTaskLifecycle` at `task-executor.ts:52–53`), it attempts `transitionTask("fail")` on the same task. The state machine in `run-state-machine.ts:119` rejects invalid transitions — a task already in `"failed"` state cannot transition to `"failed"` again. This would throw an `EngineError`.

---

## 3. The `currentIteration` Mechanism

`currentIteration` is a scoping device on `WorkflowEnv`:

```typescript
// src/workflow/env.ts
currentIteration?: {
  tasks?: Record<string, { outputs: Record<string, unknown> }>
}
```

**Purpose**: sub-tasks within a template iteration use `inputs.currentIteration.tasks.<taskName>.outputs.<field>` in `when` conditions to reference sibling outputs using the **original task name** (not the instance name with the iteration index).

**Current lifecycle**:
1. `expandTemplate` sets `state.workflowEnv.currentIteration = { tasks: {} }` before the inner loop
2. After each sub-task executes, its output is copied into `currentIteration.tasks[subTask.name]`
3. After the iteration loop, `currentIteration` is deleted and the previously saved value is restored

**Why this works inline but complicates deferral**: `currentIteration` is set and consumed within the same synchronous-ish execution frame (`expandTemplate`'s `for` loop). If execution moves to `runWorkflow`, the context must be set before dispatching each iteration group's tasks and torn down after.

---

## 4. Proposed Architecture (TO-BE)

### 4.1 Core idea

```
runWorkflow
  │
  ├── while (hasPendingTasks):
  │     ├── topologicalSort(allStaticAndDynamicTasks)
  │     ├── for task in sorted:
  │     │     ├── if task.template:
  │     │     │     expandTemplate()  ← PURE: inserts tasks, returns nothing
  │     │     │     continue          ← execution happens in the next loop pass
  │     │     │
  │     │     ├── when-handler(task)  ← unified, extracted function
  │     │     │
  │     │     ├── if hasIterationContext(task):
  │     │     │     setCurrentIteration(task.iterationGroup)
  │     │     │
  │     │     ├── dispatchTask(task)
  │     │     │
  │     │     └── if wasLastInIterationGroup(task):
  │     │           clearCurrentIteration()
  │     │
  │     └── if no new tasks inserted → break
  │
  └── complete / fail
```

### 4.2 What changes

#### A. `expandTemplate` becomes a pure graph mutator

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
  namePrefix?: string
): ExpansionResult
```

- Iterates `itemsCount` times (determined from `task.arguments`)
- For each iteration, builds instance names (`namePrefix/i-subTaskName`)
- Recursively expands nested templates (also pure — just more inserts), merging their results
- Calls `ctx.insertDynamicTask(instanceName, executorRef, parentCompoundId)` for each leaf sub-task
- Returns:
  - `inserted`: all inserted instance names
  - `taskScopes`: maps each instance name to its iteration scope key (the prefix at the time it was built — e.g. `"process/0"`, `"parent/0-subParent/1"`). This is computed during expansion with zero string parsing.
  - `originalNames`: maps instance name to its original task name (e.g. `"process/0-build" → "build"`) for `currentIteration` output scoping

**No calls to `dispatchTask`. No `Ref.set`. No `ctx.transitionTask`. No `ctx.fail`.**

#### B. Extract a unified `handleWhenGuard` function

```typescript
function handleWhenGuard(
  task: WorkflowTask,
  instanceName: string,
  ctx: WorkflowRuntime,
  workflowEnv: WorkflowEnv,
  workflowStatus: Ref.Ref<...>,
  maxDepth: number | null
): Effect.Effect<"proceed" | "skip" | "fail", EngineError>
```

Used by both `runWorkflow` and (if needed) any future expansion strategy. The extracted function handles:
- `checkRecursionDepth`
- `evaluateWhenCondition`
- `transitionTask` for skip
- `transitionTask` + `ctx.fail` + `Ref.set("failed")` for error

#### C. `runWorkflow` injects `currentIteration` per-task, never on shared env

Instead of `expandTemplate` mutating `state.workflowEnv.currentIteration` globally, `runWorkflow` maintains a private scope-keyed output cache and injects `currentIteration` only into the `taskEnv` passed to `dispatchTask`. The shared `workflowEnv` is never touched.

```typescript
const iterationOutputs: Record<string, Record<string, { outputs: Record<string, unknown> }>> = {}

// Before dispatching a task:
const scopeKey = taskScopes[instanceName]
const taskEnv = scopeKey
  ? {
      ...workflowEnv,
      currentIteration: { tasks: iterationOutputs[scopeKey] ?? {} },
      parameters: resolvedArgs.parameters
    }
  : { ...workflowEnv, parameters: resolvedArgs.parameters }

yield* _(dispatchTask(task, taskEnv, instanceName, ...))

// After dispatch:
const originalName = originalNames[instanceName]
const output = workflowEnv.tasks?.[instanceName]
if (scopeKey && originalName && output) {
  (iterationOutputs[scopeKey] ??= {})[originalName] = output
}
```

Key properties of this approach:

- **`currentIteration` only exists for tasks produced by a `forEach` loop.** Tasks without a scope key get a plain `taskEnv`.
- **Nested loops don't collide.** A task named `parent/0-sub/1-leaf` has scope key `parent/0-sub/1`. A sibling in a different inner iteration has scope key `parent/0-sub/0`. Different prefixes, isolated outputs.
- **No string parsing.** The scope key is built at expansion time — the same string already used to construct instance names via `buildTaskInstanceName(namePrefix, i)`.
- **No save/restore.** `iterationOutputs` is a plain accumulator. `currentIteration` is a snapshot injected into each task's own `taskEnv` and discarded after dispatch.

#### D. `runWorkflow` uses a loop instead of a single pass

```typescript
let pending = true
const taskScopes: Record<string, string> = {}
const originalNames: Record<string, string> = {}

while (pending) {
  const allTasks = collectAllTasksFromDb(ctx)
  const sorted = topologicalSort(allTasks)
  pending = false

  for (const task of sorted) {
    if (task.template) {
      const result = expandTemplate(ctx, task, spec, env)
      Object.assign(taskScopes, result.taskScopes)
      Object.assign(originalNames, result.originalNames)
      pending = true
      continue
    }

    // ... when-guard, pause check, dispatch (with taskEnv built from taskScopes) ...
  }
}
```

### 4.3 Impact on `currentIteration`

The `currentIteration` context is injected per-task into its own `taskEnv`, allowing `when` conditions like `inputs.currentIteration.tasks.build.outputs.status == "done"` to resolve correctly within an iteration group.

**Data flow**:

```
expandTemplate returns:
  taskScopes:    { "process/0-build" → "process/0", "process/0-check" → "process/0" }
  originalNames: { "process/0-build" → "build",      "process/0-check" → "check" }

runWorkflow accumulates:
  iterationOutputs["process/0"] = { build: { outputs: ... } }

When dispatching "process/0-check":
  taskEnv.currentIteration = { tasks: { build: { outputs: ... } } }
  → when condition "inputs.currentIteration.tasks.build.outputs.status == 'done'" resolves
```

**Nested loops** — scope keys are naturally hierarchical:

```
"parent/0-sub/0-leaf"  → scopeKey = "parent/0-sub/0"   ← distinct
"parent/0-sub/1-leaf"  → scopeKey = "parent/0-sub/1"   ← distinct
"parent/1-sub/0-leaf"  → scopeKey = "parent/1-sub/0"   ← distinct
```

No collision, no flat integer index, no string parsing. The prefix that was already used to construct the instance name becomes the scope key.

---

## 5. Migration Plan

### Step 1: Extract `handleWhenGuard`

Move the when-handling logic out of both `runner.ts` and `template-expander.ts` into a single shared function in `when-guard.ts`. This is low-risk and improves both files immediately.

### Step 2: Refactor `expandTemplate` to return metadata

Change `expandTemplate` to return `{ inserted: string[], iterationGroups: Map<number, string[]> }` but keep it calling `dispatchTask` internally for now. The return value is unused by callers. All existing tests pass.

### Step 3: Add the outer loop to `runWorkflow`

Add a `while` loop that re-sorts and re-processes tasks when new ones are inserted. At this point, `expandTemplate` still calls `dispatchTask` internally — the loop is a no-op for template tasks since they're already executed before the next iteration.

### Step 4: Remove `dispatchTask` from `expandTemplate`

Remove the `dispatchTask` calls and `when` handling from `expandTemplate`. The outer loop now picks up the inserted tasks and dispatches them.

### Step 5: Add per-task `currentIteration` injection to `runWorkflow`

Use `taskScopes` and `originalNames` from `expandTemplate` to build task-scoped `currentIteration` snapshots injected into `taskEnv`. Never mutate shared `workflowEnv`.

### Step 6: Remove dead code from `expandTemplate`

Remove the `when`-guard, failure propagation, `dispatchTask` calls, and `currentIteration` save/restore. It should be ~30 lines of pure graph mutation.

---

## 6. Before/After Comparison

| Metric | Before | After |
|---|---|---|
| `expandTemplate` LOC | 108 | ~30 |
| `expandTemplate` params | 13 | 5 (`ctx`, `task`, `spec`, `env`, `namePrefix?`) |
| `expandTemplate` responsibilities | 10 | 1 (graph mutation) |
| When-handler duplicates | 2 | 1 |
| Execution path count | 2 (runner loop + expandTemplate inline) | 1 (runner loop only) |
| Max nesting depth | 4 | 1 |
| Mutations in `expandTemplate` | 7 categories | 1 (`insertDynamicTask`) |
| `currentIteration` location | mutated on shared `workflowEnv`, save/restore | injected per-task into `taskEnv`, no global mutation |
| `currentIteration` lifetime | set/cleared imperatively by `expandTemplate` | scoped to single dispatch call, garbage collected after |

---

## 7. Risk Assessment

| Risk | Mitigation |
|---|---|---|
| Template sub-tasks depend on sibling outputs via `currentIteration` | Covered by step 5 — `taskEnv` gets a snapshot of the scope-keyed `iterationOutputs` before each dispatch |
| Nested `forEach` loops collide on flat integer indices | Scope keys are hierarchical prefixes (`"parent/0-sub/1"`), not flat integers — naturally isolated |
| Pause/resume is affected by the outer loop | The `shouldPause()` check already exists in `runWorkflow`'s loop; sub-tasks now honour it automatically |
| Performance impact of re-sorting every iteration | `topologicalSort` is O(V+E); for typical workflows (< 100 tasks) this is negligible |
| Regression on recursive templates | The recursion moves from `expandTemplate` calling itself + `dispatchTask` to `expandTemplate` calling itself (inserts only) + the outer loop dispatching — same effect, cleaner separation |

---

## 8. Summary

The core problem is that `expandTemplate` conflates **discovery** (what to run) with **execution** (running it). The fix is to make it a pure graph-mutation function and let `runWorkflow` be the single execution loop that handles dispatch, when-guards, pause checks, and `currentIteration` scoping uniformly for all tasks — static and dynamic alike.

The `currentIteration` problem is solved by scope keys: hierarchical prefixes (`"parent/0-sub/1"`) computed at expansion time (no string parsing) that naturally isolate nested `forEach` loops. `currentIteration` is injected per-task into `taskEnv` and never touches the shared `workflowEnv`, avoiding all global mutation, save/restore, and leakage.

This aligns with the Single Responsibility Principle, eliminates DRY violations, reduces parameter bloat, and makes the architecture extensible for future expansion strategies (`parallel`, `matrix`, `conditional`).
