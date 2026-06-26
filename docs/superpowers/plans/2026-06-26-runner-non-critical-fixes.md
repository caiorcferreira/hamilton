# Runner Non-Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve audit issues #10, #11, #13, #14 — workflowStatus as Effect.Ref with lifecycle, withTaskLifecycle extraction, fileEnabled propagation cleanup, WorkflowResult.env type fix.

**Architecture:** `workflowStatus` stored as `Effect.Ref<"planned" | ...>` on `TaskExecutionState`. `fileEnabled` added to `TaskExecutionState` so template-expander and dispatchTask don't pass it as a parameter. `withTaskLifecycle` wrapper handles retry, events, and result recording. `executeAgentTask`/`executeScriptTask` become internal functions returning raw Effects. `WorkflowResult.env` → `Record<string, unknown>`.

**Tech Stack:** TypeScript, bun, Effect-TS 3.21.3, vitest

---

### Task 1: Add WorkflowStatusChanged event to EventBus

**Files:**
- Modify: `src/events/bus.ts:12`

- [ ] **Step 1: Add the event type**

Insert after line 12 (`WorkflowStarted`):
```typescript
  | { readonly _tag: "WorkflowStatusChanged"; readonly runId: string; readonly status: string }
```

Result — event type at line 11-13:
```typescript
  | { readonly _tag: "WorkflowStarted"; readonly runId: string }
  | { readonly _tag: "WorkflowStatusChanged"; readonly runId: string; readonly status: string }
  | { readonly _tag: "TaskStarted"; readonly runId: string; readonly taskId: string; readonly taskName: string }
```

- [ ] **Step 2: Verify build**

```bash
bun run build
```
Expected: clean compile (event added to union, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/events/bus.ts
git commit -m "feat: add WorkflowStatusChanged event to EventBus"
```

---

### Task 2: workflowStatus as Effect.Ref + WorkflowResult type update in runner

**Files:**
- Modify: `src/workflow/runner.ts` (entire file)

- [ ] **Step 1: Add Ref import**

Change line 1 from:
```typescript
import { Effect, Scope } from "effect"
```
to:
```typescript
import { Effect, Ref, Scope } from "effect"
```

- [ ] **Step 2: Update WorkflowResult interface**

Replace lines 28-35:
```typescript
export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
  env: WorkflowEnv
  startedAt: string
  completedAt: string
}
```
with:
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

- [ ] **Step 3: Replace workflowStatus with Effect.Ref**

Replace lines 92-101:
```typescript
    const taskResults: Record<string, string> = {}
    let totalTokensIn = 0
    let totalTokensOut = 0
    const workflowStatus = { value: "completed" as string }

    const execState = {
      workflowStatus,
      taskResults,
      workflowEnv
    }
```
with:
```typescript
    const taskResults: Record<string, string> = {}
    let totalTokensIn = 0
    let totalTokensOut = 0
    const workflowStatus = yield* _(Effect.Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("planned"))

    yield* _(bus.publish({ _tag: "WorkflowStatusChanged", runId: ctx.runId, status: "planned" }))

    const execState = {
      workflowStatus,
      taskResults,
      workflowEnv,
      fileEnabled
    }
```

- [ ] **Step 4: Publish in-progress transition**

After line 110 (the TokenUsage subscriber closing `}))`), insert before line 112 (`for (const task of sortedTasks)`):

```typescript
      yield* _(Ref.set(workflowStatus, "in-progress"))
      yield* _(bus.publish({ _tag: "WorkflowStatusChanged", runId: ctx.runId, status: "in-progress" }))
```

- [ ] **Step 5: Replace reads with Ref.get**

Line 113 for-loop guard:
```typescript
        if (workflowStatus.value === "failed") break
```
becomes:
```typescript
        const currentStatus = yield* _(Ref.get(workflowStatus))
        if (currentStatus === "failed") break
```

Lines 164-167 completion/fail block:
```typescript
      if (workflowStatus.value === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus.value === "failed") {
        yield* _(ctx.fail(workflowStatus.value).pipe(Effect.catchAll(() => Effect.void)))
      }
