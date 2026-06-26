# Decompose `src/workflow/runner.ts` God Function

Refactor the 480-line `runWorkflow` function in `src/workflow/runner.ts` into focused modules,
addressing the 9 critical issues identified in the code-quality audit.

## Critical Issues Addressed

| # | Issue | Fix |
|---|-------|-----|
| 1 | Inline type import inside function body | Moved to `src/guidelines/extractor.ts` as static import |
| 2 | God function (12 responsibilities) | Decomposed into 5 new modules + thin orchestrator |
| 3 | 8 indentation levels | Recursive template expansion instead of manual unrolling |
| 4 | Duplicated recursion-depth logic | Extracted to `checkRecursionDepth` in `when-guard.ts` |
| 5 | Duplicated when-evaluation logic | Extracted to `evaluateWhenCondition` in `when-guard.ts` |
| 6 | Raw SQL in orchestration code | `getTaskDepth` added to `WorkflowRuntime`; DB hidden behind interface |
| 7 | Half-baked event-driven architecture | `RunDirSubscriber` replaces all direct `appendEngineLog` calls |
| 8 | Manual non-recursive template nesting | Recursive `expandTemplate` handles arbitrary depth |
| 9 | No canonical task-name builder | `buildTaskInstanceName` in `engine.ts` |

## New Modules

### `src/guidelines/extractor.ts`

Responsibility: flatten loaded guidelines into files and rules arrays.

```ts
export function extractGuidelineArtifacts(loaded: LoadedGuideline[]): {
  files: Array<{ name: string; content: string }>
  rules: CompiledRule[]
}
```

Pure function — no Effect, no DB, no file I/O. Caller passes the result of `loadGuidelines()`.

### `src/workflow/when-guard.ts`

Responsibility: check whether a task should proceed, skip, or fail.

```ts
export function checkRecursionDepth(
  ctx: WorkflowRuntime,
  maxDepth: number | null,
  taskName: string
): Effect.Effect<"proceed" | "fail", EngineError>

export function evaluateWhenCondition(
  task: WorkflowTask,
  env: WorkflowEnv
): "proceed" | "skip" | Error
```

`checkRecursionDepth` calls `ctx.getTaskDepth(taskName)` — no raw SQL at this layer.
`evaluateWhenCondition` is a sync wrapper around `evaluateWhen` from the CEL module.
Error case wraps `WhenError` for consistent handling by the orchestrator.

### `src/workflow/task-executor.ts`

Responsibility: execute agent and script tasks with retry, result recording, and event publishing.

```ts
export function executeAgentTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  taskId: string,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: SkillRegistry,
  templateOptions: TemplateOptions,
  fileEnabled: boolean
): Effect.Effect<void, unknown, EventBus | Scope.Scope>

export function executeScriptTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  taskId: string,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  templateOptions: TemplateOptions,
  scriptConfig: ScriptConfig,
  fileEnabled: boolean
): Effect.Effect<void, unknown, EventBus | Scope.Scope>

export function dispatchTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  ctx: WorkflowRuntime,
  spec: WorkflowSpec,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: SkillRegistry,
  templateOptions: TemplateOptions,
  scriptConfig: ScriptConfig,
  fileEnabled: boolean
): Effect.Effect<void, unknown, EventBus | Scope.Scope>
```

`dispatchTask` handles agent-vs-script branching, `TaskStarted`/`TaskCompleted` event publishing,
and compound task ID resolution.

Shared retry/result/emit boilerplate is extracted into an internal `withTaskLifecycle` helper that
both `executeAgentTask` and `executeScriptTask` use. Each executor provides only its unique
execution logic (`executeWithPi` vs `ChildProcess.execSync`).

### `src/workflow/template-expander.ts`

Responsibility: recursively expand template tasks for `forEach` iteration patterns.

```ts
export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  executeSingleTask: (task: WorkflowTask, env: WorkflowEnv, name: string) => Effect.Effect<void, unknown, EventBus | Scope.Scope>,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: SkillRegistry,
  templateOptions: TemplateOptions,
  scriptConfig: ScriptConfig,
  fileEnabled: boolean
): Effect.Effect<void, unknown, EventBus | Scope.Scope>
```

Recursive — handles arbitrary nesting depth instead of the current 2-level manual unrolling.
Uses `buildTaskInstanceName` from `engine.ts` for all task-name construction.
Calls `executeSingleTask` as a callback for consistent task execution semantics.

### `src/observability/run-dir-subscriber.ts`

Responsibility: persist workflow lifecycle events to `events.jsonl` and `summary.json` via the
event bus, replacing all direct file I/O calls in the orchestrator.

```ts
export const RunDirSubscriber: Effect.Effect<void, never, Scope.Scope | EventBus>
```

Subscribes to:
- `WorkflowStarted` → writes `{event: "workflow_started", workflowId}` to `events.jsonl`
- `WorkflowCompleted` → writes `{event: "workflow_completed", status}` or
  `{event: "workflow_failed", error}` to `events.jsonl`, then `writeSummary(summary)` using
  the summary data from the event payload (see event-type change below)

Reads `fileEnabled` from `TelemetryConfig` internally — the orchestrator never checks this flag.
Does not handle task output files — those remain in the task executor (`writeTaskOutput`).

**Event-type change**: `WorkflowCompleted` gains an optional `summary` field:

```ts
{ readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string; readonly summary?: WorkflowSummary }
```

The orchestrator assembles the summary, attaches it to the `WorkflowCompleted` event, and
publishes. `RunDirSubscriber` extracts it and calls `writeSummary`. No shared mutable state
between orchestrator and subscriber.

