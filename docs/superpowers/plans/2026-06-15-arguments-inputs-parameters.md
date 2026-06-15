# Arguments, Inputs & Parameters Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the context/passing layer from ad-hoc `forEach`/`context`/`vars`/`Context` to a coherent `arguments`/`inputs.*`/`WorkflowEnv` model, and add agent-level context templates (`CONTEXT.md`) for refined system prompt context.

**Architecture:** Additive-first — new types, schemas, and modules coexist with old ones until all consumers are migrated. Then old code is removed. Every git commit passes `bun run build`. The `inputs.` template namespace wraps `WorkflowEnv` in `{ inputs: env }` for resolution.

**Tech Stack:** TypeScript, Effect-TS, `@effect/schema`, bun:sqlite, vitest

---

## Task 1: Scaffold new modules, types, and schemas

**Files:**
- Create: `src/workflow/env.ts`
- Create: `src/workflow/arguments.ts`
- Create: `tests/workflow/arguments.test.ts`
- Modify: `src/types.ts` (add new interfaces, keep old)
- Modify: `src/schemas.ts` (add `ArgumentsSchema`, keep old)
- Modify: `src/prompts/template.ts` (add `resolveInputsTemplate` export)
- Modify: `tests/prompts/template.test.ts` (add inputs-wrapped tests)
- Modify: `src/prompts/persona.ts` (add `context` field to `Persona`)
- Modify: `src/db/queries.ts` (add `updateRunEnv` alongside `updateRunContext`)

All additive — no existing code removed or broken.

- [ ] **Step 1: Create `src/workflow/env.ts`**

```typescript
export interface WorkflowEnv {
  cwd?: string
  user_input?: string
  run_id?: string
  progress_file?: string
  progress?: string
  tasks: Record<string, { outputs: Record<string, unknown> }>
  parameters?: Record<string, unknown>
  [key: string]: unknown
}
```

- [ ] **Step 2: Create `src/workflow/arguments.ts`**

```typescript
import type { WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import { resolveDottedPath } from "../prompts/template.js"

export function resolveArguments(
  task: WorkflowTask,
  env: WorkflowEnv
): { parameters: Record<string, unknown>; itemsCount: number } {
  const args = task.arguments
  if (!args) return { parameters: {}, itemsCount: 1 }

  const wrappedEnv = { inputs: env }

  let items: unknown[] = [undefined]
  if (args.forEach) {
    const resolved = resolveDottedPath(wrappedEnv, args.forEach.valueFrom.ref)
    items = Array.isArray(resolved) ? resolved : [undefined]
  }

  const lastItem = items[items.length - 1]

  let params: Record<string, unknown> = {}
  if (args.forEach) {
    params = { [args.forEach.as]: lastItem }
  }

  if (args.parameters && args.parameters.length > 0) {
    const tempEnv = { ...env, parameters: { ...params } }
    const wrappedTemp = { inputs: tempEnv }
    for (const p of args.parameters) {
      params[p.name] = resolveDottedPath(wrappedTemp, p.valueFrom.ref)
    }
  }

  return { parameters: params, itemsCount: items.length }
}
```

- [ ] **Step 3: Add new types to `src/types.ts`**

After the `ForEach` interface (after line 74), add:

```typescript
export interface ArgumentParameter {
  name: string
  valueFrom: { ref: string }
}

export interface Arguments {
  forEach?: ForEach
  parameters?: ArgumentParameter[]
}
```

Update `WorkflowTask` (line 85-93) — add `arguments?: Arguments` after `context?`:

```typescript
export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  template?: string
  forEach?: ForEach
  context?: ContextFields
  arguments?: Arguments
  tasks?: WorkflowTask[]
}
```

- [ ] **Step 4: Add `ArgumentsSchema` to `src/schemas.ts`**

After `ContextFieldsSchema` definition (line 114-116), add:

```typescript
const ArgumentsSchema = Schema.Struct({
  forEach: Schema.optional(ForEachSchema),
  parameters: Schema.optional(Schema.Array(ContextFieldSchema))
})
```

Update `WorkflowTaskSchema` — add `arguments: Schema.optional(ArgumentsSchema)` after the `context` line:

```typescript
const WorkflowTaskSchema: Schema.Schema<any> = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(TaskAgentSchema),
  template: Schema.optional(Schema.String),
  forEach: Schema.optional(ForEachSchema),
  context: Schema.optional(ContextFieldsSchema),
  arguments: Schema.optional(ArgumentsSchema),
  tasks: Schema.optional(Schema.suspend(() => Schema.Array(WorkflowTaskSchema)))
})
```

- [ ] **Step 5: Add `resolveInputsTemplate` to `src/prompts/template.ts`**

Add at end of file:

```typescript
export function resolveInputsTemplate(template: string, env: Record<string, unknown>): string {
  return resolveTemplate(template, { inputs: env })
}
```

New tests in `tests/prompts/template.test.ts` — add after existing imports at end of file:

```typescript
import { resolveInputsTemplate } from "../../src/prompts/template.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

describe("resolveInputsTemplate", () => {
  const env: WorkflowEnv = {
    cwd: "/tmp/repo",
    tasks: {
      setup: { outputs: { repo: "/tmp/repo", branch: "feat/x" } }
    },
    parameters: { current_task: { title: "Task A" } }
  }

  it("resolves inputs.tasks.setup.outputs", () => {
    expect(resolveInputsTemplate("REPO: {{inputs.tasks.setup.outputs.repo}}", env))
      .toBe("REPO: /tmp/repo")
  })

  it("resolves inputs.cwd", () => {
    expect(resolveInputsTemplate("DIR: {{inputs.cwd}}", env)).toBe("DIR: /tmp/repo")
  })

  it("resolves inputs.parameters for forEach items", () => {
    expect(resolveInputsTemplate("TASK: {{inputs.parameters.current_task}}", env))
      .toBe('TASK: {"title":"Task A"}')
  })

  it("keeps unreplaced inputs.* templates", () => {
    expect(resolveInputsTemplate("MISSING: {{inputs.nonexistent.field}}", {}))
      .toBe("MISSING: {{inputs.nonexistent.field}}")
  })
})
```

- [ ] **Step 6: Add `context` to `Persona` in `src/prompts/persona.ts`**

Update the `Persona` interface (line 6-9):

```typescript
export interface Persona {
  agent: string
  soul: string
  context: string
}
```

Update `resolvePersona` return (line 42) — add `context` field:

```typescript
    return { agent, soul, context: tryReadOptional(resolvePath("CONTEXT.md")) }
```

Note: rename the existing `tryReadOptional` helper — oh wait, it's already defined at line 15. Just use it:

```typescript
    const context = tryReadOptional(resolvePath("CONTEXT.md"))

    return { agent, soul, context }
```

- [ ] **Step 7: Add `updateRunEnv` to `src/db/queries.ts`**

After `updateRunContext` (line 245-253), add an alias:

```typescript
export function updateRunEnv(
  db: Database,
  runId: string,
  envJson: string
): void {
  db.prepare(
    `UPDATE runs SET context_json = ? WHERE id = ?`
  ).run(envJson, runId)
}
```

- [ ] **Step 8: Write `resolveArguments` unit tests**

Create `tests/workflow/arguments.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { resolveArguments } from "../../src/workflow/arguments.js"
import type { WorkflowTask, Arguments } from "../../src/types.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

function makeTask(args: Arguments): WorkflowTask {
  return { name: "test-task", arguments: args }
}

const baseEnv: WorkflowEnv = { tasks: {} }

describe("resolveArguments", () => {
  it("returns empty params and itemsCount 1 when no arguments", () => {
    const task: WorkflowTask = { name: "simple" }
    expect(resolveArguments(task, baseEnv)).toEqual({ parameters: {}, itemsCount: 1 })
  })

  it("resolves forEach items and exposes as parameters", () => {
    const env: WorkflowEnv = {
      tasks: { plan: { outputs: { tasks: [{ title: "A" }, { title: "B" }] } } }
    }
    const task = makeTask({
      forEach: { valueFrom: { ref: "inputs.tasks.plan.outputs.tasks" }, as: "current_task" }
    })
    const r = resolveArguments(task, env)
    expect(r.itemsCount).toBe(2)
    expect(r.parameters).toEqual({ current_task: { title: "B" } })
  })

  it("resolves explicit parameters from env", () => {
    const env: WorkflowEnv = {
      tasks: { setup: { outputs: { repo: "/tmp/repo", branch: "feat/x" } } }
    }
    const task = makeTask({
      parameters: [
        { name: "repository", valueFrom: { ref: "inputs.tasks.setup.outputs.repo" } }
      ]
    })
    expect(resolveArguments(task, env).parameters).toEqual({ repository: "/tmp/repo" })
  })

  it("makes forEach as-value available to parameter refs", () => {
    const env: WorkflowEnv = {
      tasks: { plan: { outputs: { tasks: ["item1", "item2"] } } }
    }
    const task = makeTask({
      forEach: { valueFrom: { ref: "inputs.tasks.plan.outputs.tasks" }, as: "item" },
      parameters: [
        { name: "wrapped", valueFrom: { ref: "inputs.parameters.item" } }
      ]
    })
    const r = resolveArguments(task, env)
    expect(r.parameters).toEqual({ item: "item2", wrapped: "item2" })
  })

  it("handles non-array forEach ref gracefully", () => {
    const env: WorkflowEnv = {
      tasks: { plan: { outputs: { tasks: "not-an-array" } } }
    }
    const task = makeTask({
      forEach: { valueFrom: { ref: "inputs.tasks.plan.outputs.tasks" }, as: "item" }
    })
    const r = resolveArguments(task, env)
    expect(r.itemsCount).toBe(1)
    expect(r.parameters).toEqual({ item: undefined })
  })
})
```

