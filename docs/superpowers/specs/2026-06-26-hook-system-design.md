# Hook System Design

## Summary

Replace the hardcoded `write_task_output` reminder loop in `pi-executor.ts` with a generic hook system. Hooks are user-defined Effect functions that observe, intercept, and transform at six lifecycle points.

## Hook Lifecycle Points

| Hook | When it fires | Key context fields | Can |
|------|--------------|-------------------|-----|
| `on_workflow_start` | After run dir created, before first task dispatched | `runId`, `spec`, `parameters` | cancel workflow, transform parameters |
| `on_task_start` | After `transitionTask("start")`, before agent/script execution | `runId`, `taskId`, `instanceName`, `task`, `env` | cancel task, transform env |
| `on_agent_enter` | After Pi session created, before first prompt | `runId`, `taskId`, `agentId`, `session`, `prompt` | cancel task, transform prompt |
| `on_agent_exit` | After agent prompt completes, session still open | `runId`, `taskId`, `session` | inject prompts (reminders) |
| `on_task_completed` | After task marked complete, before next task | `runId`, `taskId`, `result`, `env` | transform result |
| `on_workflow_completed` | After final status set, before result returned | `runId`, `status`, `taskResults`, `summary` | transform summary |

`on_agent_exit` is where the write-task-output reminder lives. The Pi session is still open at this point, so hooks can inject additional prompts. Since `write_task_output` calls `session.abort()`, a hook can check `session.isActive()` to determine if the output was written — no filesystem checks needed inside hooks.

## Hook Signature

Each hook file in `~/.hamilton/hooks/` exports a single default function. The function name must match one of the six lifecycle points.

```typescript
type HookResult<D> = Effect.Effect<never, never, {
  action: "continue" | "cancel" | "fail"
  data: D
}>
```

Each lifecycle point has a typed context and a typed data generic:

```typescript
type WorkflowStartContext = {
  runId: string
  spec: WorkflowSpec
  parameters: Record<string, unknown>
}
// hook: (ctx: WorkflowStartContext) => HookResult<{ parameters: Record<string, unknown> }>

type TaskStartContext = {
  runId: string
  taskId: string
  instanceName: string
  task: TaskSpec
  env: WorkflowEnv
}
// hook: (ctx: TaskStartContext) => HookResult<{ env: WorkflowEnv }>

type AgentEnterContext = {
  runId: string
  taskId: string
  agentId: string
  session: PiSession
  prompt: string
}
// hook: (ctx: AgentEnterContext) => HookResult<{ prompt: string }>

type AgentExitContext = {
  runId: string
  taskId: string
  session: PiSession
}
// hook: (ctx: AgentExitContext) => HookResult<{}>

type TaskCompletedContext = {
  runId: string
  taskId: string
  result: Record<string, unknown>
  env: WorkflowEnv
}
// hook: (ctx: TaskCompletedContext) => HookResult<{ result: Record<string, unknown> }>

type WorkflowCompletedContext = {
  runId: string
  status: string
  taskResults: Record<string, string>
  summary: WorkflowSummary
}
// hook: (ctx: WorkflowCompletedContext) => HookResult<{ summary: WorkflowSummary }>
```

## Reminder Hook Example

`~/.hamilton/hooks/reminder.ts`:

```typescript
export default function on_agent_exit(ctx: AgentExitContext) {
  return Effect.gen(function* (_) {
    let sent = 0
    const MAX_REMINDERS = 2
    while (ctx.session.isActive() && sent < MAX_REMINDERS) {
      yield* _(Effect.promise(() =>
        ctx.session.prompt("REMINDER: You must call write_task_output to save your work. Call write_task_output now with the JSON task output.")
      ))
      sent++
    }
    return { action: "continue", data: {} }
  })
}
```

If the session is still active after `MAX_REMINDERS` reminders, the hook returns `continue` and the engine proceeds to read the output file (which triggers the existing `PiExecutionError` path if still absent).

## Loading and Validation

A `HookLoader` service scans `~/.hamilton/hooks/` at runtime. For each `.ts` file:

1. Dynamically `import()` the file
2. Read the default export
3. Validate it is a function
4. Validate the function is named (not anonymous) and the name matches one of the six lifecycle points
5. TypeScript enforces parameter types at compile time — no additional runtime type checking is needed

Files that fail validation are logged as warnings and skipped. The filename stem (e.g., `reminder` from `reminder.ts`) is the hook name.

## Registration

Workflow YAML declares hooks by name:

```yaml
name: example
hooks:
  - reminder
  - audit
tasks:
  ...
```

The engine resolves each name to a loaded hook function. If a hook name is not found in the hook directory, the engine logs a warning and skips it.

Hooks can also be registered globally in `~/.hamilton/settings.yaml` (applied to all workflows):

```yaml
hooks:
  global:
    - reminder
```

Workflow-level hooks always fire. Global hooks always fire. If both specify the same hook, it fires once at its lifecycle point.

## Execution

At each lifecycle point, the engine:

1. Collects all registered hooks whose function name matches the point, ordered by registration
2. Runs them sequentially
3. Passes the typed context to each hook
4. If a hook throws or returns an Effect failure: logs the error, continues to the next hook
5. If a hook returns `action: "cancel"`: stops the chain, cancels the task or workflow
6. If a hook returns `action: "fail"`: stops the chain, marks the task or workflow as failed
7. If a hook returns `action: "continue"`: passes transformed `data` to the next hook (merged with the original context)

Pseudo-implementation:

```typescript
function runHooks(point: string, ctx: Record<string, unknown>): Effect<never, never, HookAction> {
  return Effect.gen(function* (_) {
    let data = ctx
    for (const hook of hooksForPoint(point)) {
      const result = yield* _(Effect.either(hook(data)))
      if (Either.isLeft(result)) {
        yield* _(logWarning(`Hook ${hook.name} failed`, result.left))
        continue
      }
      if (result.right.action === "cancel") return "cancel"
      if (result.right.action === "fail") return "fail"
      data = { ...data, ...result.right.data }
    }
    return "continue"
  })
}
```

## Integration Points in the Engine

Hooks are wired in at these locations:

- **`on_workflow_start`**: `runner.ts`, after `createRunDir` + `WorkflowStarted` event, before main loop
- **`on_task_start`**: `task-executor.ts`, after `transitionTask("start")` + `TaskStarted` event, before `buildAgentExecEffect` or `buildScriptExecEffect`
- **`on_agent_enter`**: `pi-executor.ts`, after `createAgentSession`, before `session.prompt(taskPrompt)`
- **`on_agent_exit`**: `pi-executor.ts`, after `session.prompt(taskPrompt)` returns, before reading the output file (replacing the hardcoded reminder loop)
- **`on_task_completed`**: `task-executor.ts`, after `transitionTask("complete")` + `TaskCompleted` event, before next task iteration
- **`on_workflow_completed`**: `runner.ts`, after final status set + `WorkflowCompleted` event, before returning result

## Directory Structure

```
~/.hamilton/hooks/
  reminder.ts        # on_agent_exit — write_task_output reminder
  audit.ts           # on_task_completed — log task results to external system
  prompt_guard.ts    # on_agent_enter — transform prompt before sending

src/hook/
  types.ts           # HookResult, all context types
  loader.ts          # HookLoader service — scan, import, validate
  runner.ts          # runHooks function — collect, execute, handle results
  integration.ts     # Engine wiring — calls runHooks at each lifecycle point
```

## Migration Path

1. Create `src/hook/` with types, loader, runner
2. Wire hooks into engine at all six lifecycle points
3. Move the reminder logic from `pi-executor.ts:238-261` into `~/.hamilton/hooks/reminder.ts`
4. Bundle `reminder.ts` into the manifest so it ships with Hamilton (like agent personas)
5. Remove the hardcoded reminder loop from `pi-executor.ts`
6. Existing behavior is preserved: default workflows get the reminder hook, custom workflows opt in via `hooks: [reminder]`