Task output files (`writeTaskOutput`) remain in the task executor — the executor has the output
in hand after execution, and writing it before publishing `TaskCompleted` is naturally coupled
to task lifecycle. No benefit to bouncing it through the event bus.

## Modified Modules

### `src/workflow/engine.ts` (addition)

```ts
export function buildTaskInstanceName(
  parent: string,
  child: string,
  index?: number
): string
```

Single source of truth for all task instance name construction. Replaces 3 inline string
interpolation sites in `runner.ts`.

### `src/workflow/run-state-machine.ts` (addition)

```ts
// Added to WorkflowRuntime interface:
readonly getTaskDepth: (taskName: string) => Effect.Effect<number | null, EngineError>
```

Encapsulates the `SELECT depth FROM tasks WHERE id = ?` query. Implementation lives in
`WorkflowRuntimeImpl` alongside the existing DB-access methods.

## Thin Orchestrator (`src/workflow/runner.ts`)

The rebuilt `runWorkflow` is approximately 70 lines:

1. Creates `WorkflowRuntime` via `createWorkflowRuntime`
2. Sets up `DbWriter` subscriber (existing)
3. Sets up `RunDirSubscriber` (new)
4. Calls `loadGuidelines()` → `extractGuidelineArtifacts()`
5. Calls `loadSkillRegistry()`
6. Loads `TelemetryConfig` and `ScriptConfig`
7. Iterates `sortedTasks`:
   - Guards with `checkRecursionDepth` + `evaluateWhenCondition`
   - Templates: delegates to `expandTemplate`
   - Regular tasks: delegates to `dispatchTask`
   - Pause check: `ctx.shouldPause()`
8. On completion: `ctx.complete()` or `ctx.fail()`
9. Returns `WorkflowResult`

The orchestrator has no:
- Direct `appendEngineLog` or `writeSummary` calls (handled by `RunDirSubscriber`)
- Raw SQL or `ctx.db` access
- Inline guideline/rule extraction loops
- Repeated `if (fileEnabled)` guards at every persistence call site
  (one read from `TelemetryConfig`, passed to subscriber and executor once)
- Mutable `workflowStatus` string (reads `ctx.state` instead)
- Inline task-name string interpolation
- `writeTaskOutput` calls (those stay in the task executor, naturally coupled to task lifecycle)

Token usage tracking remains as a subscriber (same pattern as today) — `body` creates a
`TokenUsage` subscriber that increments `totalTokensIn`/`totalTokensOut`. These counters are
passed to `RunDirSubscriber` for inclusion in the summary.

## Signature Change

```ts
// before
export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  config: WorkflowRunnerConfig,
  templateOptions: TemplateOptions,
  existingRunId?: string
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope>

// after
export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  templateOptions: TemplateOptions,
  existingRunId?: string,
  maxRecursionDepth?: number
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope>
```

`WorkflowRunnerConfig` is removed:
- `workflowsDir` was unused in the function body
- `maxRecursionDepth` becomes a direct optional parameter (falls back to `spec.spec.run.max_recursion_depth`, then `null`)
- `projectDir` comes from `initialParameters.project_dir` (already set by callers) or defaults to `process.cwd()`

`WorkflowResult` is narrowed: constructed from `ctx.state` (read-only) instead of spreading the
mutable `workflowEnv` bag.

## Error Handling

Each module uses existing error types, no new error classes:

| Module | Error types |
|--------|------------|
| `when-guard.ts` | `EngineError` (depth check), `Error` from `WhenError` (CEL eval) |
| `task-executor.ts` | `PiExecutionError`, `RunDirError`, `EngineError` |
| `template-expander.ts` | `EngineError` (via ctx calls), `WhenError` (via when-guard) |
| `run-dir-subscriber.ts` | `RunDirError` |
| `runner.ts` (orchestrator) | Catches all via `Effect.catchAll` at top level |

The orchestrator's top-level `catchAll` publishes `WorkflowCompleted` with error message and
returns a `failed` result — same behavior as today.

## Migration Strategy

Implemented in 5 sequential steps, each independently testable:

1. **Extract leaf modules** — `extractGuidelineArtifacts`, `buildTaskInstanceName`, `getTaskDepth`.
   Update `runner.ts` to use them. Tests pass unchanged.
2. **Extract when-guard** — `checkRecursionDepth` + `evaluateWhenCondition`. Replace inline
   blocks in `runner.ts`. Tests pass unchanged.
3. **Extract task executor** — `executeAgentTask`, `executeScriptTask`, `dispatchTask`.
   Update runner imports. Tests pass unchanged.
4. **Extract template expander** — recursive `expandTemplate`. Replace manual nesting blocks
   in `runner.ts`. Tests pass unchanged.
5. **Build RunDirSubscriber + thin orchestrator** — create subscriber, remove all
   `appendEngineLog`/`writeSummary`/`writeTaskOutput` calls from runner, strip `fileEnabled`
   checks. Tests updated to subscribe to events instead of checking file system for summary.
   Function signature simplified.

At every step, all 550 tests pass. Public behavior is preserved.

## Dependencies Between Modules

```
runner.ts (orchestrator)
 ├── guidelines/extractor.ts    (pure function, no deps)
 ├── workflow/when-guard.ts     (→ WorkflowRuntime, cel/evaluate)
 ├── workflow/task-executor.ts  (→ WorkflowRuntime, EventBus, executors/pi, node:child_process)
 ├── workflow/template-expander.ts (→ WorkflowRuntime, when-guard, task-executor, engine)
 └── observability/run-dir-subscriber.ts (→ EventBus, observability/run-dir, telemetry/config)
```

No circular dependencies. Each module depends only on lower-level or peer abstractions.