```
becomes:
```typescript
      const finalStatus = yield* _(Ref.get(workflowStatus))
      if (finalStatus === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (finalStatus === "failed") {
        yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
      }
```

Line 171 summary assignment:
```typescript
      const summary = { runId: ctx.runId, status: workflowStatus.value, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }
```
becomes:
```typescript
      const summary = { runId: ctx.runId, status: finalStatus, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }
```

Line 175 return statement:
```typescript
      return { runId: ctx.runId, status: workflowStatus.value as WorkflowResult["status"], taskResults, env: workflowEnv, startedAt, completedAt }
```
becomes:
```typescript
      return { runId: ctx.runId, status: finalStatus, taskResults, env: workflowEnv as Record<string, unknown>, startedAt, completedAt }
```

Line 183 catchAll return (env cast):
```typescript
          return { runId: ctx.runId, status: "failed" as const, taskResults, env: workflowEnv, startedAt, completedAt: new Date().toISOString() }
```
becomes:
```typescript
          return { runId: ctx.runId, status: "failed" as const, taskResults, env: workflowEnv as Record<string, unknown>, startedAt, completedAt: new Date().toISOString() }
```

- [ ] **Step 6: Replace .value writes with Ref.set**

Line 119 (when recursion depth fails):
```typescript
            workflowStatus.value = "failed"
            break
```
becomes:
```typescript
            yield* _(Ref.set(workflowStatus, "failed"))
            break
```

Line 131 (when when-condition fails):
```typescript
            workflowStatus.value = "failed"
            break
```
becomes:
```typescript
            yield* _(Ref.set(workflowStatus, "failed"))
            break
```

Line 150 (pause):
```typescript
          workflowStatus.value = "paused"
          break
```
becomes:
```typescript
          yield* _(Ref.set(workflowStatus, "paused"))
          break
```

- [ ] **Step 7: Drop fileEnabled from expandTemplate call**

Line 138:
```typescript
          yield* _(expandTemplate(ctx, task, spec, workflowEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
```
becomes:
```typescript
          yield* _(expandTemplate(ctx, task, spec, workflowEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))
```

- [ ] **Step 8: Drop fileEnabled from dispatchTask call**

Line 159:
```typescript
        yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
```
becomes:
```typescript
        yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))
```

- [ ] **Step 9: Verify build**

```bash
bun run build
```
Expected: compile errors in template-expander.ts and task-executor.ts (param counts changed). Ignore — those files are fixed in Tasks 3 and 4. If runner.ts itself compiles clean aside from those call-site errors, proceed.

- [ ] **Step 10: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "refactor: workflowStatus as Effect.Ref, WorkflowResult.env as Record<string, unknown>"
```

---

### Task 3: withTaskLifecycle + fileEnabled in TaskExecutionState + slim executors

**Files:**
- Modify: `src/workflow/task-executor.ts` (entire file)

- [ ] **Step 1: Add Ref import**

Change line 1 from:
```typescript
import { Effect, Schedule, Duration, Scope } from "effect"
```
to:
```typescript
import { Effect, Ref, Schedule, Duration, Scope } from "effect"
```

- [ ] **Step 2: Update TaskExecutionState**

Replace lines 18-22:
```typescript
export interface TaskExecutionState {
  workflowStatus: { value: string }
  taskResults: Record<string, string>
  workflowEnv: WorkflowEnv
}
```
with:
```typescript
export interface TaskExecutionState {
  workflowStatus: Ref.Ref<"planned" | "in-progress" | "completed" | "failed" | "paused">
  taskResults: Record<string, string>
  workflowEnv: WorkflowEnv
  fileEnabled: boolean
}
```

- [ ] **Step 3: Add withTaskLifecycle**

Insert after `TaskExecutionState` (after line 22, before `executeAgentTask`):

```typescript
function withTaskLifecycle<O extends { status?: string }>(
  instanceName: string,
  taskId: string,
  ctx: WorkflowRuntime,
  state: TaskExecutionState,
  maxRetries: number,
  execute: Effect.Effect<O, unknown, EventBus | Scope.Scope>
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)

    yield* _(
      execute.pipe(
        Effect.retry(
          Schedule.recurs(maxRetries - 1).pipe(
            Schedule.tapInput(() =>
              Effect.gen(function* (_) {
                yield* _(bus.publish({ _tag: "TaskRetrying", runId: ctx.runId, taskId, taskName: instanceName }))
              }).pipe(Effect.catchAll(() => Effect.void))
            )
          )
        ),
        Effect.match({
          onSuccess: (result) => {
            if (result === undefined || result === null) {
              return Effect.gen(function* (_) {
                yield* _(bus.publish({ _tag: "TaskTimedOut", runId: ctx.runId, taskId, taskName: instanceName }))
                yield* _(ctx.transitionTask(instanceName, "fail"))
                yield* _(Ref.set(state.workflowStatus, "failed"))
              })
            }
            return Effect.gen(function* (_) {
              state.taskResults[instanceName] = String(result.status ?? "done")
              if (!state.workflowEnv.tasks) state.workflowEnv.tasks = {}
              state.workflowEnv.tasks[instanceName] = { outputs: result as Record<string, unknown> }
              yield* _(ctx.transitionTask(instanceName, "complete"))
              if (state.fileEnabled) {
                yield* _(writeTaskOutput(ctx.runId, taskId, result))
              }
              yield* _(bus.publish({ _tag: "TaskCompleted", runId: ctx.runId, taskId, taskName: instanceName }))
            })
          },
          onFailure: (cause) => {
            return Effect.gen(function* (_) {
              yield* _(bus.publish({ _tag: "TaskFailed", runId: ctx.runId, taskId, taskName: instanceName, message: String(cause) }))
              yield* _(ctx.transitionTask(instanceName, "fail"))
              yield* _(Ref.set(state.workflowStatus, "failed"))
            })
          }
        })
      )
    )
  })
}
```

- [ ] **Step 4: Replace executeAgentTask with buildAgentExecEffect (internal)**

Replace the `executeAgentTask` function (lines 24-120) with:

```typescript
function buildAgentExecEffect(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  spec: WorkflowSpec,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  agent: NonNullable<ReturnType<WorkflowSpec["agentRegistry"]["get"]>>,
  taskId: string
): Effect.Effect<unknown, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const fragments = yield* _(
      resolveSystemPromptFragments(agent.systemPrompt, agent.dirPath).pipe(
        Effect.mapError((e) => new Error(e.agentPath))
      )
    )

    const agentPrompts = buildAgentsPrompts({
      fragments,
      taskPrompt: task.agent!.prompt,
      outputSchema: task.agent?.output?.schema?.content,
      userInput: taskEnv.user_input ?? undefined,
      isEntrypoint: task.name === spec.spec.run.entrypoint,
      env: taskEnv,
      agentConfig: agent
    }, guidelineFiles, templateOptions)

    const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)
    const resolved = resolveAgentDefaults(agent.spec.settings, agent.spec.systemPrompt)
    const aliases = loadModelAliases()
    const model = resolveModelAlias(resolved.model, aliases)
    const outputSchema = task.agent!.output?.schema

    return yield* _(
      executeWithPi({
        prompt: {
          systemTemplate: agentPrompts.systemTemplate,
          taskTemplate: agentPrompts.taskTemplate,
          guidelineFiles: agentPrompts.guidelineFiles
        },
        taskId,
        agentId: agent.metadata.name,
        runId: ctx.runId,
        timeoutSeconds,
        model,
        outputSchema: outputSchema?.content,
        rules: allRules.length > 0 ? allRules : undefined,
        settings: {
          skills: resolveSkills(resolved.skills, skillRegistry),
          thinking: undefined,
          tools: undefined,
          retryOnTransient: undefined,
          compactionEnabled: undefined
        }
      }).pipe(
        Effect.timeout(Duration.seconds(timeoutSeconds))
      )
    )
  })
}
```

Note: `buildAgentExecEffect` is NOT exported — only used inside `dispatchTask`.

- [ ] **Step 5: Replace executeScriptTask with buildScriptExecEffect (internal)**

Replace the `executeScriptTask` function (currently lines 122-203) with:

```typescript
function buildScriptExecEffect(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  spec: WorkflowSpec,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number }
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number; status: string }, { stdout: string; stderr: string; exitCode: number; status: string }> {
  return Effect.gen(function* (_) {
    const renderedCommand = Effect.runSync(
      Template.make(task.script!.command, templateOptions)
        .setInputEnv(taskEnv as Record<string, unknown>)
        .render()
    )
    const workdir = task.script!.workdir ?? (taskEnv.project_dir as string | undefined) ?? process.cwd()

    return yield* _(
      Effect.try({
        try: () => {
          const stdout = ChildProcess.execSync(renderedCommand, {
            cwd: workdir,
            timeout: resolveTaskTimeout(task, spec.spec.run.timeout) * 1000,
            encoding: "utf-8",
            maxBuffer: scriptConfig.maxOutputBytes
          })
          return { stdout: stdout.trim(), stderr: "", exitCode: 0, status: "done" as const }
        },
        catch: (e: any) => {
          const stdout = (e.stdout as string | undefined) ?? ""
          const stderr = (e.stderr as string | undefined) ?? String(e)
          const exitCode = (e.status as number | undefined) ?? 1
          return { stdout: String(stdout).trim(), stderr: String(stderr), exitCode, status: "failed" as const }
        }
      }).pipe(
        Effect.flatMap((result) =>
          result.status === "done" ? Effect.succeed(result) : Effect.fail(result)
        )
      )
    )
  })
}
```

Note: `buildScriptExecEffect` is NOT exported — only used inside `dispatchTask`.

- [ ] **Step 6: Rewrite dispatchTask**

Replace the entire `dispatchTask` function (currently lines 205-232) with:

```typescript
export function dispatchTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  ctx: WorkflowRuntime,
  spec: WorkflowSpec,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  state: TaskExecutionState
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(ctx.runId, instanceName)

    yield* _(ctx.transitionTask(instanceName, "start"))
    yield* _(bus.publish({ _tag: "TaskStarted", runId: ctx.runId, taskId, taskName: instanceName }))

    if (task.agent) {
      const agent = spec.agentRegistry.get(task.agent.executorRef)
      if (!agent) return
      const maxRetries = task.agent!.on_failure?.max_retries ?? 1
      const execEffect = buildAgentExecEffect(task, taskEnv, spec, guidelineFiles, allRules, skillRegistry, templateOptions, agent, taskId)
      yield* _(withTaskLifecycle(instanceName, taskId, ctx, state, maxRetries, execEffect))
    } else if (task.script) {
      const maxRetries = task.script.on_failure?.max_retries ?? 1
      const execEffect = buildScriptExecEffect(task, taskEnv, spec, templateOptions, scriptConfig)
      yield* _(withTaskLifecycle(instanceName, taskId, ctx, state, maxRetries, execEffect))
    }
  })
}
```

- [ ] **Step 7: Remove unused imports**

After the refactor:
- Keep: `Effect, Ref, Schedule, Duration, Scope` from "effect"
- Keep: `EventBus` from "../events/bus.js"
- Keep: `WorkflowSpec, WorkflowTask` from "../types.js"
- Keep: `WorkflowEnv` from "./env.js"
- Keep: `WorkflowRuntime` from "./run-state-machine.js"
- Keep: `TemplateOptions` from "../prompts/template.js"
- Keep: `Template` from "../prompts/template.js"
- Keep: `buildAgentsPrompts` from "../prompts/builder.js"
- Keep: `resolveSystemPromptFragments` from "../prompts/system.js"
- Keep: `resolveAgentDefaults, loadModelAliases, resolveModelAlias` from "../agent/config.js"
- Keep: `executeWithPi` from "../executors/pi/pi-executor.js"
- Keep: `resolveTaskTimeout, buildTaskId` from "./engine.js"
- Keep: `writeTaskOutput` from "../observability/run-dir.js"
- Keep: `ChildProcess` from "node:child_process"
- Keep: `CompiledRule` from "../guidelines/types.js"
- Keep: `resolveSkills` from "../skills/registry.js"

No imports change — all are still used.

- [ ] **Step 8: Verify build**

```bash
bun run build
```
Expected: clean compile

- [ ] **Step 9: Commit**

```bash
git add src/workflow/task-executor.ts
git commit -m "refactor: extract withTaskLifecycle, put fileEnabled in TaskExecutionState"
```

---

### Task 4: Drop fileEnabled from template-expander

**Files:**
- Modify: `src/workflow/template-expander.ts:13-28, 30, 40, 81, 91, 102`

- [ ] **Step 1: Remove fileEnabled from signature**

Change the function declaration at line 13-28. Remove `fileEnabled: boolean,`:

Before:
```typescript
export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  maxDepth: number | null,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  fileEnabled: boolean,
  state: TaskExecutionState,
  parentCompoundId?: string,
  namePrefix?: string
)
```

After:
```typescript
export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  maxDepth: number | null,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  state: TaskExecutionState,
  parentCompoundId?: string,
  namePrefix?: string
)
```

- [ ] **Step 2: Replace .value with Ref.get**

Line 30:
```typescript
    if (state.workflowStatus.value === "failed") return
```
becomes:
```typescript
    const currentStatus = yield* _(Ref.get(state.workflowStatus))
    if (currentStatus === "failed") return
```

Add `Ref` to imports at line 1:
```typescript
import { Effect, Scope } from "effect"
```
becomes:
```typescript
import { Effect, Ref, Scope } from "effect"
```

- [ ] **Step 3: Replace all .value reads/writes**

Line 40 and 55 and 61 and 73 and 82-86 — all `state.workflowStatus.value === "failed"` and `state.workflowStatus.value = "failed"`:

Line 40 in the `for` loop guard:
```typescript
      if (state.workflowStatus.value === "failed") break
```
becomes:
```typescript
      const loopStatus = yield* _(Ref.get(state.workflowStatus))
      if (loopStatus === "failed") break
```

Line 55 in sub-task loop guard:
```typescript
          if (state.workflowStatus.value === "failed") break
```
becomes:
```typescript
          const subStatus = yield* _(Ref.get(state.workflowStatus))
          if (subStatus === "failed") break
```

Line 61 (when recursion depth fails):
```typescript
              state.workflowStatus.value = "failed"
              break
```
becomes:
```typescript
              yield* _(Ref.set(state.workflowStatus, "failed"))
              break
```

Line 73 (when when-condition fails):
```typescript
              state.workflowStatus.value = "failed"
              break
```
becomes:
```typescript
              yield* _(Ref.set(state.workflowStatus, "failed"))
              break
```

- [ ] **Step 4: Update recursive call (line 81)**

```typescript
yield* _(expandTemplate(ctx, subTask, spec, taskEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state, compoundParentTaskId, subInstanceName))
```
becomes:
```typescript
yield* _(expandTemplate(ctx, subTask, spec, taskEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, state, compoundParentTaskId, subInstanceName))
```

- [ ] **Step 5: Update dispatchTask calls (lines 91, 102)**

Line 91:
```typescript
yield* _(dispatchTask(subTask, taskEnv, subInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state))
```
becomes:
```typescript
yield* _(dispatchTask(subTask, taskEnv, subInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, state))
```

Line 102:
```typescript
yield* _(dispatchTask(templateTask, taskEnv, instanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state))
```
becomes:
```typescript
yield* _(dispatchTask(templateTask, taskEnv, instanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, state))
```

- [ ] **Step 6: Verify build**

```bash
bun run build
```
Expected: clean compile

- [ ] **Step 7: Commit**

```bash
git add src/workflow/template-expander.ts
git commit -m "refactor: drop fileEnabled from template-expander, use Ref from TaskExecutionState"
```

---

### Task 5: Update runner.test.ts — new status lifecycle assertions

**Files:**
- Modify: `tests/workflow/runner.test.ts`

- [ ] **Step 1: Find and update status assertion**

Search for `expect(result.status).toBe("completed")` at line 154. Change to:
```typescript
    expect(result.status).toBe("completed")
```

No change needed — "completed" is still valid in the new type. Just add a new test for lifecycle.

- [ ] **Step 2: Add lifecycle test**

Add after the existing "publishes WorkflowStarted and WorkflowCompleted events" test (around line 176):

```typescript
  it("publishes WorkflowStatusChanged events for planned, in-progress, and completed", async () => {
    const events = await collectEvents(
      runWorkflow(makeSpec(), { project_dir: tmpHome }, { strict: false })
    )

    const statusEvents = events.filter(e => e._tag === "WorkflowStatusChanged")
    expect(statusEvents.length).toBeGreaterThanOrEqual(3)
    expect(statusEvents[0]._tag).toBe("WorkflowStatusChanged")
    if (statusEvents[0]._tag === "WorkflowStatusChanged") expect(statusEvents[0].status).toBe("planned")
    if (statusEvents[1]._tag === "WorkflowStatusChanged") expect(statusEvents[1].status).toBe("in-progress")
  })
```

- [ ] **Step 3: Add env type test**

Add after the lifecycle test:

```typescript
  it("returned env is Record<string, unknown> containing runtime keys", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(makeSpec(), { project_dir: tmpHome }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(typeof result.env).toBe("object")
    expect(result.env).toHaveProperty("tasks")
    expect(result.env).toHaveProperty("project_dir")
    expect(result.env).toHaveProperty("run_id")
  })
```

- [ ] **Step 4: Verify build + run specific test file**

```bash
bun run build && bun --bun vitest run tests/workflow/runner.test.ts
```
Expected: build compiles, all tests pass (including new lifecycle test)

- [ ] **Step 5: Commit**

```bash
git add tests/workflow/runner.test.ts
git commit -m "test: add WorkflowStatusChanged lifecycle and env type assertions"
```

---

### Task 6: Update runner-regression.test.ts — status assertions

**Files:**
- Modify: `tests/workflow/runner-regression.test.ts`

- [ ] **Step 1: Verify existing tests still pass**

```bash
bun --bun vitest run tests/workflow/runner-regression.test.ts
```
Expected: all tests pass (they use `collectEvents` pattern internally, not `result.status`)

- [ ] **Step 2: Add lifecycle event assertion to existing test**

After line 243 (end of "emits WorkflowStarted as first event" test), change the test to also check WorkflowStatusChanged:

The test at line 182:
```typescript
  it("emits WorkflowStarted as first event", async () => {
```
Add after `expect(events[0]._tag).toBe("WorkflowStarted")` on line 201:
```typescript
    const statusEvents = events.filter(e => e._tag === "WorkflowStatusChanged")
    expect(statusEvents.length).toBeGreaterThanOrEqual(2)
    const planned = statusEvents.find(e => e._tag === "WorkflowStatusChanged" && e.status === "planned")
    expect(planned).toBeDefined()
```

- [ ] **Step 3: Verify build + run tests**

```bash
bun run build && bun --bun vitest run tests/workflow/runner-regression.test.ts
```
Expected: build compiles, all tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/workflow/runner-regression.test.ts
git commit -m "test: add WorkflowStatusChanged assertion to regression tests"
```

---

### Task 7: Update runner-recursion.test.ts — status assertions

**Files:**
- Modify: `tests/workflow/runner-recursion.test.ts`

- [ ] **Step 1: Verify existing tests compile and pass**

```bash
bun run build && bun --bun vitest run tests/workflow/runner-recursion.test.ts
```
Expected: all tests pass

- [ ] **Step 2: Add status lifecycle check to recursion test**

After line 234, add a quick lifecycle check in the "depth defaults to 0 for root tasks" test:

```typescript
  it("has planned status in WorkflowCompleted summary under recursion", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "recursion-status" },
      spec: {
        run: { entrypoint: "task1", timeout: "300s" },
        tasks: [
          { name: "task1", agent: { executorRef: "worker", prompt: { content: "Work" } } }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    )

    const completed = events.find(e => e._tag === "WorkflowCompleted")
    expect(completed).toBeDefined()
    if (completed && completed._tag === "WorkflowCompleted") {
      expect(completed.summary).toBeDefined()
      expect(completed.summary!.status).toBe("completed")
    }

    const statusChanges = events.filter(e => e._tag === "WorkflowStatusChanged")
    expect(statusChanges.length).toBeGreaterThanOrEqual(3)
  })