- [ ] **Step 9: Verify build + tests**

Run: `bun run build`
Expected: PASS

Run: `bun --bun vitest run tests/workflow/arguments.test.ts tests/prompts/template.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/workflow/env.ts src/workflow/arguments.ts src/types.ts src/schemas.ts \
  src/prompts/template.ts src/prompts/persona.ts src/db/queries.ts \
  tests/workflow/arguments.test.ts tests/prompts/template.test.ts
git commit -m "feat: scaffold arguments/env/types/inputs infrastructure"
```

---

## Task 2: Dual-path builder — accept both old Context and new WorkflowEnv

**Files:**
- Modify: `src/prompts/builder.ts`
- Modify: `tests/prompts/builder.test.ts`

Keep backward compatibility while adding the new path.

- [ ] **Step 1: Update `PromptParams` interface**

Replace lines 1-17:

```typescript
import type { Prompt, AgentManifest } from "../types.js"
import type { Context } from "../workflow/context.js"
import type { WorkflowEnv } from "../workflow/env.js"
import { resolveTemplate } from "./template.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  prompt: Prompt
  context?: Context
  agentConfig: Partial<AgentManifest>
  env?: WorkflowEnv
  contextTemplate?: string
}

export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
  guidelineFiles: Array<{ name: string; content: string }>
}
```

Both `context` and `env` are optional. `contextTemplate` is optional.

- [ ] **Step 2: Update system template and `buildAgentPrompt` function**

Replace lines 19-74 with dual-path logic:

```typescript
const systemTemplate = `
<platform>
# Hamilton Agentic Orchestration

Hamilton is an agentic orchestration platform where tasks are executed by agents, orchestrated as a DAG.

Your goal is to fullfil the task provided as input by Hamilton user.

## How to finish your task

When you finish your work, call the write_task_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_task_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</platform>

<instructions>
{{instructions}}
</instructions>

{{persona}}

<context>
{{context}}
</context>
`

const defaultContextTemplate = `## Inputs
{{inputs}}`

export function buildAgentPrompt(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = []
): BuiltPrompt {
  const persona = params.soulFile
    ? `<persona>\n${params.soulFile}\n</persona>`
    : ""

  let renderedContext: string

  if (params.env) {
    const template = params.contextTemplate || defaultContextTemplate
    renderedContext = resolveTemplate(template, { inputs: params.env })
  } else {
    renderedContext = Object.keys(params.context ?? {}).length > 0
      ? `<context>\n${JSON.stringify(params.context, null, 2)}\n</context>`
      : ""
  }

  const resolvedSystem = resolveTemplate(systemTemplate, {
    ...(params.context ?? {}),
    instructions: params.agentFile,
    persona,
    context: renderedContext,
  })

  const resolveData: Record<string, unknown> = params.env
    ? { inputs: params.env }
    : (params.context ?? {})

  const resolvedInput = resolveTemplate(params.prompt.content ?? "", resolveData)

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}
```

- [ ] **Step 3: Update `tests/prompts/builder.test.ts`**

Keep all existing tests (they use `context: Context` — old path). Add new tests at the end for the `env` path:

```typescript
import type { WorkflowEnv } from "../../src/workflow/env.js"

describe("buildAgentPrompt with env", () => {
  it("resolves task prompt from env inputs.*", () => {
    const params: PromptParams = {
      agentFile: "You are a coder.",
      soulFile: "",
      prompt: { content: "Fix bug in {{inputs.tasks.setup.outputs.repo}}" },
      env: { tasks: { setup: { outputs: { repo: "hamilton" } } } },
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("uses default context template when env is provided without contextTemplate", () => {
    const params: PromptParams = {
      agentFile: "agent",
      soulFile: "",
      prompt: { content: "do" },
      env: { cwd: "/tmp/repo", tasks: {} },
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("/tmp/repo")
    expect(result.systemPrompt).toContain("## Inputs")
  })

  it("uses custom context template when provided", () => {
    const params: PromptParams = {
      agentFile: "agent",
      soulFile: "",
      prompt: { content: "do" },
      env: { cwd: "/tmp/repo", tasks: {} },
      contextTemplate: "Working in {{inputs.cwd}}",
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("Working in /tmp/repo")
    expect(result.systemPrompt).not.toContain("## Inputs")
  })

  it("falls back to old context path when env is not provided", () => {
    const params: PromptParams = {
      agentFile: "agent",
      soulFile: "",
      prompt: { content: "Fix {{repo}}" },
      context: { repo: "hamilton" },
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain("Fix hamilton")
    expect(result.systemPrompt).toContain('"repo": "hamilton"')
  })
})
```

