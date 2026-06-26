# Decompose runner.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the 480-line `runWorkflow` god function into 5 focused modules + a thin orchestrator, addressing 9 critical code-quality issues.

**Architecture:** Extract pure functions and Effect-based modules from `runner.ts` into their own files, following existing patterns. Each extraction preserves behavior — all 550 tests pass at every step. Final step replaces direct file-I/O calls with an event-driven `RunDirSubscriber` and simplifies the function signature.

**Tech Stack:** TypeScript, bun, Effect-TS, vitest, `bun:sqlite`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/workflow/engine.ts` | Modify | Add `buildTaskInstanceName` |
| `src/guidelines/extractor.ts` | Create | Pure fn: flatten loaded guidelines |
| `tests/guidelines/extractor.test.ts` | Create | Unit tests for extractor |
| `src/workflow/run-state-machine.ts` | Modify | Add `getTaskDepth` to interface + impl |
| `src/workflow/when-guard.ts` | Create | `checkRecursionDepth` + `evaluateWhenCondition` |
| `src/workflow/task-executor.ts` | Create | `executeAgentTask`, `executeScriptTask`, `dispatchTask` |
| `src/workflow/template-expander.ts` | Create | Recursive `expandTemplate` |
| `src/events/bus.ts` | Modify | Add optional `summary` field to `WorkflowCompleted` |
| `src/observability/run-dir-subscriber.ts` | Create | `RunDirSubscriber` for events.jsonl + summary.json |
| `src/workflow/runner.ts` | Modify | Rebuilt as thin orchestrator, `WorkflowRunnerConfig` removed |
| `tests/workflow/runner.test.ts` | Modify | Update to new signature |
| `tests/workflow/runner-recursion.test.ts` | Modify | Update to new signature |
| `tests/workflow/runner-regression.test.ts` | Modify | Update to new signature |
| `tests/e2e/workflows.test.ts` | Modify | Update to new signature |
| `src/cli/commands/run.ts` | Modify | Update to new signature |
| `src/cli/commands/resume.ts` | Modify | Update to new signature |

---

### Task 1: Add `buildTaskInstanceName` to engine.ts

**Files:**
- Modify: `src/workflow/engine.ts`
- Modify: `src/workflow/runner.ts:371-383,435`

- [ ] **Step 1: Write `buildTaskInstanceName`**

Add to `src/workflow/engine.ts` immediately after `buildTaskId` (line 105):

```ts
export function buildTaskInstanceName(parent: string, childOrIndex: string | number): string {
  if (typeof childOrIndex === "number") return `${parent}/${childOrIndex}`
  return `${parent}-${childOrIndex}`
}
```

- [ ] **Step 2: Replace inline string interpolation in runner.ts**

In `src/workflow/runner.ts`, add import at top (with the existing engine imports on line 15):

```
import { collectReachableTasks, topologicalSort, resolveTaskTimeout, buildTaskId, buildTaskInstanceName } from "../workflow/engine.js"
```

Replace line 372:
```ts
const instanceName = `${task.name}/${i}`
```
With:
```ts
const instanceName = buildTaskInstanceName(task.name, i)
```

Replace line 383:
```ts
const subInstanceName = `${instanceName}-${subTask.name}`
```
With:
```ts
const subInstanceName = buildTaskInstanceName(instanceName, subTask.name)
```

Replace line 435:
```ts
const nestedInstanceName = `${subInstanceName}-${nestedSubTask.name}`
```
With:
```ts
const nestedInstanceName = buildTaskInstanceName(subInstanceName, nestedSubTask.name)
```

- [ ] **Step 3: Run tests to verify**

Run: `bun --bun vitest run tests/workflow/runner.test.ts tests/workflow/runner-recursion.test.ts tests/workflow/runner-regression.test.ts tests/e2e/workflows.test.ts`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/workflow/engine.ts src/workflow/runner.ts
git commit -m "refactor: add buildTaskInstanceName to engine, replace inline string interpolation in runner"
```

---

### Task 2: Extract `extractGuidelineArtifacts`

**Files:**
- Create: `src/guidelines/extractor.ts`
- Create: `tests/guidelines/extractor.test.ts`
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Create the extractor**

Write `src/guidelines/extractor.ts`:

```ts
import type { CompiledRule, LoadedGuideline } from "./types.js"

export function extractGuidelineArtifacts(loaded: LoadedGuideline[]): {
  files: Array<{ name: string; content: string }>
  rules: CompiledRule[]
} {
  const files: Array<{ name: string; content: string }> = []
  const rules: CompiledRule[] = []
  for (const g of loaded) {
    if (g.instructions) {
      for (const inst of g.instructions) files.push(inst)
    }
    if (g.rules) {
      for (const rule of g.rules) rules.push(rule)
    }
  }
  return { files, rules }
}
```

- [ ] **Step 2: Write unit test**

