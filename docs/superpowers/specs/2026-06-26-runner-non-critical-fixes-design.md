# Design: Runner Non-Critical Fixes (Audit Issues #10, #11, #13, #14)

## Overview

Resolve the 4 remaining non-critical issues from the `runner.ts` code-quality audit, now that issues #1-#9 were addressed by the decomposition refactor.

**Scope:** `src/workflow/runner.ts`, `src/workflow/task-executor.ts`, and their tests.

## Issue #11: workflowStatus as Effect.Ref with Lifecycle States

**Current:** `const workflowStatus = { value: "completed" as string }` — a mutable ref object with only 3 values (`"completed"`, `"failed"`, `"paused"`), mutated across 6+ sites.

**Design:** Replace with `Effect.Ref<"planned" | "in-progress" | "completed" | "failed" | "paused">`.

### Lifecycle

```
planned → in-progress → completed
                      → failed
                      → paused
```

- **planned**: set at `runner.ts` start, before execution begins. Emitted via `bus.publish({ _tag: "WorkflowStatusChanged", status: "planned" })`.
- **in-progress**: set in runner's task loop immediately before the first task iteration. Emitted via event.
- **completed** / **failed** / **paused**: set at conclusion. Already emitted via `WorkflowCompleted` summary.

### How it works

Runner creates the Ref:
```typescript
const workflowStatus = yield* _(Effect.Ref.make<...>("planned"))
```

All reads use `yield* _(Ref.get(workflowStatus))`. All writes use `yield* _(Ref.set(workflowStatus, "failed"))`.

`TaskExecutionState.workflowStatus` changes type from `{ value: string }` to `Effect.Ref<...>`. Consumers in `task-executor.ts` use `yield* _(Ref.set(...))`.

The `TaskExecutionState` interface does NOT gain a `Scope` dependency — `Ref.make` happens in runner, where `Scope` is already available.

## Issue #14: Extract `withTaskLifecycle`

**Current:** `executeAgentTask` and `executeScriptTask` share ~40 lines of identical boilerplate: retry scheduling, `TaskRetrying` event, failure state mutation, success state mutation, `writeTaskOutput`, `TaskCompleted`/`TaskFailed`/`TaskTimedOut` events.

**Design:** Extract a `withTaskLifecycle` helper in `task-executor.ts` that wraps raw execution with lifecycle management.

### Signature

```typescript
function withTaskLifecycle<O>(
  task: WorkflowTask,
  instanceName: string,
  taskId: string,
  ctx: WorkflowRuntime,
  fileEnabled: boolean,
  state: TaskExecutionState,
  maxRetries: number,
  execute: Effect.Effect<O, unknown, EventBus | Scope.Scope>
): Effect.Effect<void, unknown, EventBus | Scope.Scope>
```

### Behavior

1. Wraps `execute` with `Effect.retry(Schedule.recurs(maxRetries - 1))` + `TaskRetrying` event per attempt
2. On success: records result, calls `ctx.transitionTask("complete")`, writes output (if `fileEnabled`), publishes `TaskCompleted`
3. On `TaskTimedOut`: transitions to `"fail"`, sets `workflowStatus` to `"failed"`, publishes `TaskTimedOut`
4. On generic failure: transitions to `"fail"`, sets `workflowStatus` to `"failed"`, publishes `TaskFailed`

### Each executor shrinks to its core

`executeAgentTask` returns only the agent execution `Effect` (prompt building + `executeWithPi`). No lifecycle code.

`executeScriptTask` returns only the script execution `Effect` (`ChildProcess.execSync` + output handling). No lifecycle code.

`dispatchTask` calls `withTaskLifecycle(..., executeAgentTask(...))` or `withTaskLifecycle(..., executeScriptTask(...))`.

### Task result recording

The result-recording pattern (`state.taskResults[instanceName] = ...; state.workflowEnv.tasks[instanceName] = ...`) differs slightly between agent and script. Each executor returns a result payload, and `withTaskLifecycle` stores it. The payload type is `{ status: string; outputs?: Record<string, unknown> }`.

## Issue #10: `fileEnabled` Propagation Cleanup

**Current:** `fileEnabled` threaded as a parameter through `runner.ts` → `expandTemplate` → `dispatchTask` → `executeAgentTask`/`executeScriptTask`. Total 6 call sites.

**Design:** After Issue #14, the only consumer of `fileEnabled` is `withTaskLifecycle` (for `writeTaskOutput` on success). So:

- `executeAgentTask` drops the `fileEnabled` parameter
- `executeScriptTask` drops the `fileEnabled` parameter
- `dispatchTask` drops the `fileEnabled` parameter
- `expandTemplate` drops the `fileEnabled` parameter
- Runner retains it for `createRunDir`/`writeInput` (setup phase, lines 63-65)
- `withTaskLifecycle` receives it directly

Net: 4 call sites eliminated. `fileEnabled` lives in 2 places: runner setup + lifecycle wrapper.

## Issue #13: `WorkflowResult.env` type

**Current:** `WorkflowResult.env: WorkflowEnv` but the actual value is a mutated runtime bag with `tasks`, `run_id`, `parameters`, etc. — broader than `WorkflowEnv`.

**Design:** Change to `env: Record<string, unknown>`. The returned object in runner.ts casts `workflowEnv as Record<string, unknown>`. The interface no longer lies about its shape.

### Updated interface

```typescript
export interface WorkflowResult {
  runId: string
  status: "planned" | "in-progress" | "completed" | "failed" | "paused"
  taskResults: Record<string, string>
  env: Record<string, unknown>
  startedAt: string
  completedAt: string
}
```

Note: `status` gains `"planned"` and `"in-progress"` from Issue #11.

## Testing

### Tests to modify

- `tests/workflow/runner.test.ts`: verify status lifecycle (planned → in-progress → completed/failed/paused), verify `env` contains runtime keys
- `tests/workflow/runner-regression.test.ts`: same lifecycle + `WorkflowResult.env` shape checks
- `tests/workflow/runner-recursion.test.ts`: ensure status transitions under recursion
- `tests/e2e/workflows.test.ts`: verify workflow completion events carry new status values

### Tests to create

- `tests/workflow/task-executor.test.ts`: verify `withTaskLifecycle` retry, timeout, success, failure paths for both agent and script

### What does NOT change

- `db/subscribers.ts`, `observability/subscribers.ts`, `events/bus.ts`: no event schema changes needed (status already flows via summary)
- `template-expander.ts`, `when-guard.ts`, `guidelines/extractor.ts`: no changes

## Affected Files

| File | Change |
|------|--------|
| `src/workflow/runner.ts` | `workflowStatus` → `Effect.Ref`, status lifecycle, `WorkflowResult` type update |
| `src/workflow/task-executor.ts` | `TaskExecutionState` type update, `withTaskLifecycle` extraction, parameter cleanup |
| `tests/workflow/runner.test.ts` | Lifecycle + env shape assertions |
| `tests/workflow/runner-regression.test.ts` | Lifecycle + env shape assertions |
| `tests/workflow/runner-recursion.test.ts` | Status assertions under recursion |
| `tests/e2e/workflows.test.ts` | Status assertions |
| `tests/workflow/task-executor.test.ts` | New: lifecycle wrapper tests |
