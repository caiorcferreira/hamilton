## Context

Hamilton workflows currently have exactly one way to execute a task: delegate to an AI agent via the Pi SDK. Every task with an `agent` field spawns an AI turn — even for operations that are inherently deterministic (running `npm install`, creating a git worktree, executing a test suite). The `deterministic-activities.ts` file proved that synchronous shell operations are useful, but it was never integrated into the task model.

Script tasks add a second execution strategy to the same workflow DAG: run a shell command synchronously, capture its output, and feed it into the downstream task graph just like agent output. No model, no tokens, no AI non-determinism.

## Goals / Non-Goals

**Goals:**
- Let workflows declare shell commands inline via a `script` field on `WorkflowTask`
- Execute script tasks synchronously in the same state machine that governs agent tasks
- Capture stdout, stderr, and exit code as structured output for downstream tasks
- Support `timeout` and `on_failure` (retry) identically to agent tasks
- Keep the type system sound — a task has `script` XOR `agent` (or is a `template`)

**Non-Goals:**
- Async/long-running scripts (streaming output, background processes)
- Script chaining or pipes within a single task (use multiple script tasks)
- Shell selection (always uses `/bin/sh -c` via `child_process.execSync`)
- Script tasks in variant tasks (variants insert tasks into the DAG — script tasks work there automatically if the variant definition uses `script` instead of `agent`)

## Decisions

### 1. TaskScript interface shape

```typescript
export interface TaskScript {
  command: string          // shell command to execute
  workdir?: string         // working directory (defaults to process.cwd())
  timeout?: Timeout        // same shape as TaskAgent.timeout
  on_failure?: OnFailure   // same retry semantics as agent tasks
  output?: OutputConfig    // optional schema validation for stdout/exitCode
}
```

The `command` is a single string passed to `execSync(command, { cwd, timeout })`. No array form — shell operators (`&&`, `||`, `|`) are valid and useful here. Template rendering via `{{inputs.*}}` happens before execution, same as agent prompts.

**Alternative considered**: `command` as `string | string[]` with array form using `spawn`. Rejected because it complicates error handling, removes shell features, and Hamilton workflows are for orchestrating steps — not for building shell pipelines.

### 2. Mutual exclusivity: script vs agent vs template

A `WorkflowTask` must have exactly one of `script`, `agent`, or `template` (or nested `tasks`). This is enforced at the schema level via the existing filter pattern. A task CAN have any of these combined with `template` for the expansion pattern (the referenced template task is the one that carries `script` or `agent`).

**Alternative considered**: Allow `script` as an add-on to `agent` (pre/post hooks). Rejected — it creates ordering ambiguity. Just use separate tasks in the DAG.

### 3. Execution: execSync in Effect

```typescript
const executeScriptTask = (task, taskEnv): Effect =>
  Effect.try({
    try: () => execSync(task.script.command, {
      cwd: task.script.workdir ?? taskEnv.cwd ?? process.cwd(),
      timeout: timeoutMs,
      encoding: "utf-8"
    }),
    catch: (e) => ({ stdout: "", stderr: String(e), exitCode: 1 })
  }).pipe(
    Effect.map((stdout) => ({
      stdout: stdout.trim(),
      stderr: "",
      exitCode: 0,
      status: "done"
    }))
  )
```

The effect always succeeds — non-zero exit codes and timeouts are caught and reflected in the output's `exitCode` and `status` fields. The retry logic in `on_failure` works identically: if `status !== "done"` after execution, the runner's existing retry `Schedule.recurs` fires.

**Alternative considered**: `Effect.tryPromise` with `exec` (async). Rejected — synchronous execution is simpler, the workflow loop is already sequential per task, and `execSync` doesn't block the event loop in a meaningful way for CLI workloads.

### 4. Output structure

```json
{
  "stdout": "string",
  "stderr": "string",
  "exitCode": 0,
  "status": "done"
}
```

This is published to `workflowEnv.tasks[taskName].outputs` — downstream tasks access it as `{{inputs.tasks.<name>.outputs.stdout}}`, `{{inputs.tasks.<name>.outputs.exitCode}}`, etc. The `status` field mirrors agent task output conventions.

**Alternative considered**: Flat string output only. Rejected — structured output enables downstream conditional logic (`when` CEL expressions can check exit codes).

### 5. State machine integration

Script tasks use the same `taskName` registration, `transitionTask("start")` / `transitionTask("complete")` / `transitionTask("fail")` transitions, and compound task IDs as agent tasks. `collectAllTaskNames` in the runtime must be extended to include script tasks (currently only collects tasks with `agent`).

### 6. Retry and timeout

`on_failure.max_retries` and `timeout.fixed` work identically for script tasks. The runner's existing retry loop (`Schedule.recurs`) re-executes the command on failure. Timeout uses `execSync`'s native timeout option + `Effect.timeout` as a safety net.

## Risks / Trade-offs

- **[Shell injection]**: Template variables in `command` come from workflow YAML and upstream task outputs — both are trusted sources (YAML authored by developers, outputs validated by JSON schema). No external user input reaches the command string. → Acceptable risk. Document that YAML authors are responsible for command safety.
- **[Output size]**: `execSync` buffers the entire stdout. A script that outputs gigabytes could exhaust memory. → Mitigation: enforce a configurable `maxOutputBytes` truncation on stdout/stderr via `settings.yaml` (`script.maxOutputBytes`, defaulting to 65536 bytes / 64KB). The timeout field provides a secondary safeguard.
- **[Cross-platform]**: `execSync` with `/bin/sh -c` doesn't work on native Windows (no bash). → Hamilton targets macOS/Linux. Document this constraint. Windows users can use WSL.
- **[Environment leakage]**: Script tasks inherit the parent process environment. → This is intentional — scripts should see `PATH`, `HOME`, etc. If isolation is needed, a separate task can export environment.