```

- [ ] **Step 3: Verify build + run tests**

```bash
bun run build && bun --bun vitest run tests/workflow/runner-recursion.test.ts
```
Expected: build compiles, all tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/workflow/runner-recursion.test.ts
git commit -m "test: add WorkflowStatusChanged lifecycle check to recursion tests"
```

---

### Task 8: Update e2e/workflows.test.ts — env type assertion

**Files:**
- Modify: `tests/e2e/workflows.test.ts`

- [ ] **Step 1: Verify existing tests compile and pass**

```bash
bun run build && bun --bun vitest run tests/e2e/workflows.test.ts
```
Expected: build compiles, tests pass (env is now `Record<string, unknown>`, but `result.env.tasks` was already accessed via `as Record<string, unknown>` pattern or similar)

- [ ] **Step 2: Assert env has runtime keys at test end**

In the "completes the bug-fix workflow with mock agents" test (around line 97), add after the existing `r.status` assertion:

```typescript
      expect(typeof r.env).toBe("object")
      expect(r.env).toHaveProperty("run_id")
```

Add between line 97 and 98:
```typescript
      expect(typeof r.env).toBe("object")
      expect(r.env).toHaveProperty("run_id")
      expect(r.env).toHaveProperty("tasks")
```

- [ ] **Step 3: Verify build + run tests**