- [ ] **Step 4: Run build + tests**

Run: `bun run build`
Expected: PASS

Run: `bun --bun vitest run tests/prompts/builder.test.ts`
Expected: PASS (all old + new tests)

- [ ] **Step 5: Commit**

```bash
git add src/prompts/builder.ts tests/prompts/builder.test.ts
git commit -m "refactor: dual-path builder supporting both Context and WorkflowEnv"
```

---

## Task 3: Dual-path runner — use resolveArguments for tasks with arguments field

**Files:**
- Modify: `src/workflow/runner.ts`

Add a dual-path check in the forEach/context resolution: if `task.arguments` exists, use new `resolveArguments` + `WorkflowEnv`; otherwise use old `buildAutoContext` + `Context`.

- [ ] **Step 1: Update imports**

Add to imports (after existing import lines):

```typescript
import { resolveArguments } from "../workflow/arguments.js"
import { type WorkflowEnv } from "../workflow/env.js"
```

- [ ] **Step 2: Update `WorkflowResult` interface**

Change `context: Context` to include both for dual-path:

```typescript
export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
  context: Context
  env: WorkflowEnv
  startedAt: string
  completedAt: string
}
```

- [ ] **Step 3: Initialize `workflowEnv` alongside `runningContext`**

After line 107 (`const runningContext: Context = ...`), add:

```typescript
    const workflowEnv: WorkflowEnv = {
      ...(initialContext as WorkflowEnv),
      tasks: {},
      run_id: runId,
      progress_file: progressFilePath,
      progress: progressContent
    }
```

- [ ] **Step 4: Add dual-path logic in forEach loop**

This is the key change. In the body's `for (const task of sortedTasks)` loop, add a dual-path check. The existing forEach/context logic is in lines 223-273. We add a check:

Replace lines 220-273 with:

```typescript
      for (const task of sortedTasks) {
        if (workflowStatus === "failed") break

        const useArguments = !!task.arguments

        if (task.template) {
          const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
          if (!templateTask) continue

          if (useArguments) {
            const resolvedArgs = resolveArguments(task, workflowEnv)

            for (let i = 0; i < resolvedArgs.itemsCount; i++) {
              if (workflowStatus === "failed") break

              const instanceName = `${task.name}/${i}`
              const taskEnv: WorkflowEnv = {
                ...workflowEnv,
                parameters: resolvedArgs.parameters
              }

              if (templateTask.tasks && templateTask.tasks.length > 0) {
                const sub = topologicalSort(templateTask.tasks)
                for (const subTask of sub) {
                  if (workflowStatus === "failed") break
                  const subInstanceName = `${instanceName}-${subTask.name}`
                  yield* _(ctx.insertDynamicTask(subInstanceName, subTask.agent!.executorRef))
                  yield* _(executeSingleTask(subTask, taskEnv, subInstanceName))
                }
              } else if (templateTask.agent) {
                yield* _(ctx.insertDynamicTask(instanceName, templateTask.agent!.executorRef))
                yield* _(executeSingleTask(templateTask, taskEnv, instanceName))
              }
            }
            continue
          }

          // Old path
          const arrValue = task.forEach
            ? resolveDottedPath(runningContext, task.forEach.valueFrom.ref)
            : undefined
          const items = Array.isArray(arrValue) ? arrValue : [undefined]

          for (let i = 0; i < items.length; i++) {
            if (workflowStatus === "failed") break

            const instanceName = `${task.name}/${i}`
            const vars: Context = {}
            if (task.forEach && items[i] !== undefined) {
              vars[task.forEach.as] = items[i]
            }

            const subContext = buildAutoContext(task, runningContext, vars)

            if (templateTask.tasks && templateTask.tasks.length > 0) {
              const sub = topologicalSort(templateTask.tasks)
              for (const subTask of sub) {
                if (workflowStatus === "failed") break
                const subInstanceName = `${instanceName}-${subTask.name}`
                yield* _(ctx.insertDynamicTask(subInstanceName, subTask.agent!.executorRef))
                yield* _(executeSingleTask(subTask, subContext, subInstanceName))
              }
            } else if (templateTask.agent) {
              yield* _(ctx.insertDynamicTask(instanceName, templateTask.agent!.executorRef))
              yield* _(executeSingleTask(templateTask, subContext, instanceName))
            }
          }
          continue
        }

        if (!task.agent) continue

        const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
        if (!shouldExec) continue

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(bus.publish({ _tag: "TaskPaused", runId, taskId: task.name }))
          workflowStatus = "paused"
          break
        }

        if (useArguments) {
          const resolvedArgs = resolveArguments(task, workflowEnv)
          const taskEnv: WorkflowEnv = {
            ...workflowEnv,
            parameters: resolvedArgs.parameters
          }
          yield* _(executeSingleTask(task, taskEnv, task.name))
        } else {
          const taskContext = buildAutoContext(task, runningContext, {})
          yield* _(executeSingleTask(task, taskContext, task.name))
        }
      }
```