Write `tests/guidelines/extractor.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { extractGuidelineArtifacts } from "../../src/guidelines/extractor.js"
import type { LoadedGuideline, CompiledRule } from "../../src/guidelines/types.js"

describe("extractGuidelineArtifacts", () => {
  it("extracts instruction files from loaded guidelines", () => {
    const loaded: LoadedGuideline[] = [
      {
        name: "security",
        instructions: [
          { name: "security:policy.md", content: "# Security Policy" },
          { name: "security:owasp.md", content: "# OWASP Guidelines" }
        ],
        rules: null
      }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toHaveLength(2)
    expect(result.files[0]).toEqual({ name: "security:policy.md", content: "# Security Policy" })
    expect(result.files[1]).toEqual({ name: "security:owasp.md", content: "# OWASP Guidelines" })
    expect(result.rules).toEqual([])
  })

  it("extracts compiled rules from loaded guidelines", () => {
    const rule: CompiledRule = {
      name: "no-eval",
      toolNames: ["bash"],
      target: "command",
      pattern: "eval\\(",
      reason: "eval is dangerous",
      compiledPattern: /eval\(/
    }
    const loaded: LoadedGuideline[] = [
      {
        name: "security",
        instructions: null,
        rules: [rule]
      }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toEqual([])
    expect(result.rules).toEqual([rule])
  })

  it("handles empty input", () => {
    const result = extractGuidelineArtifacts([])
    expect(result.files).toEqual([])
    expect(result.rules).toEqual([])
  })

  it("extracts files and rules from multiple guidelines", () => {
    const rule: CompiledRule = {
      name: "no-eval",
      toolNames: ["bash"],
      target: "command",
      pattern: "eval\\(",
      reason: "eval is dangerous",
      compiledPattern: /eval\(/
    }
    const loaded: LoadedGuideline[] = [
      {
        name: "typescript",
        instructions: [{ name: "ts:style.md", content: "Use const" }],
        rules: null
      },
      {
        name: "security",
        instructions: null,
        rules: [rule]
      }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toHaveLength(1)
    expect(result.rules).toHaveLength(1)
  })

  it("skips guidelines with null instructions and null rules", () => {
    const loaded: LoadedGuideline[] = [
      { name: "empty", instructions: null, rules: null }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toEqual([])
    expect(result.rules).toEqual([])
  })
})
```

- [ ] **Step 3: Run unit tests to verify they pass**

Run: `bun --bun vitest run tests/guidelines/extractor.test.ts`
Expected: 5 tests pass

- [ ] **Step 4: Replace inline extraction in runner.ts**

In `src/workflow/runner.ts`, add import near existing imports:

```ts
import { extractGuidelineArtifacts } from "../guidelines/extractor.js"
```

Replace lines 94-113:
```ts
    // the logic for guidelines should live in its own function
    const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))

    const guidelineFiles: Array<{ name: string; content: string }> = []
    // WHY the fuck there is an import in the middle of the function? This is a terrible code smell
    const allRules: import("../guidelines/types.js").CompiledRule[] = []

    for (const g of loadedGuidelines) {
      if (g.instructions) {
        for (const inst of g.instructions) {
          guidelineFiles.push(inst)
        }
      }
      if (g.rules) {
        for (const rule of g.rules) {
          allRules.push(rule)
        }
      }
    }
    // end of guideline logic
```

With:
```ts
    const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))
    const { files: guidelineFiles, rules: allRules } = extractGuidelineArtifacts(loadedGuidelines)
```

- [ ] **Step 5: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 550 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/guidelines/extractor.ts tests/guidelines/extractor.test.ts src/workflow/runner.ts
git commit -m "refactor: extract extractGuidelineArtifacts, remove inline type import from runner"
```

---

### Task 3: Add `getTaskDepth` to WorkflowRuntime

**Files:**
- Modify: `src/workflow/run-state-machine.ts`
- Modify: `src/workflow/runner.ts:330-343,387-400`

- [ ] **Step 1: Add `getTaskDepth` to the WorkflowRuntime interface**

In `src/workflow/run-state-machine.ts`, add to the `WorkflowRuntime` interface (after `readonly insertDynamicTask` line 64):

```ts
  readonly getTaskDepth: (taskName: string) => Effect.Effect<number | null, EngineError>
```

- [ ] **Step 2: Implement in WorkflowRuntimeImpl**

In `src/workflow/run-state-machine.ts`, add method to `WorkflowRuntimeImpl` class (after `insertDynamicTask`, before `pause`):

```ts
  getTaskDepth(taskName: string): Effect.Effect<number | null, EngineError> {
    return Effect.sync(() => {
      const compoundId = this._compoundTaskIds.get(taskName)
      if (!compoundId) return null
      const depthRow = this._db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId) as { depth: number } | null
      return depthRow?.depth ?? null
    })
  }
```

- [ ] **Step 3: Replace raw SQL in runner.ts with ctx.getTaskDepth**

In `src/workflow/runner.ts`, replace the first occurrence (lines 330-343):

Before:
```ts
          const maxDepth = resolveMaxRecursionDepth()
          if (maxDepth !== null) {
            const compoundId = ctx.compoundTaskIds.get(task.name)
            if (compoundId) {
              const depthRow = ctx.db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId) as { depth: number } | null
              if (depthRow && depthRow.depth >= maxDepth) {
                yield* _(ctx.transitionTask(task.name, "fail"))
                const errorMsg = `max recursion depth (${maxDepth}) exceeded`
                yield* _(ctx.fail(errorMsg))
                workflowStatus = "failed"
                break
              }
            }
          }
```

After:
```ts
          const maxDepth = resolveMaxRecursionDepth()
          if (maxDepth !== null) {
            const depth = yield* _(ctx.getTaskDepth(task.name))
            if (depth !== null && depth >= maxDepth) {
              yield* _(ctx.transitionTask(task.name, "fail"))
              const errorMsg = `max recursion depth (${maxDepth}) exceeded`
              yield* _(ctx.fail(errorMsg))
              workflowStatus = "failed"
              break
            }
          }
```

Replace the second occurrence (lines 387-400) similarly:

Before:
```ts
                  const maxDepth = resolveMaxRecursionDepth()
                  if (maxDepth !== null) {
                    const compoundId = ctx.compoundTaskIds.get(subInstanceName)
                    if (compoundId) {
                      // IT SHOULD NEVER be a query direct to the database, we should have functions/abstractions that hide this
                      const depthRow = ctx.db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId) as { depth: number } | null
                      if (depthRow && depthRow.depth >= maxDepth) {
                        yield* _(ctx.transitionTask(subInstanceName, "fail"))
                        const errorMsg = `max recursion depth (${maxDepth}) exceeded`
                        yield* _(ctx.fail(errorMsg))
                        workflowStatus = "failed"
                        break
                      }
                    }
                  }