```bash
bun run build && bun --bun vitest run tests/e2e/workflows.test.ts
```
Expected: build compiles, tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/workflows.test.ts
git commit -m "test: add env Record<string, unknown> shape assertion to e2e tests"
```

---

### Task 9: Create tests/workflow/task-executor.test.ts

**Files:**
- Create: `tests/workflow/task-executor.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Ref, Stream, Scope } from "effect"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import { dispatchTask } from "../../src/workflow/task-executor.js"
import type { WorkflowSpec, WorkflowTask, AgentManifest } from "../../src/types.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"
import type { WorkflowRuntime } from "../../src/workflow/run-state-machine.js"
import { createWorkflowRuntime } from "../../src/workflow/run-state-machine.js"
import { loadTelemetryConfig } from "../../src/telemetry/config.js"

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
          systemPrompt: "mock-system",
          taskPrompt: "mock-task",
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
        }))
        if (config.taskId === "fail-task") throw new Error("execution failed")
        if (config.taskId === "timeout-task") return undefined
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

vi.mock("node:child_process", () => {
  return {
    execSync: vi.fn((cmd: string) => {
      if (cmd === "echo hello") return "hello\n"
      throw Object.assign(new Error("Command failed"), { status: 1, stdout: "", stderr: "error" })
    })
  }
})

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: {
    settings: { model: "default" },
    systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
  },
  systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
})