- [ ] **Step 5: Update task output storage to mirror to workflowEnv**

After line 200-202 (where task output is stored in `runningContext.tasks`), add mirror to `workflowEnv`:

```typescript
        if (useArguments) {
          workflowEnv.tasks[instanceName] = { outputs: output as Record<string, unknown> }
        }

        taskResults[instanceName] = String(output.status ?? "done")
        if (!runningContext.tasks) (runningContext as Record<string, unknown>).tasks = {}
        ;(runningContext.tasks as Record<string, unknown>)[instanceName] = { outputs: output }
```

- [ ] **Step 6: Update `executeSingleTask` to accept `WorkflowEnv` with an explicit flag**

Instead of runtime shape detection, pass a `useNewPath` boolean:

Update `executeSingleTask` signature (line 113-117):

```typescript
    const executeSingleTask = (
      task: WorkflowTask,
      taskData: Context | WorkflowEnv,
      instanceName: string,
      useNewPath: boolean
    ): Effect.Effect<void, unknown, EventBus | Scope.Scope> =>
```

Then in the `buildAgentPrompt` call (line 135-141):

```typescript
        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          contextTemplate: useNewPath ? persona.context : undefined,
          prompt: task.agent!.prompt,
          context: useNewPath ? undefined : (taskData as Context),
          env: useNewPath ? (taskData as WorkflowEnv) : undefined,
          agentConfig: agent
        }, guidelineFiles)
```

And update the `user_input` reference:

```typescript
        const finalPrompt = task.name === spec.spec.run.entrypoint
          ? { ...prompt, taskPrompt: `${prompt.taskPrompt}\n\n# User input\n\n${useNewPath ? (taskData as WorkflowEnv).user_input ?? "" : (taskData as Context).user_input ?? ""}` }
          : prompt
```

Update all call sites to pass `useNewPath`:
- Old forEach path: `yield* _(executeSingleTask(subTask, subContext, subInstanceName, false))`
- Old static path: `yield* _(executeSingleTask(task, taskContext, task.name, false))`
- New forEach path: `yield* _(executeSingleTask(templateTask, taskEnv, instanceName, true))`
- New static path: `yield* _(executeSingleTask(task, taskEnv, task.name, true))`

- [ ] **Step 7: Update return values**

In the body return (line 293):

```typescript
      return { runId, status: workflowStatus, taskResults, context: runningContext, env: workflowEnv, startedAt, completedAt } as WorkflowResult
```

And in catchAll return (line 309):

```typescript
          return { runId, status: "failed" as const, taskResults, context: runningContext, env: workflowEnv, startedAt, completedAt }
```

- [ ] **Step 8: Verify build + existing tests pass**

Run: `bun run build`
Expected: PASS (old path still works, `buildAutoContext` still imported)

Run: `bun --bun vitest run tests/workflow/runner.test.ts tests/workflow/runner-regression.test.ts`
Expected: PASS (all tests use old YAML fixtures → old path)

- [ ] **Step 9: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "refactor: dual-path runner for arguments/env alongside legacy context"
```

---