```

After:
```ts
                  const maxDepth = resolveMaxRecursionDepth()
                  if (maxDepth !== null) {
                    const depth = yield* _(ctx.getTaskDepth(subInstanceName))
                    if (depth !== null && depth >= maxDepth) {
                      yield* _(ctx.transitionTask(subInstanceName, "fail"))
                      const errorMsg = `max recursion depth (${maxDepth}) exceeded`
                      yield* _(ctx.fail(errorMsg))
                      workflowStatus = "failed"
                      break
                    }
                  }
```

- [ ] **Step 4: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 550 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/workflow/run-state-machine.ts src/workflow/runner.ts
git commit -m "refactor: add getTaskDepth to WorkflowRuntime, remove raw SQL from runner"
```

---

### Task 4: Extract `when-guard.ts`

**Files:**
- Create: `src/workflow/when-guard.ts`
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Create when-guard module**

Write `src/workflow/when-guard.ts`:

```ts
import { Effect } from "effect"
import type { WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import { evaluateWhen, WhenError } from "../cel/evaluate.js"

export function checkRecursionDepth(
  ctx: WorkflowRuntime,
  maxDepth: number | null,
  taskName: string
): Effect.Effect<"proceed" | "fail", never> {
  return Effect.gen(function* (_) {
    if (maxDepth === null) return "proceed" as const
    const depth = yield* _(ctx.getTaskDepth(taskName))
    if (depth === null) return "proceed" as const
    if (depth >= maxDepth) {
      yield* _(ctx.transitionTask(taskName, "fail"))
      yield* _(ctx.fail(`max recursion depth (${maxDepth}) exceeded`))
      return "fail" as const
    }
    return "proceed" as const
  })
}

export function evaluateWhenCondition(
  task: WorkflowTask,
  env: WorkflowEnv
): "proceed" | "skip" | { _tag: "error"; message: string } {
  try {
    const result = evaluateWhen(task.when!, { inputs: env as Record<string, unknown> })
    return result ? "proceed" : "skip"
  } catch (e) {
    const msg = e instanceof WhenError ? e.message : String(e)
    return { _tag: "error", message: msg }
  }
}
```

- [ ] **Step 2: Replace first duplicated block in runner.ts (top-level when tasks, lines 329-357)**

In `src/workflow/runner.ts`, add import:

```ts
import { checkRecursionDepth, evaluateWhenCondition } from "../workflow/when-guard.js"
```

Remove the import of `evaluateWhen, WhenError` from line 11 since they're now only used in when-guard:

```ts
// Remove: import { evaluateWhen, WhenError } from "../cel/evaluate.js"
```

Replace lines 329-357:

Before:
```ts
        if (task.when) {
          const maxDepth = resolveMaxRecursionDepth()
          if (maxDepth !== null) {
            const depth = yield* _(ctx.getTaskDepth(task.name))
            if (depth !== null && depth >= maxDepth) {
              yield* _(ctx.transitionTask(task.name, "fail"))
              const errorMsg = `max recursion depth (${maxDepth}) exceeded`
              yield* _(ctx.fail(errorMsg))
              workflowStatus = "failed"
              break
            }
          }

          try {
            const result = evaluateWhen(task.when, { inputs: workflowEnv as Record<string, unknown> })
            if (!result) {
              yield* _(ctx.transitionTask(task.name, "complete"))
              continue
            }
          } catch (e) {
            const errorMsg = e instanceof WhenError ? e.message : String(e)
            yield* _(ctx.transitionTask(task.name, "fail"))
            yield* _(ctx.fail(errorMsg))
            workflowStatus = "failed"
            break
          }
        }
```

After:
```ts
        if (task.when) {
          const maxDepth = resolveMaxRecursionDepth()
          const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
          if (depthResult === "fail") {
            workflowStatus = "failed"
            break
          }

          const whenResult = evaluateWhenCondition(task, workflowEnv)
          if (whenResult === "skip") {
            yield* _(ctx.transitionTask(task.name, "complete"))
            continue
          }
          if (typeof whenResult === "object" && whenResult._tag === "error") {
            yield* _(ctx.transitionTask(task.name, "fail"))
            yield* _(ctx.fail(whenResult.message))
            workflowStatus = "failed"
            break
          }
        }
```

- [ ] **Step 3: Replace second duplicated block in runner.ts (subtask when, lines 386-415)**

Replace:

Before:
```ts
                if (subTask.when) {
                  const maxDepth = resolveMaxRecursionDepth()
                  if (maxDepth !== null) {
                    const depth = yield* _(ctx.getTaskDepth(subInstanceName))
                    if (depth !== null && depth >= maxDepth) {
                      yield* _(ctx.transitionTask(subInstanceName, "fail"))
                      const errorMsg = `max recursion depth (${maxDepth}) exceeded`
                      yield* _(ctx.fail(errorMsg))
                      workflowStatus = "failed"
                      break
                    }
                  }

                  try {
                    const result = evaluateWhen(subTask.when, { inputs: workflowEnv as Record<string, unknown> })
                    if (!result) {
                      yield* _(ctx.transitionTask(subInstanceName, "complete"))
                      continue
                    }
                  } catch (e) {
                    const errorMsg = e instanceof WhenError ? e.message : String(e)
                    yield* _(ctx.transitionTask(subInstanceName, "fail"))
                    yield* _(ctx.fail(errorMsg))
                    workflowStatus = "failed"
                    break
                  }
                }
```