describe("dispatchTask with withTaskLifecycle", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-executor-test-"))
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

  const makeAgentTask = (name: string, extra?: Partial<WorkflowTask>): WorkflowTask => ({
    name,
    agent: { executorRef: "agent-a", prompt: { content: "Do the thing" } },
    ...extra
  } as WorkflowTask)

  const makeScriptTask = (name: string, extra?: Partial<WorkflowTask>): WorkflowTask => ({
    name,
    script: { command: "echo hello", ...extra }
  } as WorkflowTask)

  const makeEnv = (overrides?: Partial<WorkflowEnv>): WorkflowEnv => ({
    project_dir: tmpHome,
    tasks: {},
    user_input: "test",
    ...overrides
  })

  it("runs an agent task to completion and publishes TaskCompleted", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "exec-test" },
      spec: {
        run: { entrypoint: "plan", timeout: "300s" },
        tasks: [makeAgentTask("plan")]
      },
      agentRegistry: new Map([["agent-a", makeAgentManifest("agent-a")]])
    }

    const events: Event[] = []
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))

          const workflowStatus = yield* _(Effect.Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("in-progress"))
          const taskResults: Record<string, string> = {}
          const workflowEnv = makeEnv()
          const ctx = yield* _(createWorkflowRuntime(spec, workflowEnv).pipe(
            Effect.mapError((e) => new Error(e.message))
          ))

          yield* _(dispatchTask(
            spec.spec.tasks[0]!,
            workflowEnv,
            "plan",
            ctx,
            spec,
            [],
            [],
            new Map(),
            { strict: false },
            { maxOutputBytes: 1024 },
            { workflowStatus, taskResults, workflowEnv, fileEnabled: false }
          ))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
    const completed = events.filter(e => e._tag === "TaskCompleted")
    expect(completed.length).toBe(1)
  })

  it("publishes TaskFailed when agent execution throws after retries", async () => {
    const task = makeAgentTask("fail-task")
    task.name = "fail-task"

    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "fail-test" },
      spec: {
        run: { entrypoint: "fail-task", timeout: "300s" },
        tasks: [task]
      },
      agentRegistry: new Map([["agent-a", makeAgentManifest("agent-a")]])
    }

    const events: Event[] = []
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))

          const workflowStatus = yield* _(Effect.Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("in-progress"))
          const taskResults: Record<string, string> = {}
          const workflowEnv = makeEnv()
          const ctx = yield* _(createWorkflowRuntime(spec, workflowEnv).pipe(
            Effect.mapError((e) => new Error(e.message))
          ))

          yield* _(dispatchTask(
            spec.spec.tasks[0]!,
            workflowEnv,
            "fail-task",
            ctx,
            spec,
            [],
            [],
            new Map(),
            { strict: false },
            { maxOutputBytes: 1024 },
            { workflowStatus, taskResults, workflowEnv, fileEnabled: false }
          ))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const failed = events.filter(e => e._tag === "TaskFailed")
    expect(failed.length).toBe(1)
    if (failed[0] && failed[0]._tag === "TaskFailed") {
      expect(failed[0].message).toContain("execution failed")
    }
  })

  it("publishes TaskTimedOut when agent times out", async () => {
    const task = makeAgentTask("timeout-task")
    task.name = "timeout-task"

    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "timeout-test" },
      spec: {
        run: { entrypoint: "timeout-task", timeout: "300s" },
        tasks: [task]
      },
      agentRegistry: new Map([["agent-a", makeAgentManifest("agent-a")]])
    }

    const events: Event[] = []
    await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))

          const workflowStatus = yield* _(Effect.Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("in-progress"))
          const taskResults: Record<string, string> = {}
          const workflowEnv = makeEnv()
          const ctx = yield* _(createWorkflowRuntime(spec, workflowEnv).pipe(
            Effect.mapError((e) => new Error(e.message))
          ))

          yield* _(dispatchTask(
            spec.spec.tasks[0]!,
            workflowEnv,
            "timeout-task",
            ctx,
            spec,
            [],
            [],
            new Map(),
            { strict: false },
            { maxOutputBytes: 1024 },
            { workflowStatus, taskResults, workflowEnv, fileEnabled: false }
          ))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const timedOut = events.filter(e => e._tag === "TaskTimedOut")
    expect(timedOut.length).toBe(1)
  })

  it("runs a script task to completion and publishes TaskCompleted", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "script-test" },
      spec: {
        run: { entrypoint: "greet", timeout: "300s" },
        tasks: [makeScriptTask("greet", { script: { command: "echo hello" } })]
      },
      agentRegistry: new Map()
    }

    const events: Event[] = []
    await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))

          const workflowStatus = yield* _(Effect.Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("in-progress"))
          const taskResults: Record<string, string> = {}
          const workflowEnv = makeEnv()
          const ctx = yield* _(createWorkflowRuntime(spec, workflowEnv).pipe(
            Effect.mapError((e) => new Error(e.message))
          ))

          yield* _(dispatchTask(
            spec.spec.tasks[0]!,
            workflowEnv,
            "greet",
            ctx,
            spec,
            [],
            [],
            new Map(),
            { strict: false },
            { maxOutputBytes: 1024 },
            { workflowStatus, taskResults, workflowEnv, fileEnabled: false }
          ))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const completed = events.filter(e => e._tag === "TaskCompleted")
    expect(completed.length).toBe(1)
  })

  it("publishes TaskFailed when script command fails after retries", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "script-fail-test" },
      spec: {
        run: { entrypoint: "bad-cmd", timeout: "300s" },
        tasks: [makeScriptTask("bad-cmd", { script: { command: "exit 1" } as any })]
      },
      agentRegistry: new Map()
    }

    const events: Event[] = []
    await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))

          const workflowStatus = yield* _(Effect.Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("in-progress"))
          const taskResults: Record<string, string> = {}
          const workflowEnv = makeEnv()
          const ctx = yield* _(createWorkflowRuntime(spec, workflowEnv).pipe(
            Effect.mapError((e) => new Error(e.message))
          ))

          yield* _(dispatchTask(
            spec.spec.tasks[0]!,
            workflowEnv,
            "bad-cmd",
            ctx,
            spec,
            [],
            [],
            new Map(),
            { strict: false },
            { maxOutputBytes: 1024 },
            { workflowStatus, taskResults, workflowEnv, fileEnabled: false }
          ))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const failed = events.filter(e => e._tag === "TaskFailed")
    expect(failed.length).toBe(1)
  })

  it("publishes TaskRetrying events when retries occur", async () => {
    const task: WorkflowTask = {
      name: "retry-task",
      agent: { executorRef: "agent-a", prompt: { content: "retry this" }, on_failure: { max_retries: 3 } }
    }

    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "retry-test" },
      spec: {
        run: { entrypoint: "retry-task", timeout: "300s" },
        tasks: [task]
      },
      agentRegistry: new Map([["agent-a", makeAgentManifest("agent-a")]])
    }

    const events: Event[] = []
    await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))

          const workflowStatus = yield* _(Effect.Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("in-progress"))
          const taskResults: Record<string, string> = {}
          const workflowEnv = makeEnv()
          const ctx = yield* _(createWorkflowRuntime(spec, workflowEnv).pipe(
            Effect.mapError((e) => new Error(e.message))
          ))

          yield* _(dispatchTask(
            spec.spec.tasks[0]!,
            workflowEnv,
            "retry-task",
            ctx,
            spec,
            [],
            [],
            new Map(),
            { strict: false },
            { maxOutputBytes: 1024 },
            { workflowStatus, taskResults, workflowEnv, fileEnabled: false }
          ))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const retries = events.filter(e => e._tag === "TaskRetrying")
    expect(retries.length).toBe(2)
    const failed = events.filter(e => e._tag === "TaskFailed")
    expect(failed.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run the new tests**

```bash
bun --bun vitest run tests/workflow/task-executor.test.ts
```
Expected: 6 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/workflow/task-executor.test.ts
git commit -m "test: add dispatchTask/withTaskLifecycle tests (agent, script, retry, timeout, failure)"
```

---

### Task 10: Full test suite verification

**Files:**
- None (verification only)

- [ ] **Step 1: Build**

```bash
bun run build
```
Expected: clean compile

- [ ] **Step 2: Run full test suite**

```bash
bun --bun vitest run
```
Expected: all tests pass (555 existing + new)

- [ ] **Step 3: Run specific affected test files to confirm**

```bash
bun --bun vitest run tests/workflow/runner.test.ts tests/workflow/runner-regression.test.ts tests/workflow/runner-recursion.test.ts tests/e2e/workflows.test.ts tests/workflow/task-executor.test.ts
```
Expected: all pass

- [ ] **Step 4: Commit if any final changes needed**

```bash
git status
git diff
git add -A
git commit -m "chore: final verification — all tests pass"
```