## Task 4: Rename internals — initialContext, updateRunContext, run-state-machine

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/workflow/run-state-machine.ts`
- Modify: `tests/cli/run.test.ts`
- Modify: `tests/workflow/run-state-machine.test.ts`
- Modify: `tests/db/queries.test.ts`

Pure renames, no behavior changes.

- [ ] **Step 1: Rename in `src/cli/commands/run.ts`**

Line 68: `initialContext` → `initialParameters` (variable rename only, value unchanged).

- [ ] **Step 2: Rename in `src/workflow/run-state-machine.ts`**

Line 21: Change import from `import type { Context } from "../workflow/context.js"` to `import type { WorkflowEnv } from "../workflow/env.js"`

Line 231: Change `context: Context` to `params: WorkflowEnv`

Line 273: Change `updateRunContext(db, existingRunId, JSON.stringify(context))` to `updateRunEnv(db, existingRunId, JSON.stringify(params))`

Line 287: Change `updateRunContext(db, runId, JSON.stringify(context))` to `updateRunEnv(db, runId, JSON.stringify(params))`

- [ ] **Step 3: Update tests**

In `tests/cli/run.test.ts`: search for `initialContext` and rename to `initialParameters`.

In `tests/workflow/run-state-machine.test.ts`: update `createWorkflowRuntime` calls — change `context` parameter name.

In `tests/db/queries.test.ts`: search for `updateRunContext` and add/use `updateRunEnv` instead.

- [ ] **Step 4: Verify build + tests**

Run: `bun run build`
Expected: PASS

Run: `bun --bun vitest run tests/cli/run.test.ts tests/workflow/run-state-machine.test.ts tests/db/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/run.ts src/workflow/run-state-machine.ts tests/cli/run.test.ts tests/workflow/run-state-machine.test.ts tests/db/queries.test.ts
git commit -m "refactor: rename initialContext→initialParameters, updateRunContext→updateRunEnv"
```

---

## Task 5: Migrate YAML workflow files to arguments + inputs.* namespace

**Files:**
- Modify: `bundle/workflows/feature-dev/workflow.yml`
- Modify: `bundle/workflows/security-audit/workflow.yml`
- Modify: `bundle/workflows/bug-fix/workflow.yml`
- Modify: `bundle/workflows/do/workflow.yml`
- Modify: `bundle/workflows/scaffold/workflow.yml`
- Modify: `bundle/workflows/quarantine-broken-tests/workflow.yml`
- Modify: `tests/fixtures/feature-dev.yml`

Two patterns to change:
1. `forEach` + `context` → grouped under `arguments`
2. Template references: `{{tasks.xxx}}` → `{{inputs.tasks.xxx}}`, `{{vars.xxx}}` → `{{inputs.parameters.xxx}}`, `{{cwd}}` → `{{inputs.cwd}}`, `{{user_input}}` → `{{inputs.user_input}}`, `{{run_id}}` → `{{inputs.run_id}}`, `{{progress}}` → `{{inputs.progress}}`, `{{progress_file}}` → `{{inputs.progress_file}}`
3. `valueFrom.ref` strings in forEach/parameters: `tasks.xxx` → `inputs.tasks.xxx`

- [ ] **Step 1: Migrate `bundle/workflows/feature-dev/workflow.yml`**

Changes:
- Line 83-87: Move `forEach` under `arguments`:
  ```yaml
      arguments:
        forEach:
          valueFrom:
            ref: inputs.tasks.plan.outputs.tasks
          as: current_task
  ```
- Lines 96, 98, 99: `{{cwd}}` → `{{inputs.cwd}}`, `{{tasks.setup.outputs.current_branch}}` → `{{inputs.tasks.setup.outputs.current_branch}}`, `{{tasks.setup.outputs.build_cmd}}` → `{{inputs.tasks.setup.outputs.build_cmd}}`, `{{tasks.setup.outputs.test_cmd}}` → `{{inputs.tasks.setup.outputs.test_cmd}}`
- Lines 102, 120, 156: `{{vars.current_task}}` → `{{inputs.parameters.current_task}}`, `{{vars.current_task.title}}` → `{{inputs.parameters.current_task.title}}`
- Lines 111, 159: `{{progress}}` → `{{inputs.progress}}`, `{{progress_file}}` → `{{inputs.progress_file}}`
- Lines 138-141: Same for verify-stories forEach
- Lines 150-153: `{{tasks.plan.outputs.repo}}` → `{{inputs.tasks.plan.outputs.repo}}`, etc.
- Lines 164-165: `{{tasks.setup.outputs.test_cmd}}` → `{{inputs.tasks.setup.outputs.test_cmd}}`

- [ ] **Step 2: Migrate `bundle/workflows/security-audit/workflow.yml`**

Changes:
- Lines 136-142: Move `forEach` under `arguments` with `inputs.tasks.prioritize.outputs.stories_json`
- Lines 74, 115, 116, 152-154, 157, 212-214, 219, 263-266: All `{{tasks.xxx}}` → `{{inputs.tasks.xxx}}`, `{{vars.current_story}}` → `{{inputs.parameters.current_story}}`

- [ ] **Step 3: Migrate `bundle/workflows/bug-fix/workflow.yml`**

This workflow has no forEach/context/vars — only `{{tasks.xxx}}` template references. Replace all:
- `{{tasks.triage.outputs.repo}}` → `{{inputs.tasks.triage.outputs.repo}}`
- `{{tasks.triage.outputs.branch}}` → `{{inputs.tasks.triage.outputs.branch}}`
- `{{tasks.setup.outputs.build_cmd}}` → `{{inputs.tasks.setup.outputs.build_cmd}}`
- `{{tasks.setup.outputs.test_cmd}}` → `{{inputs.tasks.setup.outputs.test_cmd}}`

- [ ] **Step 4: Migrate `bundle/workflows/do/workflow.yml`**

No forEach/context/vars/tasks references. Only has `{{cwd}}` reference — none found. No changes needed.

- [ ] **Step 5: Migrate `bundle/workflows/scaffold/workflow.yml`**

Replace:
- `{{tasks.scaffold.outputs.project_dir}}` → `{{inputs.tasks.scaffold.outputs.project_dir}}`
- `{{tasks.scaffold.outputs.build_cmd}}` → `{{inputs.tasks.scaffold.outputs.build_cmd}}`
- `{{tasks.scaffold.outputs.test_cmd}}` → `{{inputs.tasks.scaffold.outputs.test_cmd}}`
- `{{tasks.scaffold.outputs.tech_stack}}` → `{{inputs.tasks.scaffold.outputs.tech_stack}}`

- [ ] **Step 6: Migrate `bundle/workflows/quarantine-broken-tests/workflow.yml`**

Replace:
- `{{tasks.setup.outputs.repo}}` → `{{inputs.tasks.setup.outputs.repo}}`
- `{{tasks.setup.outputs.branch}}` → `{{inputs.tasks.setup.outputs.branch}}`
- `{{tasks.setup.outputs.build_cmd}}` → `{{inputs.tasks.setup.outputs.build_cmd}}`
- `{{tasks.setup.outputs.test_cmd}}` → `{{inputs.tasks.setup.outputs.test_cmd}}`

- [ ] **Step 7: Migrate `tests/fixtures/feature-dev.yml`**

Lines 47-56 — the `forEach` + `context` block:
```yaml
      arguments:
        forEach:
          valueFrom:
            ref: inputs.tasks.plan.outputs.user_stories
          as: user_story
        parameters:
          - name: repository
            valueFrom:
              ref: inputs.tasks.setup.outputs.repo