After:
```ts
                if (subTask.when) {
                  const maxDepth = resolveMaxRecursionDepth()
                  const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, subInstanceName))
                  if (depthResult === "fail") {
                    workflowStatus = "failed"
                    break
                  }

                  const whenResult = evaluateWhenCondition(subTask, workflowEnv)
                  if (whenResult === "skip") {
                    yield* _(ctx.transitionTask(subInstanceName, "complete"))
                    continue
                  }
                  if (typeof whenResult === "object" && whenResult._tag === "error") {
                    yield* _(ctx.transitionTask(subInstanceName, "fail"))
                    yield* _(ctx.fail(whenResult.message))
                    workflowStatus = "failed"
                    break
                  }
                }
```

- [ ] **Step 4: Remove now-unused imports in runner.ts**

The imports `evaluateWhen` and `WhenError` from `../cel/evaluate.js` (line 11) are no longer used in runner.ts. Remove that import line.

- [ ] **Step 5: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 550 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/workflow/when-guard.ts src/workflow/runner.ts
git commit -m "refactor: extract when-guard module (checkRecursionDepth + evaluateWhenCondition)"
```

---

### Task 5: Extract `task-executor.ts`

**Files:**
- Create: `src/workflow/task-executor.ts`
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Create task-executor module**

Write `src/workflow/task-executor.ts`:

```ts
import { Effect, Schedule, Duration, Scope } from "effect"
import { EventBus } from "../events/bus.js"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import type { TemplateOptions } from "../prompts/template.js"
import { Template } from "../prompts/template.js"
import { buildAgentsPrompts } from "../prompts/builder.js"
import { resolveSystemPromptFragments } from "../prompts/system.js"
import { resolveAgentDefaults, loadModelAliases, resolveModelAlias } from "../agent/config.js"
import { executeWithPi } from "../executors/pi/pi-executor.js"
import { resolveTaskTimeout, buildTaskId } from "./engine.js"
import { writeTaskOutput } from "../observability/run-dir.js"
import * as ChildProcess from "node:child_process"
import type { CompiledRule } from "../guidelines/types.js"

export interface TaskExecutionState {
  workflowStatus: string
  taskResults: Record<string, string>
  workflowEnv: WorkflowEnv
}

export function executeAgentTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  taskId: string,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  fileEnabled: boolean,
  state: TaskExecutionState
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (!task.agent) return

    const agent = spec.agentRegistry.get(task.agent.executorRef)
    if (!agent) return

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

    const output = yield* _(
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
        Effect.timeout(Duration.seconds(timeoutSeconds)),
        Effect.retry(
          Schedule.recurs((task.agent!.on_failure?.max_retries ?? 1) - 1).pipe(
            Schedule.tapInput(() =>
              Effect.gen(function* (_) {
                const bus = yield* _(EventBus)
                yield* _(bus.publish({ _tag: "TaskRetrying", runId: ctx.runId, taskId, taskName: instanceName }))
              }).pipe(Effect.catchAll(() => Effect.void))
            )
          )
        )
      )
    )

    const bus = yield* _(EventBus)

    if (output === undefined || output === null) {
      yield* _(bus.publish({ _tag: "TaskTimedOut", runId: ctx.runId, taskId, taskName: instanceName }))
      yield* _(ctx.transitionTask(instanceName, "fail"))
      state.workflowStatus = "failed"
      return
    }

    state.taskResults[instanceName] = String(output.status ?? "done")
    if (!state.workflowEnv.tasks) state.workflowEnv.tasks = {}
    state.workflowEnv.tasks[instanceName] = { outputs: output as Record<string, unknown> }

    yield* _(ctx.transitionTask(instanceName, "complete"))
    if (fileEnabled) {
      yield* _(writeTaskOutput(ctx.runId, taskId, output))
    }
    yield* _(bus.publish({ _tag: "TaskCompleted", runId: ctx.runId, taskId, taskName: instanceName }))
  })
}

export function executeScriptTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  taskId: string,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  fileEnabled: boolean,
  state: TaskExecutionState
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (!task.script) return

    const renderedCommand = Effect.runSync(
      Template.make(task.script.command, templateOptions)
        .setInputEnv(taskEnv as Record<string, unknown>)
        .render()
    )
    const workdir = task.script.workdir ?? (taskEnv.project_dir as string | undefined) ?? process.cwd()
    const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)
    const maxRetries = task.script.on_failure?.max_retries ?? 1

    const runScript = (): Effect.Effect<{ stdout: string; stderr: string; exitCode: number; status: string }, { stdout: string; stderr: string; exitCode: number; status: string }> =>
      Effect.try({
        try: () => {
          const stdout = ChildProcess.execSync(renderedCommand, {
            cwd: workdir,
            timeout: timeoutSeconds * 1000,
            encoding: "utf-8",
            maxBuffer: scriptConfig.maxOutputBytes
          })
          return { stdout: stdout.trim(), stderr: "", exitCode: 0, status: "done" }
        },
        catch: (e: any) => {
          const stdout = (e.stdout as string | undefined) ?? ""
          const stderr = (e.stderr as string | undefined) ?? String(e)
          const exitCode = (e.status as number | undefined) ?? 1
          return { stdout: String(stdout).trim(), stderr: String(stderr), exitCode, status: "failed" }
        }
      }).pipe(
        Effect.flatMap((result) =>
          result.status === "done" ? Effect.succeed(result) : Effect.fail(result)
        )
      )

    const bus = yield* _(EventBus)

    const output = yield* _(
      runScript().pipe(
        Effect.retry(
          Schedule.recurs(maxRetries - 1).pipe(
            Schedule.tapInput(() =>
              Effect.gen(function* (_) {
                yield* _(bus.publish({ _tag: "TaskRetrying", runId: ctx.runId, taskId, taskName: instanceName }))
              }).pipe(Effect.catchAll(() => Effect.void))
            )
          )
        ),
        Effect.catchAll((failedResult) => Effect.succeed(failedResult))
      )
    )

    if (output.status === "failed") {
      yield* _(ctx.transitionTask(instanceName, "fail"))
      state.taskResults[instanceName] = "failed"
      state.workflowStatus = "failed"
      return
    }

    state.taskResults[instanceName] = "done"
    if (!state.workflowEnv.tasks) state.workflowEnv.tasks = {}
    state.workflowEnv.tasks[instanceName] = { outputs: output as Record<string, unknown> }

    yield* _(ctx.transitionTask(instanceName, "complete"))
    if (fileEnabled) {
      yield* _(writeTaskOutput(ctx.runId, taskId, output))
    }
    yield* _(bus.publish({ _tag: "TaskCompleted", runId: ctx.runId, taskId, taskName: instanceName }))
  })
}

function resolveSkills(
  skills: string[] | undefined,
  registry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>
): string[] {
  if (!skills) return []
  const result: string[] = []
  for (const name of skills) {
    const resolved = registry[name]
    if (!resolved) continue
    if (Array.isArray(resolved)) {
      result.push(...resolved)
    } else {
      result.push(resolved)
    }
  }
  return result
}

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
  fileEnabled: boolean,
  state: TaskExecutionState
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(ctx.runId, instanceName)

    yield* _(ctx.transitionTask(instanceName, "start"))
    const bus = yield* _(EventBus)
    yield* _(bus.publish({ _tag: "TaskStarted", runId: ctx.runId, taskId, taskName: instanceName }))

    if (task.agent) {
      yield* _(executeAgentTask(task, taskEnv, instanceName, taskId, spec, ctx, guidelineFiles, allRules, skillRegistry, templateOptions, fileEnabled, state))
    } else if (task.script) {
      yield* _(executeScriptTask(task, taskEnv, instanceName, taskId, spec, ctx, templateOptions, scriptConfig, fileEnabled, state))
    }
  })
}
```

- [ ] **Step 2: Add missing SkillRegistry type export**

Check if `loadSkillRegistry` return type is exportable. In `src/skills/registry.ts`, find the function and note its return type. The code above uses `ReturnType<typeof import(...)>` which should work without a dedicated type export.

- [ ] **Step 3: Replace executor closures in runner.ts**

In `src/workflow/runner.ts`, add imports:

```ts
import { dispatchTask, type TaskExecutionState } from "../workflow/task-executor.js"
```

Remove lines 134-311 (the three closures: `executeAgentTask`, `executeScriptTask`, `executeSingleTask`).

After the `workflowStatus` variable declaration (line 132), add:

```ts
    const execState: TaskExecutionState = {
      workflowStatus: workflowStatus,
      taskResults,
      workflowEnv
    }
```

Wait — `workflowStatus` is a `string` primitive, not a reference. `execState.workflowStatus` won't stay in sync with the local `workflowStatus` variable. Need to make `workflowStatus` an object.

Replace line 132:
```ts
    let workflowStatus: string = "completed"
```

With:
```ts
    const workflowStatusRef = { value: "completed" as string }
```

Then update all references to `workflowStatus`:
- `workflowStatus = "failed"` → `workflowStatusRef.value = "failed"`
- `workflowStatus = "paused"` → `workflowStatusRef.value = "paused"`
- `if (workflowStatus === "failed")` → `if (workflowStatusRef.value === "failed")`
- `${workflowStatus}` → `${workflowStatusRef.value}`

The `execState` becomes:
```ts
    const execState: TaskExecutionState = {
      get workflowStatus() { return workflowStatusRef.value },
      set workflowStatus(v) { workflowStatusRef.value = v },
      taskResults,
      workflowEnv
    }
```

Better approach: use a simple `{ value: string }` wrapper:

```ts
    const workflowStatus = { value: "completed" as string }
```

And in the execState:
```ts
    const execState: TaskExecutionState = {
      workflowStatus: workflowStatus.value,
      taskResults,
      workflowEnv
    }
```

Wait, this won't work either because primitives are copied. Let me think...

The simplest approach: make `TaskExecutionState.workflowStatus` a `{ value: string }` too:

Change `TaskExecutionState` interface:
```ts
export interface TaskExecutionState {
  workflowStatus: { value: string }
  taskResults: Record<string, string>
  workflowEnv: WorkflowEnv
}
```

Then in runner.ts:
```ts
    const execState: TaskExecutionState = {
      workflowStatus: { value: "completed" },
      taskResults,
      workflowEnv
    }
```

And in executor functions, `state.workflowStatus.value = "failed"` instead of `state.workflowStatus = "failed"`.

But then the checks like `if (workflowStatusRef.value === "failed")` still work in the orchestrator. And the executor reads/writes `state.workflowStatus.value`.

This is getting complex for a plan step. Let me write the actual replacement code showing the full refactor.

- [ ] **Step 3 (revised): Replace executor closures in runner.ts**

In `src/workflow/runner.ts`, add imports at top:

```ts
import { dispatchTask } from "../workflow/task-executor.js"
```

Change line 132 from:
```ts
    let workflowStatus: string = "completed"
```
To:
```ts
    const workflowStatus = { value: "completed" as string }
```

Update all references to `workflowStatus` in the orchestrator (not the executors, which will be removed):
- Line 327: `if (workflowStatus === "failed") break` → `if (workflowStatus.value === "failed") break`
- Lines 338, 355, 398, 413: `workflowStatus = "failed"` → `workflowStatus.value = "failed"`
- Line 483: `workflowStatus = "paused"` → `workflowStatus.value = "paused"`
- Lines 496-497: `if (workflowStatus === "completed")` → `if (workflowStatus.value === "completed")`
- Line 498: `else if (workflowStatus === "failed")` → `else if (workflowStatus.value === "failed")`
- Lines 504, 508: use `workflowStatus.value`
- Lines 517-529 (catchAll): update `workflowStatus` references

Delete lines 134-311 (the three closures).

Add after the `workflowStatus` declaration and before the `body` Effect:

```ts
    const execState = {
      workflowStatus,
      taskResults,
      workflowEnv
    }