```

Line 43: `{{tasks.setup.outputs.repo}}` → `{{inputs.tasks.setup.outputs.repo}}`

- [ ] **Step 8: Verify build**

Run: `bun run build`
Expected: PASS (YAML changes don't affect TypeScript compilation)

- [ ] **Step 9: Commit**

```bash
git add bundle/workflows/ tests/fixtures/
git commit -m "refactor: migrate YAML workflows to arguments + inputs.* namespace"
```

---

## Task 6: Update test assertions for new types

**Files:**
- Modify: `tests/workflow/runner.test.ts` (env assertions)
- Modify: `tests/workflow/context.test.ts` → becomes `tests/workflow/arguments.test.ts` (already created in Task 1)
- Modify: `tests/types.test.ts` (forEach → arguments traversal)
- Modify: `tests/workflow/runner-regression.test.ts` (fixture YAML refs)

- [ ] **Step 1: Update `tests/workflow/runner.test.ts`**

The test at line 107-119 asserts `result.context.tasks.plan`. Update to also check `result.env.tasks.plan`:

```typescript
  it("accumulates task outputs in env.tasks.<name>.outputs", async () => {
    const spec = makeSpec()
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.status).toBe("completed")
    expect(result.env.tasks).toBeDefined()
    expect(result.env.tasks["plan"]).toEqual({ outputs: { status: "done", result: "ok" } })
    expect(result.env.tasks["implement"]).toEqual({ outputs: { status: "done", result: "ok" } })
  })