```

Replace line 295-311 (the `executeSingleTask` closure — already deleted, so the call site at ~line 491 becomes):

```ts
        yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
```

Replace the subtask `executeSingleTask` calls (~lines 438, 458, 468) — all `yield* _(executeSingleTask(...))` become `yield* _(dispatchTask(...))` with the full parameter list.

The template-expander ref in line 447 substitutes similarly (single-template task with agent/script, no subtasks).

Update the top-level execution call (~line 491):
```ts
        yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
```

Since `workflowStatus` is now `{ value: string }`, update the return value construction:

Line 502-506:
```ts
      const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const summary = { runId, status: workflowStatus.value, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }
      if (fileEnabled) {
        yield* _(writeSummary(runId, summary))
      }
      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
      if (fileEnabled) {
        yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus.value }))
      }

      return { runId, status: workflowStatus.value, taskResults, env: workflowEnv, startedAt, completedAt } as WorkflowResult
```

And line 512:
```ts
      return { runId, status: workflowStatus.value, taskResults, env: workflowEnv, startedAt, completedAt } as WorkflowResult
```

CatchAll block (lines 517-528):
```ts
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* _(bus.publish({ _tag: "WorkflowCompleted", runId, message: String(error) }))
          if (fileEnabled) {
            yield* _(appendEngineLog(runId, { event: "workflow_failed", error: String(error) }))
          }
          yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
          if (fileEnabled) {
            yield* _(writeSummary(runId, { runId, status: "failed", taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) }))
          }
          return { runId, status: "failed" as const, taskResults, env: workflowEnv, startedAt, completedAt }
        })
      ),
```

- [ ] **Step 4: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 550 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/workflow/task-executor.ts src/workflow/runner.ts
git commit -m "refactor: extract task-executor module (executeAgentTask, executeScriptTask, dispatchTask)"
```

---

### Task 6: Extract `template-expander.ts`

**Files:**
- Create: `src/workflow/template-expander.ts`
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Create template-expander module**

Write `src/workflow/template-expander.ts`:

```ts
import { Effect, Scope } from "effect"
import { EventBus } from "../events/bus.js"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import type { TemplateOptions } from "../prompts/template.js"
import type { CompiledRule } from "../guidelines/types.js"
import { resolveArguments } from "./arguments.js"
import { buildTaskInstanceName, topologicalSort } from "./engine.js"
import { checkRecursionDepth, evaluateWhenCondition } from "./when-guard.js"
import { dispatchTask, type TaskExecutionState } from "./task-executor.js"

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
  parentCompoundId?: string
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (state.workflowStatus.value === "failed") return

    const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
    if (!templateTask) return

    const resolvedArgs = resolveArguments(task, state.workflowEnv)

    const compoundParentTaskId = parentCompoundId ?? ctx.compoundTaskIds.get(task.name) ?? undefined

    for (let i = 0; i < resolvedArgs.itemsCount; i++) {
      if (state.workflowStatus.value === "failed") break

      const instanceName = buildTaskInstanceName(task.name, i)
      const taskEnv: WorkflowEnv = {
        ...state.workflowEnv,
        parameters: resolvedArgs.parameters
      }

      if (templateTask.tasks && templateTask.tasks.length > 0) {
        const savedIteration = state.workflowEnv.currentIteration
        state.workflowEnv.currentIteration = { tasks: {} }
        const sub = topologicalSort(templateTask.tasks)
        for (const subTask of sub) {
          if (state.workflowStatus.value === "failed") break
          const subInstanceName = buildTaskInstanceName(instanceName, subTask.name)

          if (subTask.when) {
            const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, subInstanceName))
            if (depthResult === "fail") {
              state.workflowStatus.value = "failed"
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
              state.workflowStatus.value = "failed"
              break
            }
          }

          if (subTask.template) {
            yield* _(expandTemplate(ctx, subTask, spec, taskEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state, compoundParentTaskId))
            const subOutput = state.workflowEnv.tasks?.[subInstanceName]
            if (subOutput && state.workflowEnv.currentIteration?.tasks) {
              state.workflowEnv.currentIteration.tasks[subTask.name] = subOutput
            }
            continue
          }

          const subRef = subTask.agent?.executorRef ?? "script"
          yield* _(ctx.insertDynamicTask(subInstanceName, subRef, compoundParentTaskId))
          yield* _(dispatchTask(subTask, taskEnv, subInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state))
          const subOutput = state.workflowEnv.tasks?.[subInstanceName]
          if (subOutput && state.workflowEnv.currentIteration?.tasks) {
            state.workflowEnv.currentIteration.tasks[subTask.name] = subOutput
          }
        }
        delete state.workflowEnv.currentIteration
        state.workflowEnv.currentIteration = savedIteration
      } else if (templateTask.agent || templateTask.script) {
        const ref = templateTask.agent?.executorRef ?? "script"
        yield* _(ctx.insertDynamicTask(instanceName, ref, compoundParentTaskId))
        yield* _(dispatchTask(templateTask, taskEnv, instanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state))
      }
    }
  })
}
```

- [ ] **Step 2: Replace template expansion in runner.ts**

In `src/workflow/runner.ts`, add import:

```ts
import { expandTemplate } from "../workflow/template-expander.js"
```

Keep the import of `resolveArguments` from `../workflow/arguments.js` — the non-template task path still uses it.

Replace the `if (task.template)` block (lines 360-471 in the original, but line numbers shift after previous edits). The block starts at the `if (task.template) {` check inside the orchestration loop. Replace the entire block with:

```ts
        if (task.template) {
          const maxDepth = resolveMaxRecursionDepth()
          yield* _(expandTemplate(ctx, task, spec, workflowEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
          continue
        }
```

- [ ] **Step 3: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 550 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/workflow/template-expander.ts src/workflow/runner.ts
git commit -m "refactor: extract template-expander with recursive expansion"
```

---

### Task 7: Build `RunDirSubscriber` + Thin Orchestrator + Signature Change

**Files:**
- Modify: `src/events/bus.ts`
- Create: `src/observability/run-dir-subscriber.ts`
- Modify: `src/workflow/runner.ts`
- Modify: `tests/workflow/runner.test.ts`
- Modify: `tests/workflow/runner-recursion.test.ts`
- Modify: `tests/workflow/runner-regression.test.ts`
- Modify: `tests/e2e/workflows.test.ts`
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/resume.ts`

- [ ] **Step 1: Add summary field to WorkflowCompleted event**

In `src/events/bus.ts`, change line 19 from:
```ts
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string }
```
To:
```ts
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string; readonly summary?: Record<string, unknown> }
```

- [ ] **Step 2: Create RunDirSubscriber**

Write `src/observability/run-dir-subscriber.ts`:

```ts
import { Effect, Scope } from "effect"
import { Event, EventBus, createSubscriber } from "../events/bus.js"
import { appendEngineLog, writeSummary, createRunDir, writeInput } from "./run-dir.js"
import type { TelemetryConfig } from "../telemetry/config.js"
import type { WorkflowSpec } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"

export const RunDirSubscriber = (
  telemetryConfig: TelemetryConfig,
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  startedAt: string
): Effect.Effect<void, never, Scope.Scope | EventBus> =>
  createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      const fileEnabled = !telemetryConfig.disableStores.has("file")
      if (!fileEnabled) return Effect.void

      if (event._tag === "WorkflowStarted") {
        return Effect.gen(function* (_) {
          yield* _(createRunDir(event.runId))
          yield* _(writeInput(event.runId, {
            spec,
            initialParameters,
            executionContext: { project_dir: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
          }))
          yield* _(appendEngineLog(event.runId, { event: "workflow_started", workflowId: spec.metadata.name }))
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "WorkflowCompleted") {
        return Effect.gen(function* (_) {
          if (event.message) {
            yield* _(appendEngineLog(event.runId, { event: "workflow_failed", error: event.message }))
          } else {
            yield* _(appendEngineLog(event.runId, { event: "workflow_completed", status: event.summary?.status }))
          }
          if (event.summary) {
            yield* _(writeSummary(event.runId, event.summary))
          }
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      return Effect.void
    }
  )
```

- [ ] **Step 3: Rebuild runner.ts as thin orchestrator**

Write `src/workflow/runner.ts`:

```ts
import { Effect, Scope } from "effect"
import { WorkflowSpec } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import type { TemplateOptions } from "../prompts/template.js"
import { collectReachableTasks, topologicalSort } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import { EventBus, createSubscriber } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"
import { loadGuidelines } from "../guidelines/loader.js"
import { extractGuidelineArtifacts } from "../guidelines/extractor.js"
import { loadSkillRegistry } from "../skills/registry.js"
import { skillsDir, guidelinesDir } from "../paths.js"
import { loadTelemetryConfig } from "../telemetry/config.js"
import { loadScriptConfig } from "../workflow/script-config.js"
import { checkRecursionDepth, evaluateWhenCondition } from "../workflow/when-guard.js"
import { dispatchTask, type TaskExecutionState } from "../workflow/task-executor.js"
import { expandTemplate } from "../workflow/template-expander.js"
import { resolveArguments } from "../workflow/arguments.js"
import { RunDirSubscriber } from "../observability/run-dir-subscriber.js"

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
  env: WorkflowEnv
  startedAt: string
  completedAt: string
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  templateOptions: TemplateOptions,
  existingRunId?: string,
  maxRecursionDepth?: number
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const startedAt = new Date().toISOString()

    const staticTasks = collectReachableTasks(spec.spec.tasks, spec.spec.run.entrypoint)
    const sortedTasks = topologicalSort(staticTasks)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, initialParameters, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    yield* _(DbWriter(ctx.db))

    const telemetryConfig = yield* _(loadTelemetryConfig)
    const fileEnabled = !telemetryConfig.disableStores.has("file")
    const scriptConfig = yield* _(loadScriptConfig)

    yield* _(RunDirSubscriber(telemetryConfig, spec, initialParameters, startedAt))

    yield* _(bus.publish({ _tag: "WorkflowStarted", runId: ctx.runId }))

    const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))
    const { files: guidelineFiles, rules: allRules } = extractGuidelineArtifacts(loadedGuidelines)

    const skillRegistry = loadSkillRegistry(skillsDir())

    const workflowEnv: WorkflowEnv = {
      ...initialParameters,
      project_dir: (initialParameters.project_dir as string) ?? process.cwd(),
      tasks: {},
      run_id: ctx.runId
    }

    const resolveMaxRecursionDepth = (): number | null => {
      if (spec.spec.run.max_recursion_depth !== undefined) return spec.spec.run.max_recursion_depth
      return maxRecursionDepth ?? null
    }

    const taskResults: Record<string, string> = {}
    let totalTokensIn = 0
    let totalTokensOut = 0
    const workflowStatus = { value: "completed" as string }

    const execState: TaskExecutionState = {
      workflowStatus,
      taskResults,
      workflowEnv
    }

    const body = Effect.gen(function* (_) {
      yield* _(createSubscriber(
        (b) => b.subscribeTo("TokenUsage"),
        (event) => Effect.sync(() => {
          totalTokensIn += event.tokensIn
          totalTokensOut += event.tokensOut
        })
      ))

      for (const task of sortedTasks) {
        if (workflowStatus.value === "failed") break

        if (task.when) {
          const maxDepth = resolveMaxRecursionDepth()
          const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
          if (depthResult === "fail") {
            workflowStatus.value = "failed"
            break
          }

          const whenResult = evaluateWhenCondition(task, workflowEnv)
          if (whenResult === "skip") {
            yield* _(ctx.transitionTask(task.name, "complete"))
            continue
          }
          if (typeof whenResult === "object" && whenResult._tag === "error") {
            yield* _(ctx.transitionTask(task.name, "fail"))
            yield* _(ctx.fail(whenResult.message))
            workflowStatus.value = "failed"
            break
          }
        }

        if (task.template) {
          const maxDepth = resolveMaxRecursionDepth()
          yield* _(expandTemplate(ctx, task, spec, workflowEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
          continue
        }

        if (!task.agent && !task.script) continue

        const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
        if (!shouldExec) continue

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(bus.publish({ _tag: "TaskPaused", runId: ctx.runId, taskId: task.name, taskName: task.name }))
          workflowStatus.value = "paused"
          break
        }

        const resolvedArgs = resolveArguments(task, workflowEnv)
        const taskEnv: WorkflowEnv = {
          ...workflowEnv,
          parameters: resolvedArgs.parameters
        }
        yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus.value === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus.value === "failed") {
        yield* _(ctx.fail(workflowStatus.value).pipe(Effect.catchAll(() => Effect.void)))
      }

      const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const summary = { runId: ctx.runId, status: workflowStatus.value, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }

      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: ctx.runId, summary }))

      return { runId: ctx.runId, status: workflowStatus.value as WorkflowResult["status"], taskResults, env: workflowEnv, startedAt, completedAt }
    })

    const completedAt = new Date().toISOString()

    return yield* _(body.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: ctx.runId, message: String(error) }))
          yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
          return { runId: ctx.runId, status: "failed" as const, taskResults, env: workflowEnv, startedAt, completedAt }
        })
      ),
      Effect.ensuring(ctx.close())
    ))
  })
}
```