```

- [ ] **Step 2: Update `tests/types.test.ts`**

Search for `task.forEach?.as` references. If they traverse `forEach` on a task, update to also check `task.arguments?.forEach?.as`.

- [ ] **Step 3: Update `tests/workflow/runner-regression.test.ts`**

Search for any `tasks.` or `vars.` references in fixture-based test assertions and update to `inputs.tasks.` / `inputs.parameters.`.

- [ ] **Step 4: Run tests**

Run: `bun --bun vitest run tests/workflow/runner.test.ts tests/workflow/runner-regression.test.ts tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/workflow/runner.test.ts tests/types.test.ts tests/workflow/runner-regression.test.ts
git commit -m "test: update runner assertions for WorkflowEnv and arguments"
```

---

## Task 7: Remove old code — context.ts, old types, dual-path logic

**Files:**
- Delete: `src/workflow/context.ts`
- Delete: `tests/workflow/context.test.ts`
- Modify: `src/types.ts` (remove `ContextField`, `ContextFields`, `forEach?`, `context?` from `WorkflowTask`)
- Modify: `src/schemas.ts` (remove old `ForEachSchema` top-level, old `ContextFieldsSchema`, old fields from `WorkflowTaskSchema`)
- Modify: `src/workflow/runner.ts` (remove old path, remove `buildAutoContext` import)
- Modify: `src/prompts/builder.ts` (remove old `context` path, remove `Context` import)
- Modify: `tests/prompts/builder.test.ts` (remove old path tests, update param type)

- [ ] **Step 1: Clean `src/types.ts`**

Remove: `ContextField` (lines 76-79), `ContextFields` (lines 81-83).
From `WorkflowTask` (lines 85-93), remove `forEach?: ForEach` and `context?: ContextFields`:

```typescript
export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  template?: string
  arguments?: Arguments
  tasks?: WorkflowTask[]
}
```

- [ ] **Step 2: Clean `src/schemas.ts`**

Remove `ContextFieldSchema` (lines 109-112), `ContextFieldsSchema` (lines 114-116).
Update `WorkflowTaskSchema` — remove `forEach: Schema.optional(ForEachSchema)` and `context: Schema.optional(ContextFieldsSchema)`.

Note: keep `ForEachSchema` — it's still used inside `ArgumentsSchema`.

Rename `ContextFieldSchema` to `ArgumentParameterSchema`:

```typescript
const ArgumentParameterSchema = Schema.Struct({
  name: Schema.String,
  valueFrom: Schema.Struct({ ref: Schema.String })
})
```

And update `ArgumentsSchema` to use it:

```typescript
const ArgumentsSchema = Schema.Struct({
  forEach: Schema.optional(ForEachSchema),
  parameters: Schema.optional(Schema.Array(ArgumentParameterSchema))
})
```

- [ ] **Step 3: Delete old files**

Remove `src/workflow/context.ts` and `tests/workflow/context.test.ts`.

- [ ] **Step 4: Clean `src/workflow/runner.ts`**

Remove `buildAutoContext` and `Context` type imports. Remove the old dual-path code:
- Delete lines 227-256 (old forEach path after the `continue` in the new path)
- Delete lines 270-272 (old `buildAutoContext` fallback for static tasks)
- Remove references to `runningContext` — replace with `workflowEnv`
- Remove `runningContext` initialization

The `executeSingleTask` should only accept `WorkflowEnv`, not `Context | WorkflowEnv`.

- [ ] **Step 5: Clean `src/prompts/builder.ts`**

Remove `Context` import. Remove the `context?: Context` field from `PromptParams`. Remove the old-path `else` branch. Make `env: WorkflowEnv` required.

Final `PromptParams`:

```typescript
export interface PromptParams {
  agentFile: string
  soulFile: string
  prompt: Prompt
  env: WorkflowEnv
  contextTemplate?: string
  agentConfig: Partial<AgentManifest>
}
```

Final `buildAgentPrompt`:

```typescript
export function buildAgentPrompt(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = []
): BuiltPrompt {
  const persona = params.soulFile
    ? `<persona>\n${params.soulFile}\n</persona>`
    : ""

  const template = params.contextTemplate || defaultContextTemplate
  const renderedContext = resolveTemplate(template, { inputs: params.env })

  const resolvedSystem = resolveTemplate(systemTemplate, {
    instructions: params.agentFile,
    persona,
    context: renderedContext,
  })

  const resolvedInput = resolveTemplate(params.prompt.content ?? "", { inputs: params.env })

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}
```

- [ ] **Step 6: Update tests to remove old path**

In `tests/prompts/builder.test.ts`: Update all `baseParams` to use `env: makeEnv()` instead of `context: {}`. Remove the old `context: Context` based test. Remove the "falls back to old context path" test.

- [ ] **Step 7: Verify build**

Run: `bun run build`
Expected: PASS (all old code removed, all consumers migrated)

- [ ] **Step 8: Commit**

```bash
git rm src/workflow/context.ts tests/workflow/context.test.ts
git add src/types.ts src/schemas.ts src/workflow/runner.ts src/prompts/builder.ts tests/prompts/builder.test.ts
git commit -m "refactor: remove old context.ts and dual-path logic, full migration complete"
```

---

## Task 8: Full test suite verification

- [ ] **Step 1: Run full test suite**

Run: `bun --bun vitest run`
Expected: All 155 tests pass

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Check for any leftover old-term references**

Run: `grep -r "buildAutoContext\|mergeContext\|initialContext\|runningContext\|taskContext\|updateRunContext\|ContextField\|ContextFields" src/ tests/ --include="*.ts"`
Expected: No results (all removed)

Run: `grep -r "{{vars\.\|{{tasks\.\|{{cwd}}" bundle/ tests/ --include="*.yml"`
Expected: No results (all migrated to `inputs.*`)

- [ ] **Step 4: Commit**

```bash
git commit -am "chore: final verification — all 155 tests pass, no old-term remnants"
```

---

## Verification checklist

After all tasks complete:

- `bun run build` passes
- `bun --bun vitest run` — all tests pass
- Zero references to `buildAutoContext`, `mergeContext`, `Context` (old type) in `src/`
- Zero references to `{{vars.`, `{{tasks.` (bare), `{{cwd}}` in YAML files
- All `forEach` + `context` blocks migrated to `arguments` in YAML
- `resolveArguments` tested for: no args, forEach-only, parameters-only, forEach+parameters, forEach item accessible via `inputs.parameters.<as>`, non-array forEach ref