- [ ] **Step 4: Update test files for new signature**

In all test files, replace all `runWorkflow(...)` calls to remove the `WorkflowRunnerConfig` object and add `templateOptions` as 3rd arg:

**`tests/workflow/runner.test.ts`:**

All calls follow the pattern:
```ts
runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
```

Change to:
```ts
runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
```

Do this for all ~20 call sites. For calls with `initialParameters`:
```ts
runWorkflow(spec, { parameters: { items: ["a", "b"] } }, { workflowsDir: ... }, { strict: false })
```
Change to:
```ts
runWorkflow(spec, { parameters: { items: ["a", "b"] }, project_dir: tmpHome }, { strict: false })
```

**`tests/workflow/runner-recursion.test.ts`:**

Same pattern — remove `{ workflowsDir: ..., projectDir: tmpHome }`, add `project_dir: tmpHome` to initial params. For the maxDepth test:
```ts
runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), maxRecursionDepth: 1, projectDir: tmpHome }, { strict: false })
```
Change to:
```ts
runWorkflow(spec, { project_dir: tmpHome }, { strict: false }, undefined, 1)
```

**`tests/workflow/runner-regression.test.ts`:**

Same pattern. All `runWorkflow(testSpec, { user_input: "test" }, { workflowsDir: ..., projectDir: tmpHome }, { strict: false })` become `runWorkflow(testSpec, { user_input: "test", project_dir: tmpHome }, { strict: false })`.

**`tests/e2e/workflows.test.ts`:**

```ts
runWorkflow(spec, { task: "fix login bug" }, { workflowsDir: ..., projectDir: testHome }, { strict: false })
```
Change to:
```ts
runWorkflow(spec, { task: "fix login bug", project_dir: testHome }, { strict: false })
```

- [ ] **Step 5: Update CLI commands for new signature**

**`src/cli/commands/run.ts`:**

Change line 84-87 from:
```ts
      runWorkflow(spec, { user_input: params.prompt, project_dir: process.cwd() }, {
        workflowsDir: wfDir,
        maxRecursionDepth: recursionConfig.maxDepth ?? undefined
      }, templateOptions, params.externalRunId).pipe(
```

To:
```ts
      runWorkflow(spec, { user_input: params.prompt, project_dir: process.cwd() }, templateOptions, params.externalRunId, recursionConfig.maxDepth ?? undefined).pipe(
```

Remove the import for `workflowsDir` if it's now unused (it's used in other places in `run.ts` so keep it).

**`src/cli/commands/resume.ts`:**

Change lines 89-92 from:
```ts
          return yield* runWorkflow(spec as unknown as WorkflowSpec, context, {
            workflowsDir: wfDir,
            maxRecursionDepth: recursionConfig.maxDepth ?? undefined
          }, templateOptions, runId).pipe(
```

To:
```ts
          return yield* runWorkflow(spec as unknown as WorkflowSpec, context, templateOptions, runId, recursionConfig.maxDepth ?? undefined).pipe(
```

- [ ] **Step 6: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 550 tests pass

- [ ] **Step 7: Run build**

Run: `bun run build`
Expected: no type errors

- [ ] **Step 8: Commit**

```bash
git add src/events/bus.ts src/observability/run-dir-subscriber.ts src/workflow/runner.ts tests/workflow/runner.test.ts tests/workflow/runner-recursion.test.ts tests/workflow/runner-regression.test.ts tests/e2e/workflows.test.ts src/cli/commands/run.ts src/cli/commands/resume.ts
git commit -m "refactor: build RunDirSubscriber, thin orchestrator, simplify signature"
```
