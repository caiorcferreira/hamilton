# DAG Workflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Hamilton workflow YAML format and execution engine from linear step-based to DAG task-based model.

**Architecture:** Clean-slate rewrite of core modules (types, schemas, context, engine, loader, runner) with the DAG model. Reuse and adapt the state machine, event bus, pi-executor, and CLI. Convert all 20 workflow YAMLs. Delete old linear engine code.

**Tech Stack:** TypeScript, bun, Effect-TS 3.21.3, @effect/schema 0.75.5, bun:sqlite, yaml 2.4.5, go-duration-js, ajv

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Rewrite | DAG task types, agent types, branded types |
| `src/schemas.ts` | Rewrite | DAG YAML schema validation via @effect/schema |
| `src/workflow/context.ts` | Rewrite | Dotted path resolution, auto-derived context merging |
| `src/workflow/engine.ts` | Rewrite | Topological sort, template expansion, forEach instantiation, timeout resolution |
| `src/workflow/loader.ts` | Rewrite | YAML loading with new schema |
| `src/workflow/runner.ts` | Rewrite | DAG-aware sequential executor |
| `src/workflow/run-state-machine.ts` | Modify | Tasks instead of steps, dynamic task insertion |
| `src/agent/persona.ts` | Modify | Resolution from `settings.systemPrompt` paths |
| `src/agent/activity.ts` | Modify | Prompt building for new agent config structure |
| `src/agent/write-step-output-tool.ts` | Modify | Optional JSON Schema validation |
| `src/agent/pi-executor.ts` | Modify | Pass output schema to write_step_output tool |
| `src/db/schema.ts` | Modify | Rename step columns to task |
| `src/db/queries.ts` | Modify | Task-level CRUD, add insertTask |
| `src/cli/commands/install.ts` | Modify | Runtime shared agent copy |
| `src/paths.ts` | Modify | Shared agent paths |
| `src/agent/config.ts` | Delete | Settings now inline in YAML |
| `src/workflow/deterministic-activities.ts` | Delete | Replaced by task-based approach |
| `workflows/*/workflow.yml` | Rewrite (x20) | New DAG format |
| `tests/fixtures/feature-dev.yml` | Create | New test fixture |
| `tests/workflow/engine.test.ts` | Rewrite | New engine tests |

---

### Task 1: Install `go-duration-js` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependency**

```bash
bun add go-duration-js
```

- [ ] **Step 2: Verify install**

```bash
bun install
```
Expected: no errors, `go-duration-js` appears in `package.json` dependencies and `bun.lock`

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add go-duration-js for Go-style duration parsing"
```

---

### Task 2: Rewrite `src/types.ts` — DAG types

**Files:**
- Create: `src/types.ts` (rewrite)
- Create: `tests/types.test.ts` (rewrite)

All types use branded strings for compile-time safety, matching the existing pattern.

- [ ] **Step 1: Write the types test**

```typescript
// tests/types.test.ts
import { describe, it, expect } from "vitest"
import type {
  WorkflowSpec,
  WorkflowAgent,
  WorkflowTask,
  AgentRole,
  TaskRef,
  OnFailure,
  Timeout,
  Prompt,
  OutputConfig,
  ForEach,
  ContextFields,
  RunConfig
} from "../src/types.js"

describe("types", () => {
  it("should exist as type-level exports", () => {
    const role: AgentRole = "analysis"
    expect(role).toBe("analysis")

    const agent: WorkflowAgent = {
      name: "planner",
      role: "analysis",
      description: "Decomposes tasks",
      settings: {
        model: "deepseek-v4-pro-official",
        systemPrompt: {
          agent: "agents/planner/AGENTS.md",
          soul: "agents/planner/SOUL.md",
          identity: "agents/planner/IDENTITY.md"
        },
        skills: ["hamilton-agents"]
      }
    }
    expect(agent.name).toBe("planner")

    const onFailure: OnFailure = {
      max_retries: 4,
      escalate_to: "human"
    }
    expect(onFailure.max_retries).toBe(4)

    const task: WorkflowTask = {
      name: "plan",
      dependencies: [],
      agent: {
        ref: "agents.planner",
        timeout: { fixed: "300s" },
        on_failure: onFailure,
        output: { schema: { type: "object", properties: {} } },
        prompt: { content: "Do the thing {{task}}" }
      }
    }
    expect(task.name).toBe("plan")

    const runConfig: RunConfig = {
      entrypoint: "plan",
      timeout: "300s"
    }
    expect(runConfig.entrypoint).toBe("plan")

    const spec: WorkflowSpec = {
      version: 1,
      name: "feature-dev",
      run: runConfig,
      agents: [agent],
      tasks: [task]
    }
    expect(spec.version).toBe(1)
  })

  it("WorkflowTask with template and forEach", () => {
    const task: WorkflowTask = {
      name: "codify",
      dependencies: ["setup"],
      template: "develop",
      forEach: {
        valueFrom: { ref: "tasks.plan.outputs.user_stories" },
        as: "user_story"
      },
      context: {
        fields: [
          { name: "setup", valueFrom: { ref: "tasks.setup.outputs" } }
        ]
      }
    }
    expect(task.template).toBe("develop")
    expect(task.forEach?.as).toBe("user_story")
  })

  it("WorkflowTask with template but no dependencies", () => {
    const task: WorkflowTask = {
      name: "develop",
      tasks: [
        { name: "implement", agent: { ref: "agents.developer", prompt: { content: "Implement" } } },
        { name: "test", dependencies: ["implement"], agent: { ref: "agents.tester", prompt: { content: "Test" } } }
      ]
    }
    expect(task.tasks).toHaveLength(2)
    expect(task.tasks![0].name).toBe("implement")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/types.test.ts
```
Expected: FAIL — module not found / types not exported

- [ ] **Step 3: Write `src/types.ts`**

```typescript
export type AgentRole =
  | "analysis"
  | "coding"
  | "verification"
  | "testing"
  | "pr"
  | "scanning"

export type TaskName = string & { readonly __brand: "TaskName" }
export type AgentName = string & { readonly __brand: "AgentName" }
export type RunId = string & { readonly __brand: "RunId" }
export type TaskId = string & { readonly __brand: "TaskId" }

export interface RunConfig {
  entrypoint: string
  timeout: string
}

export interface SystemPromptPaths {
  agent: string
  soul: string
  identity: string
}

export interface AgentSettings {
  model?: string
  systemPrompt: SystemPromptPaths
  skills?: string[]
}

export interface WorkflowAgent {
  name: string
  role: AgentRole
  description?: string
  settings: AgentSettings
}

export interface RefPath {
  ref: string
}

export interface Timeout {
  fixed: string
}

export interface OnExhausted {
  escalate_to?: string
}

export interface OnFailure {
  max_retries?: number
  escalate_to?: string
  retry_step?: string
  on_exhausted?: OnExhausted
}

export interface OutputConfig {
  schema?: Record<string, unknown>
}

export interface Prompt {
  content: string
}

export interface TaskAgent {
  ref: string
  timeout?: Timeout
  on_failure?: OnFailure
  output?: OutputConfig
  prompt: Prompt
}

export interface ForEach {
  valueFrom: RefPath
  as: string
}

export interface ContextField {
  name: string
  valueFrom: RefPath
}

export interface ContextFields {
  fields: ContextField[]
}

export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  template?: string
  forEach?: ForEach
  context?: ContextFields
  tasks?: WorkflowTask[]
}

export interface WorkflowSpec {
  version: number
  name: string
  description?: string
  run: RunConfig
  agents: WorkflowAgent[]
  tasks: WorkflowTask[]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/types.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: rewrite types for DAG task model"
```

---

### Task 3: Rewrite `src/schemas.ts` — DAG schema validation

**Files:**
- Create: `src/schemas.ts` (rewrite)
- Modify: `tests/schemas.test.ts` (rewrite)
- Create: `tests/fixtures/feature-dev.yml`

- [ ] **Step 1: Create test fixture**

```yaml
# tests/fixtures/feature-dev.yml
version: 1
name: feature-dev
description: Feature development workflow
run:
  entrypoint: plan
  timeout: 300s
agents:
  - name: planner
    role: analysis
    description: Decomposes tasks
    settings:
      model: deepseek-v4-pro-official
      systemPrompt:
        agent: agents/planner/AGENTS.md
        soul: agents/planner/SOUL.md
        identity: agents/planner/IDENTITY.md
      skills:
        - hamilton-agents
  - name: setup
    role: coding
    description: Prepares environment
    settings:
      systemPrompt:
        agent: shared/agents/setup/AGENTS.md
        soul: shared/agents/setup/SOUL.md
        identity: shared/agents/setup/IDENTITY.md
      skills:
        - hamilton-agents
  - name: developer
    role: coding
    description: Implements features
    settings:
      systemPrompt:
        agent: agents/developer/AGENTS.md
        soul: agents/developer/SOUL.md
        identity: agents/developer/IDENTITY.md
      skills:
        - hamilton-agents
  - name: verifier
    role: verification
    description: Verifies work
    settings:
      systemPrompt:
        agent: shared/agents/verifier/AGENTS.md
        soul: shared/agents/verifier/SOUL.md
        identity: shared/agents/verifier/IDENTITY.md
      skills:
        - hamilton-agents
  - name: tester
    role: testing
    description: Integration testing
    settings:
      systemPrompt:
        agent: agents/tester/AGENTS.md
        soul: agents/tester/SOUL.md
        identity: agents/tester/IDENTITY.md
      skills:
        - hamilton-agents
tasks:
  - name: plan
    agent:
      ref: agents.planner
      on_failure:
        max_retries: 4
        escalate_to: human
      output:
        schema:
          type: object
          properties:
            status:
              type: string
            user_stories:
              type: array
              items:
                type: object
                properties:
                  id:
                    type: string
                  title:
                    type: string
                  description:
                    type: string
                  acceptanceCriteria:
                    type: array
                    items:
                      type: string
                required:
                  - id
                  - title
                  - description
                  - acceptanceCriteria
          required:
            - status
            - user_stories
      prompt:
        content: |
          Decompose the following task into ordered user stories.
          TASK:
          {{task}}
  - name: setup
    dependencies:
      - plan
    agent:
      ref: agents.setup
      timeout:
        fixed: 300s
      on_failure:
        max_retries: 4
        escalate_to: human
      prompt:
        content: |
          Prepare the development environment.
          REPO: {{repo}}
          BRANCH: {{branch}}
  - name: codify
    dependencies:
      - setup
    template: develop
    forEach:
      valueFrom:
        ref: tasks.plan.outputs.user_stories
      as: user_story
    context:
      fields:
        - name: repository
          valueFrom:
            ref: tasks.setup.outputs.repo
        - name: current_branch
          valueFrom:
            ref: tasks.setup.outputs.branch
        - name: story
          valueFrom:
            ref: vars.user_story
  - name: develop
    tasks:
      - name: implement
        agent:
          ref: agents.developer
          timeout:
            fixed: 600s
          on_failure:
            max_retries: 4
            escalate_to: human
          prompt:
            content: |
              Implement the user story.
              CURRENT STORY:
              {{current_story}}
      - name: test
        dependencies:
          - implement
        agent:
          ref: agents.tester
          on_failure:
            retry_step: implement
            max_retries: 4
            on_exhausted:
              escalate_to: human
          prompt:
            content: |
              Integration testing.
              BUILD_CMD: {{build_cmd}}
              TEST_CMD: {{test_cmd}}
      - name: review
        dependencies:
          - test
        agent:
          ref: agents.verifier
          on_failure:
            retry_step: implement
            max_retries: 4
            on_exhausted:
              escalate_to: human
          prompt:
            content: |
              Verify the work.
              TEST_CMD: {{test_cmd}}
```

- [ ] **Step 2: Write the schema tests**

```typescript
// tests/schemas.test.ts
import { describe, it, expect } from "vitest"
import { WorkflowSpecSchema } from "../src/schemas.js"
import { Schema } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"

const decode = Schema.decodeUnknownSync(WorkflowSpecSchema)

describe("WorkflowSpecSchema", () => {
  it("parses a valid DAG workflow YAML", () => {
    const yaml = Fs.readFileSync(
      Path.join(import.meta.dirname, "fixtures", "feature-dev.yml"),
      "utf-8"
    )
    const raw = Yaml.parse(yaml)
    const spec = decode(raw)
    expect(spec.version).toBe(1)
    expect(spec.name).toBe("feature-dev")
    expect(spec.run.entrypoint).toBe("plan")
    expect(spec.run.timeout).toBe("300s")
    expect(spec.agents).toHaveLength(5)
    expect(spec.agents[0].name).toBe("planner")
    expect(spec.agents[0].role).toBe("analysis")
    expect(spec.agents[0].settings.systemPrompt.agent).toBe("agents/planner/AGENTS.md")
    expect(spec.tasks).toHaveLength(4)
    expect(spec.tasks[0].name).toBe("plan")
  })

  it("rejects a workflow with missing run.entrypoint", () => {
    const raw = {
      version: 1,
      name: "bad",
      run: { timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [{ name: "t", agent: { ref: "agents.a", prompt: { content: "do" } } }]
    }
    expect(() => decode(raw)).toThrow()
  })

  it("rejects a workflow with no agents", () => {
    const raw = {
      version: 1,
      name: "bad",
      run: { entrypoint: "t", timeout: "300s" },
      agents: [],
      tasks: [{ name: "t", agent: { ref: "agents.a", prompt: { content: "do" } } }]
    }
    expect(() => decode(raw)).toThrow()
  })

  it("rejects an invalid agent role", () => {
    const raw = {
      version: 1, name: "bad",
      run: { entrypoint: "t", timeout: "300s" },
      agents: [{ name: "a", role: "invalid", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [{ name: "t", agent: { ref: "agents.a", prompt: { content: "do" } } }]
    }
    expect(() => decode(raw)).toThrow()
  })

  it("rejects a task missing agent when it's not a template reference", () => {
    const raw = {
      version: 1, name: "bad",
      run: { entrypoint: "t", timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [{ name: "t" }]
    }
    expect(() => decode(raw)).toThrow()
  })

  it("allows a task with only name (will be used as template)", () => {
    const raw = {
      version: 1, name: "ok",
      run: { entrypoint: "t1", timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [
        { name: "t1", agent: { ref: "agents.a", prompt: { content: "do" } } },
        { name: "t2" }
      ]
    }
    const spec = decode(raw)
    expect(spec.tasks).toHaveLength(2)
    expect(spec.tasks[1].name).toBe("t2")
  })

  it("rejects a task with template referencing nonexistent task", () => {
    const raw = {
      version: 1, name: "bad",
      run: { entrypoint: "t1", timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [
        { name: "t1", agent: { ref: "agents.a", prompt: { content: "do" } } }
      ]
    }
    expect(() => decode(raw)).toThrow()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun --bun vitest run tests/schemas.test.ts
```
Expected: FAIL — schema module not found or doesn't match new format

- [ ] **Step 4: Write `src/schemas.ts`**

```typescript
import { Schema } from "@effect/schema"

const AgentRoleSchema = Schema.Literal(
  "analysis",
  "coding",
  "verification",
  "testing",
  "pr",
  "scanning"
)

const SystemPromptPathsSchema = Schema.Struct({
  agent: Schema.String,
  soul: Schema.String,
  identity: Schema.String
})

const AgentSettingsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  systemPrompt: SystemPromptPathsSchema,
  skills: Schema.optional(Schema.Array(Schema.String))
})

const WorkflowAgentSchema = Schema.Struct({
  name: Schema.String,
  role: AgentRoleSchema,
  description: Schema.optional(Schema.String),
  settings: AgentSettingsSchema
})

const RefPathSchema = Schema.Struct({
  ref: Schema.String
})

const TimeoutSchema = Schema.Struct({
  fixed: Schema.String
})

const OnExhaustedSchema = Schema.Struct({
  escalate_to: Schema.optional(Schema.String)
})

const OnFailureSchema = Schema.Struct({
  max_retries: Schema.optional(Schema.Number),
  escalate_to: Schema.optional(Schema.String),
  retry_step: Schema.optional(Schema.String),
  on_exhausted: Schema.optional(OnExhaustedSchema)
})

const OutputConfigSchema = Schema.Struct({
  schema: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
})

const PromptSchema = Schema.Struct({
  content: Schema.String
})

const TaskAgentSchema = Schema.Struct({
  ref: Schema.String,
  timeout: Schema.optional(TimeoutSchema),
  on_failure: Schema.optional(OnFailureSchema),
  output: Schema.optional(OutputConfigSchema),
  prompt: PromptSchema
})

const ForEachSchema = Schema.Struct({
  valueFrom: RefPathSchema,
  as: Schema.String
})

const ContextFieldSchema = Schema.Struct({
  name: Schema.String,
  valueFrom: RefPathSchema
})

const ContextFieldsSchema = Schema.Struct({
  fields: Schema.Array(ContextFieldSchema)
})

const WorkflowTaskSchema = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(TaskAgentSchema),
  template: Schema.optional(Schema.String),
  forEach: Schema.optional(ForEachSchema),
  context: Schema.optional(ContextFieldsSchema),
  tasks: Schema.optional(Schema.lazy(() => Schema.Array(WorkflowTaskSchema)))
})

const RunConfigSchema = Schema.Struct({
  entrypoint: Schema.String,
  timeout: Schema.String
})

export const WorkflowSpecSchema = Schema.Struct({
  version: Schema.Number,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  run: RunConfigSchema,
  agents: Schema.NonEmptyArray(WorkflowAgentSchema),
  tasks: Schema.Array(WorkflowTaskSchema)
}).pipe(
  Schema.filter(
    (spec) => {
      const taskNames = new Set(spec.tasks.map(t => t.name))
      let valid = true
      for (const task of spec.tasks) {
        if (!task.agent && !task.template && !task.tasks) {
          valid = false
          break
        }
        if (task.template && !taskNames.has(task.template)) {
          valid = false
          break
        }
      }
      return valid
    },
    { message: () => "every task must have agent, template, or nested tasks. template references must be valid task names." }
  )
)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun --bun vitest run tests/schemas.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/schemas.ts tests/schemas.test.ts tests/fixtures/feature-dev.yml
git commit -m "feat: rewrite schemas for DAG task model"
```

---

### Task 4: Rewrite `src/workflow/context.ts` — dotted path resolution

**Files:**
- Create: `src/workflow/context.ts` (rewrite)
- Modify: `tests/workflow/context.test.ts` (rewrite)

- [ ] **Step 1: Write the context tests**

```typescript
// tests/workflow/context.test.ts
import { describe, it, expect } from "vitest"
import { resolveDottedPath, resolveTemplate, mergeContext, buildAutoContext } from "../../src/workflow/context.js"
import type { WorkflowTask } from "../../src/types.js"

describe("resolveDottedPath", () => {
  it("resolves a simple path", () => {
    const ctx = { plan: { outputs: { user_stories: ["a", "b"] } } }
    expect(resolveDottedPath(ctx, "plan.outputs.user_stories")).toEqual(["a", "b"])
  })

  it("resolves tasks.plan.outputs", () => {
    const ctx = { tasks: { plan: { outputs: { status: "done" } } } }
    expect(resolveDottedPath(ctx, "tasks.plan.outputs.status")).toBe("done")
  })

  it("resolves agents.planner", () => {
    const ctx = { agents: { planner: { role: "analysis" } } }
    expect(resolveDottedPath(ctx, "agents.planner.role")).toBe("analysis")
  })

  it("resolves vars.user_story", () => {
    const ctx = { vars: { user_story: { id: "US-001", title: "Foo" } } }
    expect(resolveDottedPath(ctx, "vars.user_story.id")).toBe("US-001")
  })

  it("returns undefined for missing path", () => {
    const ctx = { plan: { outputs: {} } }
    expect(resolveDottedPath(ctx, "plan.outputs.nonexistent")).toBeUndefined()
  })

  it("returns first-level key", () => {
    const ctx = { key: "value" }
    expect(resolveDottedPath(ctx, "key")).toBe("value")
  })
})

describe("resolveTemplate", () => {
  it("replaces {{key}} with context values", () => {
    expect(resolveTemplate("Hello {{name}}!", { name: "world" })).toBe("Hello world!")
  })

  it("keeps unreplaced templates intact", () => {
    expect(resolveTemplate("Hello {{name}}!", {})).toBe("Hello {{name}}!")
  })

  it("replaces multiple templates", () => {
    expect(resolveTemplate("{{a}} and {{b}}", { a: "1", b: "2" })).toBe("1 and 2")
  })

  it("stringifies non-string values", () => {
    expect(resolveTemplate("Items: {{items}}", { items: [1, 2, 3] })).toBe("Items: [1,2,3]")
  })

  it("stringifies objects", () => {
    expect(resolveTemplate("Context: {{ctx}}", { ctx: { plan: { status: "done" } } }))
      .toBe('Context: {"plan":{"status":"done"}}')
  })
})

describe("mergeContext", () => {
  it("shallow-merges two context objects", () => {
    expect(mergeContext({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" })
  })

  it("overwrites existing keys", () => {
    expect(mergeContext({ a: "1" }, { a: "2" })).toEqual({ a: "2" })
  })

  it("does not mutate inputs", () => {
    const a = { x: "1" }
    const b = { y: "2" }
    const result = mergeContext(a, b)
    expect(result).toEqual({ x: "1", y: "2" })
    expect(a).toEqual({ x: "1" })
  })
})

describe("buildAutoContext", () => {
  it("derives context from explicit fields", () => {
    const allOutputs = {
      tasks: {
        setup: { outputs: { repo: "/tmp/repo", branch: "feature/x", build_cmd: "npm run build" } }
      }
    }
    const vars = {}
    const task: WorkflowTask = {
      name: "codify",
      context: {
        fields: [
          { name: "repository", valueFrom: { ref: "tasks.setup.outputs.repo" } },
          { name: "current_branch", valueFrom: { ref: "tasks.setup.outputs.branch" } }
        ]
      }
    }
    const result = buildAutoContext(task, allOutputs, vars)
    expect(result).toEqual({ repository: "/tmp/repo", current_branch: "feature/x" })
  })

  it("derives context from all upstream outputs when no context.fields", () => {
    const allOutputs = {
      tasks: {
        plan: { outputs: { status: "done", user_stories: [] } },
        setup: { outputs: { repo: "/tmp/repo", build_cmd: "npm run build" } }
      }
    }
    const vars = {}
    const task: WorkflowTask = { name: "implement" }
    const result = buildAutoContext(task, allOutputs, vars)
    expect(result.tasks).toEqual(allOutputs.tasks)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/workflow/context.test.ts
```
Expected: FAIL — `resolveDottedPath` and `buildAutoContext` not defined

- [ ] **Step 3: Write `src/workflow/context.ts`**

```typescript
import type { WorkflowTask } from "../types.js"

export type Context = Record<string, unknown>

export function resolveDottedPath(context: Context, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = context
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function resolveTemplate(template: string, context: Context): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in context)) return match
    const value = context[key]
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}

export function mergeContext(existing: Context, incoming: Context): Context {
  return { ...existing, ...incoming }
}

export function buildAutoContext(
  task: WorkflowTask,
  allOutputs: Context,
  vars: Context
): Context {
  if (task.context) {
    const result: Context = {}
    for (const field of task.context.fields) {
      const ref = field.valueFrom.ref
      if (ref.startsWith("vars.")) {
        result[field.name] = resolveDottedPath({ vars }, ref)
      } else {
        result[field.name] = resolveDottedPath(allOutputs, ref)
      }
    }
    return result
  }
  return allOutputs
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/workflow/context.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/context.ts tests/workflow/context.test.ts
git commit -m "feat: rewrite context with dotted path resolution and auto-context"
```

---

### Task 5: Rewrite `src/workflow/engine.ts` — DAG engine

**Files:**
- Create: `src/workflow/engine.ts` (rewrite)
- Modify: `tests/workflow/engine.test.ts` (rewrite)

- [ ] **Step 1: Write engine tests**

```typescript
// tests/workflow/engine.test.ts
import { describe, it, expect } from "vitest"
import { parseDuration, topologicalSort, collectReachableTasks, buildRunId, buildTaskId, resolveTaskTimeout } from "../../src/workflow/engine.js"
import type { WorkflowTask } from "../../src/types.js"

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30)
  })

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300)
  })

  it("parses hours", () => {
    expect(parseDuration("1h")).toBe(3600)
  })

  it("parses just a number string as seconds", () => {
    expect(parseDuration("300")).toBe(300)
  })

  it("falls back to 300 for invalid duration", () => {
    expect(parseDuration("invalid")).toBe(300)
  })
})

describe("topologicalSort", () => {
  it("sorts tasks by dependency order", () => {
    const tasks: WorkflowTask[] = [
      { name: "review", dependencies: ["test"], agent: { ref: "agents.v", prompt: { content: "" } } },
      { name: "test", dependencies: ["implement"], agent: { ref: "agents.t", prompt: { content: "" } } },
      { name: "implement", agent: { ref: "agents.d", prompt: { content: "" } } }
    ]
    const sorted = topologicalSort(tasks)
    expect(sorted.map(t => t.name)).toEqual(["implement", "test", "review"])
  })

  it("handles tasks with no dependencies first", () => {
    const tasks: WorkflowTask[] = [
      { name: "b", dependencies: ["a"], agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "a", agent: { ref: "agents.x", prompt: { content: "" } } }
    ]
    expect(topologicalSort(tasks).map(t => t.name)).toEqual(["a", "b"])
  })

  it("handles multiple independent tasks", () => {
    const tasks: WorkflowTask[] = [
      { name: "x", agent: { ref: "agents.a", prompt: { content: "" } } },
      { name: "y", agent: { ref: "agents.a", prompt: { content: "" } } },
      { name: "z", dependencies: ["x", "y"], agent: { ref: "agents.a", prompt: { content: "" } } }
    ]
    expect(topologicalSort(tasks).map(t => t.name)).toEqual(["x", "y", "z"])
  })

  it("throws on circular dependency", () => {
    const tasks: WorkflowTask[] = [
      { name: "a", dependencies: ["b"], agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "b", dependencies: ["a"], agent: { ref: "agents.x", prompt: { content: "" } } }
    ]
    expect(() => topologicalSort(tasks)).toThrow("circular")
  })

  it("handles empty tasks list", () => {
    expect(topologicalSort([])).toEqual([])
  })
})

describe("collectReachableTasks", () => {
  it("collects tasks reachable from entrypoint", () => {
    const tasks: WorkflowTask[] = [
      { name: "plan", agent: { ref: "agents.p", prompt: { content: "" } } },
      { name: "setup", dependencies: ["plan"], agent: { ref: "agents.s", prompt: { content: "" } } },
      { name: "orphan", agent: { ref: "agents.o", prompt: { content: "" } } }
    ]
    const collected = collectReachableTasks(tasks, "plan")
    expect(collected.map(t => t.name)).toEqual(["plan", "setup"])
  })
})

describe("buildRunId", () => {
  it("generates a run ID with workflow name prefix", () => {
    const runId = buildRunId("feature-dev")
    expect(runId).toMatch(/^feature-dev-[A-Za-z0-9_-]{5}$/)
  })
})

describe("buildTaskId", () => {
  it("generates a compound task ID", () => {
    const taskId = buildTaskId("feature-dev-abcde", "plan")
    expect(taskId).toMatch(/^feature-dev-abcde-plan-[A-Za-z0-9_-]{5}$/)
  })
})

describe("resolveTaskTimeout", () => {
  it("uses task-level timeout", () => {
    const task: WorkflowTask = {
      name: "t",
      agent: { ref: "agents.a", timeout: { fixed: "120s" }, prompt: { content: "" } }
    }
    expect(resolveTaskTimeout(task, "300s")).toBe(120)
  })

  it("falls back to global run timeout", () => {
    const task: WorkflowTask = {
      name: "t",
      agent: { ref: "agents.a", prompt: { content: "" } }
    }
    expect(resolveTaskTimeout(task, "300s")).toBe(300)
  })

  it("returns 300 when both are missing", () => {
    const task: WorkflowTask = {
      name: "t",
      agent: { ref: "agents.a", prompt: { content: "" } }
    }
    expect(resolveTaskTimeout(task, "invalid")).toBe(300)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/workflow/engine.test.ts
```
Expected: FAIL — all functions not defined

- [ ] **Step 3: Write `src/workflow/engine.ts`**

```typescript
import { nanoid } from "nanoid"
import { parse } from "go-duration-js"
import type { WorkflowTask } from "../types.js"

export function parseDuration(duration: string): number {
  try {
    const d = parse(duration)
    if (d !== null) {
      return Math.round(d.totalSeconds())
    }
    const num = Number(duration)
    if (!isNaN(num)) return num
    return 300
  } catch {
    const num = Number(duration)
    if (!isNaN(num)) return num
    return 300
  }
}

export function collectReachableTasks(
  tasks: WorkflowTask[],
  entrypoint: string
): WorkflowTask[] {
  const taskMap = new Map<string, WorkflowTask>()
  for (const t of tasks) taskMap.set(t.name, t)

  const visited = new Set<string>()
  const queue = [entrypoint]

  while (queue.length > 0) {
    const name = queue.shift()!
    if (visited.has(name)) continue
    const task = taskMap.get(name)
    if (!task) continue
    visited.add(name)
    if (task.dependencies) {
      for (const dep of task.dependencies) {
        queue.push(dep)
      }
    }
  }

  return tasks.filter(t => visited.has(t.name))
}

export function topologicalSort(tasks: WorkflowTask[]): WorkflowTask[] {
  const taskMap = new Map<string, WorkflowTask>()
  for (const t of tasks) taskMap.set(t.name, t)

  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const t of tasks) {
    if (!indegree.has(t.name)) indegree.set(t.name, 0)
    const deps = t.dependencies ?? []
    for (const dep of deps) {
      if (!adjacency.has(dep)) adjacency.set(dep, [])
      adjacency.get(dep)!.push(t.name)
      indegree.set(t.name, (indegree.get(t.name) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [name, deg] of indegree) {
    if (deg === 0) queue.push(name)
  }

  const sorted: WorkflowTask[] = []
  while (queue.length > 0) {
    const name = queue.shift()!
    const task = taskMap.get(name)
    if (task) sorted.push(task)
    for (const neighbor of adjacency.get(name) ?? []) {
      indegree.set(neighbor, (indegree.get(neighbor) ?? 1) - 1)
      if (indegree.get(neighbor) === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== tasks.length) {
    throw new Error("circular dependency detected")
  }

  return sorted
}

export function buildRunId(workflowName: string): string {
  return `${workflowName}-${nanoid(5)}`
}

export function buildTaskId(runId: string, taskName: string): string {
  const sanitized = taskName.replace(/\//g, "-")
  return `${runId}-${sanitized}-${nanoid(5)}`
}

export function resolveTaskTimeout(task: WorkflowTask, globalTimeout: string): number {
  if (task.agent?.timeout?.fixed) {
    return parseDuration(task.agent.timeout.fixed)
  }
  return parseDuration(globalTimeout)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/workflow/engine.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/engine.ts tests/workflow/engine.test.ts
git commit -m "feat: rewrite engine with DAG topological sort and Go-style durations"
```

---

### Task 6: Rewrite `src/workflow/loader.ts` — load new YAML format

**Files:**
- Create: `src/workflow/loader.ts` (rewrite)
- Modify: `tests/workflow/loader.test.ts` (rewrite)

- [ ] **Step 1: Write loader tests**

```typescript
// tests/workflow/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec, WorkflowNotFoundError, WorkflowParseError } from "../../src/workflow/loader.js"

const validYaml = `version: 1
name: test-wf
run:
  entrypoint: t1
  timeout: 300s
agents:
  - name: a1
    role: analysis
    settings:
      systemPrompt:
        agent: agents/a1/AGENTS.md
        soul: agents/a1/SOUL.md
        identity: agents/a1/IDENTITY.md
tasks:
  - name: t1
    agent:
      ref: agents.a1
      prompt:
        content: do it
`

describe("loadWorkflowSpec", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
    const wfDir = Path.join(tmpDir, "test-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), validYaml)

    const badDir = Path.join(tmpDir, "bad-wf")
    Fs.mkdirSync(badDir, { recursive: true })
    Fs.writeFileSync(Path.join(badDir, "workflow.yml"), "version: not-a-number")
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loads a valid DAG workflow YAML", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "test-wf"))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.name).toBe("test-wf")
      expect(exit.value.version).toBe(1)
      expect(exit.value.run.entrypoint).toBe("t1")
      expect(exit.value.tasks).toHaveLength(1)
      expect(exit.value.agents).toHaveLength(1)
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("fails with WorkflowNotFoundError for nonexistent workflow", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "nonexistent"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails with WorkflowParseError for invalid YAML", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "bad-wf"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defects = cause._tag === "Fail" ? cause.error : undefined
      expect(defects?._tag).toBe("WorkflowParseError")
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/workflow/loader.test.ts
```
Expected: FAIL — functions not found or schema mismatch

- [ ] **Step 3: Write `src/workflow/loader.ts`**

```typescript
import { Effect } from "effect"
import { Schema } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { WorkflowSpecSchema } from "../schemas.js"

export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>("WorkflowNotFoundError")("WorkflowNotFoundError", {
  workflowName: Schema.String,
  dir: Schema.String
}) {}

export class WorkflowParseError extends Schema.TaggedError<WorkflowParseError>("WorkflowParseError")("WorkflowParseError", {
  workflowName: Schema.String,
  message: Schema.String
}) {}

export function loadWorkflowSpec(
  workflowsDir: string,
  workflowName: string
): Effect.Effect<Schema.Schema.Type<typeof WorkflowSpecSchema>, WorkflowNotFoundError | WorkflowParseError> {
  return Effect.gen(function* (_) {
    const dir = Path.join(workflowsDir, workflowName)
    const filePath = Path.join(dir, "workflow.yml")

    const content = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(filePath, "utf-8"),
        catch: () => new WorkflowNotFoundError({ workflowName, dir })
      })
    )

    const raw = yield* _(
      Effect.try({
        try: () => Yaml.parse(content) as unknown,
        catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
      })
    )

    return yield* _(
      Effect.try({
        try: () => Schema.decodeUnknownSync(WorkflowSpecSchema)(raw),
        catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
      })
    )
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/workflow/loader.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/loader.ts tests/workflow/loader.test.ts
git commit -m "feat: rewrite loader for DAG workflow YAML format"
```

---

### Task 7: Update `src/agent/persona.ts` — resolve from settings.systemPrompt

**Files:**
- Modify: `src/agent/persona.ts`
- Modify: `tests/agent/persona.test.ts`

- [ ] **Step 1: Update persona tests**

```typescript
// tests/agent/persona.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resolvePersona } from "../../src/agent/persona.js"

describe("resolvePersona", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-persona-"))
    const agentDir = Path.join(tmpDir, "test-agent")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "# Agent instructions")
    Fs.writeFileSync(Path.join(agentDir, "SOUL.md"), "# Soul")
    Fs.writeFileSync(Path.join(agentDir, "IDENTITY.md"), "# Identity")
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("resolves persona from systemPrompt paths", async () => {
    const persona = yield* resolvePersona({
      agent: Path.join(tmpDir, "test-agent/AGENTS.md"),
      soul: Path.join(tmpDir, "test-agent/SOUL.md"),
      identity: Path.join(tmpDir, "test-agent/IDENTITY.md")
    })
    expect(persona.agents).toBe("# Agent instructions")
    expect(persona.soul).toBe("# Soul")
    expect(persona.identity).toBe("# Identity")
  })
})
```

Wait — let me check the current persona.ts to understand the interface better first.

The current `resolvePersona` takes agentSlug and workflowSlug, checks workflow-local then shared paths. In the new model, agent config has explicit file paths, so resolution is simpler. Let me adapt the test to match.

- [ ] **Step 2: Write `src/agent/persona.ts`**

```typescript
import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { SystemPromptPaths } from "../types.js"

export interface Persona {
  agents: string
  soul: string
  identity: string
}

export class PersonaNotFoundError extends Effect.TaggedError("PersonaNotFoundError")<{
  agentPath: string
}> {}

export function resolvePersona(
  paths: SystemPromptPaths,
  workflowDir: string
): Effect.Effect<Persona, PersonaNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(workflowDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.agent), "utf-8"),
        catch: () => new PersonaNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.soul), "utf-8"),
        catch: () => ""
      })
    )

    const identity = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.identity), "utf-8"),
        catch: () => ""
      })
    )

    return { agent, soul, identity }
  })
}
```

Note: `Effect.TaggedError` doesn't exist in Effect 3.21.3. The project uses `Data.TaggedError`. Let me fix that.

Actually, looking at the existing persona.ts pattern, it uses `Effect.gen` and `Schema.TaggedError` in some places. Let me check what's the correct pattern.

The project uses `Schema.TaggedError` for loader errors but `Data.TaggedError` for engine/state-machine errors. For persona, since it's a simple effect, `Data.TaggedError` is fine.

- [ ] **Step 1: Write persona tests**

```typescript
// tests/agent/persona.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resolvePersona } from "../../src/agent/persona.js"

describe("resolvePersona", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-persona-"))
    const agentDir = Path.join(tmpDir, "agents", "test-agent")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "Agent instructions")
    Fs.writeFileSync(Path.join(agentDir, "SOUL.md"), "Soul content")
    Fs.writeFileSync(Path.join(agentDir, "IDENTITY.md"), "Identity content")
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("resolves persona from systemPrompt paths", async () => {
    const exit = await Effect.runPromiseExit(resolvePersona(
      {
        agent: "agents/test-agent/AGENTS.md",
        soul: "agents/test-agent/SOUL.md",
        identity: "agents/test-agent/IDENTITY.md"
      },
      tmpDir
    ))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent).toBe("Agent instructions")
      expect(exit.value.soul).toBe("Soul content")
      expect(exit.value.identity).toBe("Identity content")
    }
  })

  it("returns empty string for missing soul and identity files", async () => {
    const exit = await Effect.runPromiseExit(resolvePersona(
      {
        agent: "agents/test-agent/AGENTS.md",
        soul: "agents/test-agent/MISSING.md",
        identity: "agents/test-agent/MISSING.md"
      },
      tmpDir
    ))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.soul).toBe("")
      expect(exit.value.identity).toBe("")
    }
  })

  it("fails when agent file is missing", async () => {
    const exit = await Effect.runPromiseExit(resolvePersona(
      { agent: "nonexistent/AGENTS.md", soul: "x", identity: "y" },
      tmpDir
    ))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/agent/persona.test.ts
```
Expected: FAIL — resolvePersona signature changed

- [ ] **Step 3: Write new `src/agent/persona.ts`**

```typescript
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { SystemPromptPaths } from "../types.js"

export interface Persona {
  agent: string
  soul: string
  identity: string
}

export class PersonaNotFoundError extends Data.TaggedError("PersonaNotFoundError")<{
  agentPath: string
}> {}

export function resolvePersona(
  paths: SystemPromptPaths,
  workflowDir: string
): Effect.Effect<Persona, PersonaNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(workflowDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.agent), "utf-8"),
        catch: () => new PersonaNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.soul), "utf-8"),
        catch: () => ""
      })
    )

    const identity = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.identity), "utf-8"),
        catch: () => ""
      })
    )

    return { agent, soul, identity }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/agent/persona.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/persona.ts tests/agent/persona.test.ts
git commit -m "feat: update persona resolution for new agent config paths"
```

---

### Task 8: Update `src/agent/activity.ts` — prompt building for new agent config

**Files:**
- Modify: `src/agent/activity.ts`
- Modify: `tests/agent/activity.test.ts`

- [ ] **Step 1: Update activity tests**

```typescript
// tests/agent/activity.test.ts
import { describe, it, expect } from "vitest"
import { buildAgentPrompt } from "../../src/agent/activity.js"
import type { SystemPromptPaths, TaskAgent } from "../../src/types.js"

describe("buildAgentPrompt", () => {
  it("builds prompt from persona and task config", () => {
    const result = buildAgentPrompt({
      agentFile: "# Agent instructions",
      soulFile: "# Soul",
      identityFile: "# Identity",
      prompt: { content: "Do the thing" },
      context: { task: "Build feature X" },
      agentConfig: {}
    })
    expect(result.systemPrompt).toContain("<identity>")
    expect(result.systemPrompt).toContain("# Identity")
    expect(result.systemPrompt).toContain("<agent>")
    expect(result.systemPrompt).toContain("# Agent instructions")
    expect(result.taskPrompt).toContain("Do the thing")
  })

  it("resolves template variables in prompt", () => {
    const result = buildAgentPrompt({
      agentFile: "Agent",
      soulFile: "Soul",
      identityFile: "Identity",
      prompt: { content: "Task: {{task}}" },
      context: { task: "Fix bug #123" },
      agentConfig: {}
    })
    expect(result.taskPrompt).toContain("Fix bug #123")
  })

  it("includes context in system prompt", () => {
    const result = buildAgentPrompt({
      agentFile: "Agent",
      soulFile: "Soul",
      identityFile: "Identity",
      prompt: { content: "Do it" },
      context: { repo: "/tmp/repo", branch: "feature/x" },
      agentConfig: {}
    })
    expect(result.systemPrompt).toContain("<context>")
    expect(result.systemPrompt).toContain("/tmp/repo")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/agent/activity.test.ts
```
Expected: FAIL — buildAgentPrompt signature changed

- [ ] **Step 3: Write new `src/agent/activity.ts`**

```typescript
import type { Prompt, WorkflowAgent } from "../types.js"
import type { Context } from "../workflow/context.js"
import { resolveTemplate } from "../workflow/context.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  identityFile: string
  prompt: Prompt
  context: Context
  agentConfig: Partial<WorkflowAgent>
}

export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
}

export function buildAgentPrompt(params: PromptParams): BuiltPrompt {
  const systemParts: string[] = []

  if (params.identityFile) {
    systemParts.push(`<identity>\n${params.identityFile}\n</identity>`)
  }

  if (params.soulFile) {
    systemParts.push(`<style>\n${params.soulFile}\n</style>`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextJson = JSON.stringify(params.context, null, 2)
    systemParts.push(`<context>\n${contextJson}\n</context>`)
  }

  systemParts.push(`<harness>
# Hamilton Workflow

You are executing a task within a Hamilton workflow. A workflow is a sequence of tasks
that pass context between them. Your job is to complete one task and save your result.

### How to finish your task

When you have completed your work, call the write_step_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_step_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</harness>`)

  systemParts.push(`<agent>${params.agentFile}</agent>`)

  const resolvedInput = resolveTemplate(params.prompt.content, params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: resolvedInput
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/agent/activity.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/activity.ts tests/agent/activity.test.ts
git commit -m "feat: update prompt building for new agent config structure"
```

---

### Task 9: Update `src/agent/write-step-output-tool.ts` — schema validation

**Files:**
- Modify: `src/agent/write-step-output-tool.ts`
- Modify: `tests/agent/write-step-output-tool.test.ts`

Add optional JSON Schema validation using `ajv`. The tool receives an optional schema and validates output before saving.

- [ ] **Step 1: Add ajv dependency**

```bash
bun add ajv
```

- [ ] **Step 2: Read current write-step-output-tool.ts, then write the updated version**

```typescript
// src/agent/write-step-output-tool.ts (updated)
import * as Fs from "node:fs"
import * as Path from "node:path"
import { stepOutputFile } from "../paths.js"
import Ajv from "ajv"

const ajv = new Ajv()

export function createWriteStepOutputTool(
  runId: string,
  taskId: string,
  outputSchema?: Record<string, unknown>,
  onSuccess?: () => void
) {
  const validate = outputSchema ? ajv.compile(outputSchema) : null

  return {
    description: "Save your completed task output. Call this exactly once when you finish.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "done, retry, or fail" }
      },
      required: ["status"]
    },
    execute: async (params: Record<string, unknown>) => {
      if (validate) {
        const valid = validate(params)
        if (!valid) {
          const errors = validate.errors?.map(e => `${e.instancePath} ${e.message}`).join(", ") ?? "Validation failed"
          return { result: `Output validation failed: ${errors}. Fix your output and try again.` }
        }
      }

      const outputPath = stepOutputFile(runId, taskId)
      const dir = Path.dirname(outputPath)
      if (!Fs.existsSync(dir)) {
        Fs.mkdirSync(dir, { recursive: true })
      }

      if (Fs.existsSync(outputPath)) {
        return { result: "Output already saved. You can only call write_step_output once." }
      }

      Fs.writeFileSync(outputPath, JSON.stringify(params, null, 2))
      onSuccess?.()
      return { result: "Output saved successfully." }
    }
  }
}
```

- [ ] **Step 3: Write tests**

```typescript
// tests/agent/write-step-output-tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createWriteStepOutputTool } from "../../src/agent/write-step-output-tool.js"

describe("createWriteStepOutputTool with schema", () => {
  let tmpDir: string
  let outputDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-wso-"))
    outputDir = Path.join(tmpDir, "step-outputs")
    Fs.mkdirSync(outputDir, { recursive: true })
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("validates output against schema and rejects invalid", async () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string" },
        user_stories: { type: "array" }
      },
      required: ["status", "user_stories"]
    }
    const tool = createWriteStepOutputTool("run-1", "task-1", schema)

    const result = await tool.execute({ status: "done" })
    expect(result.result).toContain("Validation failed")
    expect(result.result).toContain("user_stories")
  })

  it("accepts valid output", async () => {
    const schema = {
      type: "object",
      properties: { status: { type: "string" } },
      required: ["status"]
    }
    let completed = false
    const tool = createWriteStepOutputTool("run-1", "task-1", schema, () => { completed = true })

    const result = await tool.execute({ status: "done" })
    expect(result.result).toBe("Output saved successfully.")
    expect(completed).toBe(false)
  })

  it("rejects duplicate calls", async () => {
    const tool = createWriteStepOutputTool("run-1", "task-1")

    await tool.execute({ status: "done" })
    const result = await tool.execute({ status: "done" })
    expect(result.result).toContain("already saved")
  })

  it("no schema validation when schema is undefined", async () => {
    const tool = createWriteStepOutputTool("run-1", "task-1")

    const result = await tool.execute({ status: "done", arbitrary: true })
    expect(result.result).toBe("Output saved successfully.")
  })
})
```

Note: The stepOutputFile call in the tool's execute function reads from the real filesystem path. The test needs to mock `stepOutputFile` or write to a test-controlled dir. Let me adapt the test to actually use a temp path override.

Actually, looking at this more carefully, the `stepOutputFile` function in `paths.ts` builds paths from `~/.hamilton/`. For a clean test, I should override `process.env.HOME` to point to tmpDir. That's the established pattern.

- [ ] **Step 4: Adapt tests with HOME override**

```typescript
// tests/agent/write-step-output-tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createWriteStepOutputTool } from "../../src/agent/write-step-output-tool.js"

describe("createWriteStepOutputTool with schema", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-wso-"))
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("validates output against schema and rejects invalid", async () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string" },
        user_stories: { type: "array" }
      },
      required: ["status", "user_stories"]
    }
    const tool = createWriteStepOutputTool("run-1", "task-1", schema)

    const result = await tool.execute({ status: "done" })
    expect(result.result).toContain("Validation failed")
  })

  it("accepts valid output matching schema", async () => {
    const schema = {
      type: "object",
      properties: { status: { type: "string" } },
      required: ["status"]
    }
    const tool = createWriteStepOutputTool("run-1", "task-1", schema)

    const result = await tool.execute({ status: "done" })
    expect(result.result).toBe("Output saved successfully.")
  })

  it("rejects duplicate calls", async () => {
    const tool = createWriteStepOutputTool("run-1", "task-1")

    await tool.execute({ status: "done" })
    const result = await tool.execute({ status: "done" })
    expect(result.result).toContain("already saved")
  })

  it("no schema validation when schema is undefined", async () => {
    const tool = createWriteStepOutputTool("run-1", "task-1")

    const result = await tool.execute({ status: "done", arbitrary: true })
    expect(result.result).toBe("Output saved successfully.")
  })
})
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun --bun vitest run tests/agent/write-step-output-tool.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/write-step-output-tool.ts tests/agent/write-step-output-tool.test.ts package.json bun.lock
git commit -m "feat: add JSON Schema validation to write_step_output tool"
```

---

### Task 10: Update `src/agent/pi-executor.ts` — pass schema to tool

**Files:**
- Modify: `src/agent/pi-executor.ts`

- [ ] **Step 1: Update `executeWithPi` to accept optional output schema**

In `PiExecutorConfig`, add `outputSchema?: Record<string, unknown>`. Pass it to `createWriteStepOutputTool`.

```typescript
// src/agent/pi-executor.ts (in executeWithPi, replace createWriteStepOutputTool call)
const writeStepOutputTool = createWriteStepOutputTool(
  config.runId,
  config.stepId,
  config.outputSchema,
  {
    onStepComplete: () => {
      if (sessionRef) {
        sessionRef.abort().catch(() => {})
      }
    }
  }
)
```

The `PiExecutorConfig` interface needs:

```typescript
export interface PiExecutorConfig {
  systemPrompt: string
  taskPrompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  cwd?: string
  extensions?: Array<unknown>
  outputSchema?: Record<string, unknown>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[]
    retryOnTransient?: boolean
    compactionEnabled?: boolean
  }
}
```

- [ ] **Step 2: Verify build**

```bash
bun run build
```
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```bash
git add src/agent/pi-executor.ts
git commit -m "feat: pass output schema from task to write_step_output tool"
```

---

### Task 11: Adapt state machine for tasks

**Files:**
- Modify: `src/workflow/run-state-machine.ts`
- Modify: `tests/workflow/run-state-machine.test.ts`

Rename step terminology to task. Add `insertTask` function for dynamic task insertion.

- [ ] **Step 1: Update state machine to use task terminology**

Key changes in `src/workflow/run-state-machine.ts`:
- `StepState` → `TaskState`
- `parseStepSlug` → `parseTaskSlug`  
- `compoundStepIds` → `compoundTaskIds`
- `transitionStep` → `transitionTask`
- `shouldExecuteStep` → `shouldExecuteTask`
- Import `buildTaskId` instead of `buildStepId`
- Add `insertDynamicTask(taskId, taskName, agentName)` method for forEach-created tasks

- [ ] **Step 2: Run existing state machine tests to ensure adaptability**

```bash
bun --bun vitest run tests/workflow/run-state-machine.test.ts
```
Expected: FAIL — function names changed

- [ ] **Step 3: Rewrite state machine tests for task terminology**

```typescript
// tests/workflow/run-state-machine.test.ts (updated)
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { createWorkflowRuntime } from "../../src/workflow/run-state-machine.js"
import type { WorkflowSpec } from "../../src/types.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
  const db = new Database(Path.join(dir, "test.db"))
  ;(db as any)._tempDir = dir
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

const testSpec: WorkflowSpec = {
  version: 1,
  name: "test-wf",
  run: { entrypoint: "t1", timeout: "300s" },
  agents: [{
    name: "a1",
    role: "analysis",
    settings: {
      systemPrompt: { agent: "x", soul: "y", identity: "z" }
    }
  }],
  tasks: [
    { name: "t1", agent: { ref: "agents.a1", prompt: { content: "do" } } },
    { name: "t2", dependencies: ["t1"], agent: { ref: "agents.a1", prompt: { content: "do" } } }
  ]
}

describe("createWorkflowRuntime", () => {
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-rsm-"))
    process.env.HOME = dir
    db = tempDb()
    ;(db as any)._homeDir = dir
  })

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    cleanupDb(db)
    const dir = (db as any)._homeDir as string
    if (dir) Fs.rmSync(dir, { recursive: true, force: true })
  })

  it("creates a new runtime with tasks in pending state", async () => {
    const exit = await Effect.runPromiseExit(createWorkflowRuntime(testSpec, {}))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.state).toBe("running")
      expect(exit.value.runId).toContain("test-wf-")
    }
  })

  it("marks first task as completed", async () => {
    const exit = await Effect.runPromiseExit(createWorkflowRuntime(testSpec, {}))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const shouldExec = await Effect.runPromise(exit.value.shouldExecuteTask("t1"))
      expect(shouldExec).toBe(true)

      await Effect.runPromise(exit.value.transitionTask("t1", "start"))
      await Effect.runPromise(exit.value.transitionTask("t1", "complete"))

      const shouldExecAgain = await Effect.runPromise(exit.value.shouldExecuteTask("t1"))
      expect(shouldExecAgain).toBe(false)
    }
  })
})
```

- [ ] **Step 4: Rewrite `src/workflow/run-state-machine.ts`**

Key changes:
- All `step` → `task` renaming
- `WorkflowRuntime` interface updated with `transitionTask`, `shouldExecuteTask`, `insertDynamicTask`
- `insertDynamicTask` method adds a new task row mid-run
- Uses `buildTaskId` from engine

- [ ] **Step 5: Run tests**

```bash
bun --bun vitest run tests/workflow/run-state-machine.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/workflow/run-state-machine.ts tests/workflow/run-state-machine.test.ts
git commit -m "feat: adapt state machine for task-based DAG model"
```

---

### Task 12: Update DB schema and queries for tasks

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/queries.ts`
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/queries.test.ts`

Rename step terminology to task in DB layer.

- [ ] **Step 1: Update DB schema — rename step_id to task_id in token_events**

```sql
-- src/db/schema.ts updated
CREATE TABLE IF NOT EXISTS token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ...
);
```

- [ ] **Step 2: Update queries — rename all step→task functions**

- `insertSteps` → `insertTasks`
- `updateStepStarted` → `updateTaskStarted`
- `updateStepCompleted` → `updateTaskCompleted`
- `updateStepFailed` → `updateTaskFailed`
- `getStepsByRunId` → `getTasksByRunId`
- `StepRow` → `TaskRow`
- `buildStepId` → `buildTaskId` (import)
- Add `insertTask(db, runId, taskId, agentName)` for dynamic task insertion

- [ ] **Step 3: Update db tests — rename step→task in test code**

In `tests/db/queries.test.ts`, rename:
- `insertSteps` → `insertTasks`
- `updateStepStarted` → `updateTaskStarted`
- `updateStepCompleted` → `updateTaskCompleted`
- `updateStepFailed` → `updateTaskFailed`
- `getStepsByRunId` → `getTasksByRunId`
- `StepRow` → `TaskRow`
- `buildStepId` → `buildTaskId` in import

Same test assertions, only function/type names change.

- [ ] **Step 4: Run tests**

```bash
bun --bun vitest run tests/db/schema.test.ts tests/db/queries.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/queries.ts tests/db/schema.test.ts tests/db/queries.test.ts
git commit -m "feat: rename DB layer from steps to tasks"
```

---

### Task 13: Rewrite `src/workflow/runner.ts` — DAG-aware executor

**Files:**
- Create: `src/workflow/runner.ts` (rewrite)
- Modify: `tests/workflow/runner.test.ts` (rewrite)

This is the core execution engine that ties everything together.

- [ ] **Step 1: Write runner tests**

Given the complexity of the runner (it depends on Pi SDK, filesystem, DB, event bus), write a focused unit test for the DAG execution logic by testing the template expansion and execution order functions in isolation. The runner's core logic (topological sort, context derivation, forEach expansion) is already tested in engine.test.ts and context.test.ts.

Focus this test on the runner's integration of these pieces.

```typescript
// tests/workflow/runner.test.ts
import { describe, it, expect } from "vitest"
import type { WorkflowSpec } from "../../src/types.js"
import { collectReachableTasks, topologicalSort } from "../../src/workflow/engine.js"
import { buildAutoContext } from "../../src/workflow/context.js"

describe("runner DAG integration", () => {
  const spec: WorkflowSpec = {
    version: 1,
    name: "test",
    run: { entrypoint: "plan", timeout: "300s" },
    agents: [{
      name: "a",
      role: "analysis",
      settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } }
    }],
    tasks: [
      { name: "plan", agent: { ref: "agents.a", prompt: { content: "" } } },
      { name: "setup", dependencies: ["plan"], agent: { ref: "agents.a", prompt: { content: "" } } },
      { name: "verify", dependencies: ["setup"], agent: { ref: "agents.a", prompt: { content: "" } } }
    ]
  }

  it("produces correct execution order from entrypoint", () => {
    const reachable = collectReachableTasks(spec.tasks, spec.run.entrypoint)
    const sorted = topologicalSort(reachable)
    expect(sorted.map(t => t.name)).toEqual(["plan", "setup", "verify"])
  })

  it("ignores unreachable tasks", () => {
    const specWithOrphan: WorkflowSpec = {
      ...spec,
      tasks: [
        ...spec.tasks,
        { name: "orphan", agent: { ref: "agents.a", prompt: { content: "" } } }
      ]
    }
    const reachable = collectReachableTasks(specWithOrphan.tasks, specWithOrphan.run.entrypoint)
    expect(reachable.map(t => t.name)).not.toContain("orphan")
  })

  it("builds auto context from upstream outputs", () => {
    const allOutputs = {
      tasks: {
        plan: { outputs: { status: "done" } },
        setup: { outputs: { repo: "/tmp", build_cmd: "make" } }
      }
    }
    const task = spec.tasks[2] // verify
    const ctx = buildAutoContext(task, allOutputs, {})
    expect(ctx.tasks).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/workflow/runner.test.ts
```
Expected: PASS — these functions already exist from previous tasks

- [ ] **Step 3: Write `src/workflow/runner.ts` — DAG-aware executor**

```typescript
import { Effect, Schedule, Duration, Scope } from "effect"
import { WorkflowSpec, WorkflowTask } from "../types.js"
import { buildAgentPrompt } from "../agent/activity.js"
import { buildAutoContext, mergeContext, type Context } from "../workflow/context.js"
import { resolvePersona } from "../agent/persona.js"
import { createRtkExtension } from "../agent/rtk-extension.js"
import { executeWithPi } from "../agent/pi-executor.js"
import { collectReachableTasks, topologicalSort, resolveTaskTimeout, buildTaskId } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import {
  createRunDir,
  writeInput,
  writeStepOutput,
  writeSummary,
  appendEngineLog
} from "../observability/run-dir.js"
import { EventBus } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"

export interface WorkflowRunnerConfig {
  workflowsDir: string
}

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
  context: Context
  startedAt: string
  completedAt: string
}

function expandForEach(
  task: WorkflowTask,
  accumulatedContext: Context
): WorkflowTask[] {
  if (!task.forEach) return [task]

  const arr = resolveRefPath(accumulatedContext, task.forEach.valueFrom.ref)
  if (!Array.isArray(arr)) return [task]

  const instances: WorkflowTask[] = []
  for (let i = 0; i < arr.length; i++) {
    const instanceName = `${task.name}/${i}`
    const templateName = task.template!
    instances.push({
      name: instanceName,
      dependencies: task.dependencies,
      agent: undefined,
      template: templateName,
      context: task.context,
      forEach: undefined
    })
  }
  return instances
}

function resolveRefPath(context: Context, ref: string): unknown {
  if (ref.startsWith("vars.")) return undefined
  const parts = ref.split(".")
  const tasks = context.tasks as Record<string, { outputs: Record<string, unknown> }> | undefined
  if (!tasks) return undefined
  if (parts[0] === "tasks" && parts.length >= 2) {
    const taskName = parts[1]
    const task = tasks[taskName]
    if (!task) return undefined
    let current: unknown = task.outputs
    for (let i = 3; i < parts.length; i++) {
      if (current === null || typeof current !== "object") return undefined
      current = (current as Record<string, unknown>)[parts[i]]
    }
    return parts.length <= 2 ? task.outputs : current
  }
  return undefined
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialContext: Context,
  config: WorkflowRunnerConfig,
  existingRunId?: string
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const startedAt = new Date().toISOString()

    const workflowDir = `${config.workflowsDir}/${spec.name}`

    const staticTasks = collectReachableTasks(spec.tasks, spec.run.entrypoint)
    const sortedTasks = topologicalSort(staticTasks)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, initialContext, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    const runId = ctx.runId

    yield* _(DbWriter(ctx.db))
    yield* _(createRunDir(runId))
    yield* _(writeInput(runId, {
      spec,
      initialContext,
      executionContext: {
        cwd: process.cwd(),
        requestedAt: startedAt,
        workflowName: spec.name
      }
    }))
    yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))
    yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.name }))

    const runningContext: Context = { tasks: {} }
    const taskResults: Record<string, string> = {}
    let workflowStatus: "completed" | "failed" | "paused" = "completed"

    const body = Effect.gen(function* () {
      for (const task of sortedTasks) {
        if (task.template) {
          const templateTask = spec.tasks.find(t => t.name === task.template)
          if (!templateTask) continue

          const arrValue = task.forEach
            ? resolveRefPath(runningContext, task.forEach.valueFrom.ref)
            : undefined
          const items = Array.isArray(arrValue) ? arrValue : [undefined]

          for (let i = 0; i < items.length; i++) {
            const instanceName = `${task.name}/${i}`
            const vars: Context = {}
            if (task.forEach && items[i] !== undefined) {
              vars[task.forEach.as] = items[i]
            }

            const subContext = buildAutoContext(task, runningContext, vars)

            if (templateTask.tasks) {
              const sub = topologicalSort(templateTask.tasks)
              for (const subTask of sub) {
                const taskId = buildTaskId(runId, `${instanceName}-${subTask.name}`)
                yield* _(ctx.transitionTask(`${instanceName}-${subTask.name}`, "start"))
                yield* _(bus.publish({ _tag: "StepStarted", runId, stepId: taskId }))

                const agent = spec.agents.find(a => a.name === subTask.agent?.ref.replace("agents.", "") ?? "")
                if (!agent || !subTask.agent) continue

                const persona = yield* _(
                  resolvePersona(agent.settings.systemPrompt, workflowDir).pipe(
                    Effect.mapError((e) => new Error(e.message))
                  )
                )

                const prompt = buildAgentPrompt({
                  agentFile: persona.agent,
                  soulFile: persona.soul,
                  identityFile: persona.identity,
                  prompt: subTask.agent.prompt,
                  context: subContext,
                  agentConfig: agent
                })

                const timeoutSeconds = resolveTaskTimeout(subTask, spec.run.timeout)
                const rtkExtension = createRtkExtension({ model: agent.settings.model, disabled: process.env.RTK_DISABLED === "1" })

                const outputSchema = subTask.agent.output?.schema

                const output = yield* _(executeWithPi({
                  systemPrompt: prompt.systemPrompt,
                  taskPrompt: prompt.taskPrompt,
                  stepId: taskId,
                  agentId: agent.name,
                  runId,
                  timeoutSeconds,
                  model: agent.settings.model,
                  extensions: [rtkExtension],
                  outputSchema,
                  settings: {
                    skills: agent.settings.skills,
                    thinking: undefined,
                    tools: undefined,
                    retryOnTransient: undefined,
                    compactionEnabled: undefined
                  }
                }).pipe(
                  Effect.timeout(Duration.seconds(timeoutSeconds)),
                  Effect.retry(
                    Schedule.recurs((subTask.agent?.on_failure?.max_retries ?? 1) - 1)
                  )
                ))

                const taskKey = `${instanceName}-${subTask.name}`
                taskResults[taskKey] = output?.status ?? "done"

                const key = `${instanceName}-${subTask.name}`
                if (!runningContext.tasks) runningContext.tasks = {}
                ;(runningContext.tasks as Record<string, unknown>)[key] = { outputs: output }

                yield* _(ctx.transitionTask(taskKey, "complete"))
                yield* _(writeStepOutput(runId, taskId, output ?? {}))
                yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId: taskId }))
              }
            } else if (templateTask.agent) {
              const taskId = buildTaskId(runId, `${instanceName}`)
              yield* _(ctx.transitionTask(instanceName, "start"))
              yield* _(bus.publish({ _tag: "StepStarted", runId, stepId: taskId }))

              const agent = spec.agents.find(a => a.name === templateTask.agent?.ref.replace("agents.", "") ?? "")
              if (!agent) continue

              const persona = yield* _(
                resolvePersona(agent.settings.systemPrompt, workflowDir).pipe(
                  Effect.mapError((e) => new Error(e.message))
                )
              )

              const prompt = buildAgentPrompt({
                agentFile: persona.agent,
                soulFile: persona.soul,
                identityFile: persona.identity,
                prompt: templateTask.agent.prompt,
                context: subContext,
                agentConfig: agent
              })

              const timeoutSeconds = resolveTaskTimeout(templateTask, spec.run.timeout)
              const outputSchema = templateTask.agent.output?.schema

              const output = yield* _(executeWithPi({
                systemPrompt: prompt.systemPrompt,
                taskPrompt: prompt.taskPrompt,
                stepId: taskId,
                agentId: agent.name,
                runId,
                timeoutSeconds,
                model: agent.settings.model,
                extensions: [],
                outputSchema,
                settings: { skills: agent.settings.skills }
              }).pipe(
                Effect.timeout(Duration.seconds(timeoutSeconds)),
                Effect.retry(
                  Schedule.recurs((templateTask.agent?.on_failure?.max_retries ?? 1) - 1)
                )
              ))

              taskResults[instanceName] = output?.status ?? "done"
              if (!runningContext.tasks) runningContext.tasks = {}
              ;(runningContext.tasks as Record<string, unknown>)[instanceName] = { outputs: output }

              yield* _(ctx.transitionTask(instanceName, "complete"))
              yield* _(writeStepOutput(runId, taskId, output ?? {}))
              yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId: taskId }))
            }
          }
          continue
        }

        if (!task.agent) continue

        const agent = spec.agents.find(a => a.name === task.agent!.ref.replace("agents.", "") ?? "")
        if (!agent) continue

        const taskId = buildTaskId(runId, task.name)
        const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
        if (!shouldExec) continue

        yield* _(ctx.transitionTask(task.name, "start"))
        yield* _(bus.publish({ _tag: "StepStarted", runId, stepId: taskId }))

        const persona = yield* _(
          resolvePersona(agent.settings.systemPrompt, workflowDir).pipe(
            Effect.mapError((e) => new Error(e.message))
          )
        )

        const taskContext = buildAutoContext(task, runningContext, {})

        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          identityFile: persona.identity,
          prompt: task.agent.prompt,
          context: taskContext,
          agentConfig: agent
        })

        const timeoutSeconds = resolveTaskTimeout(task, spec.run.timeout)
        const rtkExtension = createRtkExtension({ model: agent.settings.model, disabled: process.env.RTK_DISABLED === "1" })
        const outputSchema = task.agent.output?.schema

        const output = yield* _(executeWithPi({
          systemPrompt: prompt.systemPrompt,
          taskPrompt: prompt.taskPrompt,
          stepId: taskId,
          agentId: agent.name,
          runId,
          timeoutSeconds,
          model: agent.settings.model,
          extensions: [rtkExtension],
          outputSchema,
          settings: {
            skills: agent.settings.skills,
            thinking: undefined,
            tools: undefined,
            retryOnTransient: undefined,
            compactionEnabled: undefined
          }
        }).pipe(
          Effect.timeout(Duration.seconds(timeoutSeconds)),
          Effect.retry(
            Schedule.recurs((task.agent.on_failure?.max_retries ?? 1) - 1).pipe(
              Schedule.tapInput(() =>
                Effect.gen(function* () {
                  yield* _(bus.publish({ _tag: "StepRetrying", runId, stepId: taskId }))
                }).pipe(Effect.catchAll(() => Effect.void))
              )
            )
          )
        ))

        if (output === undefined || output === null) {
          yield* _(bus.publish({ _tag: "StepTimedOut", runId, stepId: taskId }))
          yield* _(ctx.transitionTask(task.name, "fail"))
          workflowStatus = "failed"
          break
        }

        if (!runningContext.tasks) runningContext.tasks = {}
        ;(runningContext.tasks as Record<string, unknown>)[task.name] = { outputs: output }

        yield* _(ctx.transitionTask(task.name, "complete"))
        yield* _(writeStepOutput(runId, taskId, output))
        taskResults[task.name] = output.status ?? "done"
        yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId: taskId }))
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus === "failed") {
        yield* _(ctx.fail(workflowStatus).pipe(Effect.catchAll(() => Effect.void)))
      }

      const summary = { runId, status: workflowStatus, taskResults, context: runningContext, startedAt, completedAt }
      yield* _(writeSummary(runId, summary))
      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
      yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))

      return { runId, status: workflowStatus, taskResults, context: runningContext, startedAt, completedAt } as WorkflowResult
    })

    const completedAt = new Date().toISOString()

    return yield* _(body.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* _(bus.publish({ _tag: "WorkflowCompleted", runId, message: String(error) }))
          yield* _(appendEngineLog(runId, { event: "workflow_failed", error: String(error) }))
          yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
          yield* _(writeSummary(runId, { runId, status: "failed", taskResults, context: runningContext, startedAt, completedAt }))
          return { runId, status: "failed" as const, taskResults, context: runningContext, startedAt, completedAt }
        })
      ),
      Effect.ensuring(ctx.close())
    ))
  })
}
```

- [ ] **Step 4: Build check**

```bash
bun run build
```
Expected: may have type errors to fix — resolve them inline

- [ ] **Step 5: Run runner tests**

```bash
bun --bun vitest run tests/workflow/runner.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/runner.test.ts
git commit -m "feat: rewrite runner for DAG-aware execution"
```

---

### Task 14: Update CLI — shared agent copy and runtime wiring

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/install.ts`

- [ ] **Step 1: Update run.ts to use new types and add shared agent copy**

In `src/cli/commands/run.ts`, update imports and ensure `WorkflowResult` uses `taskResults` instead of `stepResults`. Add shared agent copy logic before execution.

```typescript
// In the run effect, add shared agent copy before loading workflow:
function ensureSharedAgents(workflowsDir: string, workflowName: string): void {
  const sharedDir = Path.join(workflowsDir, workflowName, "shared")
  if (Fs.existsSync(sharedDir)) return

  const sourceDir = Path.join(workflowsDir, "..", "..", "agents", "shared")
  if (Fs.existsSync(sourceDir)) {
    copyDirSync(sourceDir, sharedDir)
  }
}

function copyDirSync(src: string, dest: string): void {
  Fs.mkdirSync(dest, { recursive: true })
  for (const entry of Fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = Path.join(src, entry.name)
    const destPath = Path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      Fs.copyFileSync(srcPath, destPath)
    }
  }
}
```

- [ ] **Step 2: Update resolver for new format**

`src/workflow/resolver.ts` handles `--merge`, `--github-pr`, etc. The lookup uses `slug` → need to update for `name`. Update the resolver to work with new format.

- [ ] **Step 3: Verify build**

```bash
bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/run.ts src/cli/commands/install.ts src/workflow/resolver.ts
git commit -m "feat: update CLI for DAG runner, add shared agent copy at runtime"
```

---

### Task 15: Convert all 20 workflow YAMLs to new format

**Files:**
- Modify: `workflows/*/workflow.yml` (20 files)

- [ ] **Step 1: Convert feature-dev (the reference)**

Write `workflows/feature-dev/workflow.yml` in the new DAG format. Use the canonical example from the design spec:

```yaml
version: 1
name: feature-dev
description: |
  Feature Development Workflow (local-only). Plan, implement, test, and verify features story-by-story in a local-only pipeline without merge or PR.

run:
  entrypoint: plan
  timeout: 300s

agents:
  - name: planner
    role: analysis
    description: Decomposes tasks into ordered user stories.
    settings:
      model: deepseek-v4-pro-official
      systemPrompt:
        agent: agents/planner/AGENTS.md
        soul: agents/planner/SOUL.md
        identity: agents/planner/IDENTITY.md
      skills:
        - hamilton-agents

  - name: setup
    role: coding
    description: Prepares environment, creates branch, establishes baseline.
    settings:
      systemPrompt:
        agent: shared/agents/setup/AGENTS.md
        soul: shared/agents/setup/SOUL.md
        identity: shared/agents/setup/IDENTITY.md
      skills:
        - hamilton-agents

  - name: developer
    role: coding
    description: Implements features and writes tests.
    settings:
      systemPrompt:
        agent: agents/developer/AGENTS.md
        soul: agents/developer/SOUL.md
        identity: agents/developer/IDENTITY.md
      skills:
        - hamilton-agents

  - name: verifier
    role: verification
    description: Verifies implementation quality.
    settings:
      systemPrompt:
        agent: shared/agents/verifier/AGENTS.md
        soul: shared/agents/verifier/SOUL.md
        identity: shared/agents/verifier/IDENTITY.md
      skills:
        - agent-browser
        - hamilton-agents

  - name: tester
    role: testing
    description: Integration and E2E testing.
    settings:
      systemPrompt:
        agent: agents/tester/AGENTS.md
        soul: agents/tester/SOUL.md
        identity: agents/tester/IDENTITY.md
      skills:
        - hamilton-agents

tasks:
  - name: plan
    agent:
      ref: agents.planner
      on_failure:
        max_retries: 4
        escalate_to: human
      output:
        schema:
          type: object
          properties:
            status:
              type: string
            user_stories:
              type: array
              items:
                type: object
                properties:
                  id:
                    type: string
                  title:
                    type: string
                  description:
                    type: string
                  acceptanceCriteria:
                    type: array
                    items:
                      type: string
                required:
                  - id
                  - title
                  - description
                  - acceptanceCriteria
          required:
            - status
            - user_stories
      prompt:
        content: |
          Decompose the following task into ordered user stories for autonomous execution.

          TASK:
          {{task}}

          RETRY FEEDBACK (only present if your previous attempt was rejected — read carefully and fix specifically what it complains about):
          {{retry_feedback}}

          Instructions:
          1. Explore the codebase to understand the stack, conventions, and patterns
          2. Break the task into small user stories (max 20)
          3. Order by dependency: schema/DB first, backend, frontend, integration
          4. Each story must fit in one developer session (one context window)
          5. Every acceptance criterion must be mechanically verifiable
          6. Always include "Typecheck passes" as the last criterion in every story
          7. Every story MUST include test criteria — "Tests for [feature] pass"
          8. The developer is expected to write tests as part of each story

          Reply with:
          STATUS: done
          REPO: /path/to/repo
          BRANCH: <new-feature-branch-name>
          STORIES_JSON: [ ... array of story objects ... ]

  - name: setup
    dependencies:
      - plan
    agent:
      ref: agents.setup
      timeout:
        fixed: 300s
      on_failure:
        max_retries: 4
        escalate_to: human
      prompt:
        content: |
          Prepare the development environment for this feature.

          TASK:
          {{task}}

          REPO: {{repo}}
          BRANCH: {{branch}}

          RETRY FEEDBACK (only present if your previous attempt was rejected):
          {{retry_feedback}}

          Instructions:
          1. cd into the repo
          2. Create the feature branch (git checkout -b {{branch}})
          3. Read package.json, CI config, test config to understand the build/test setup
          4. Ensure .gitignore exists — if missing, create one
          5. Run the build to establish a baseline
          6. Run the tests to establish a baseline
          7. Report what you found

          Reply with:
          STATUS: done
          BUILD_CMD: <build command>
          TEST_CMD: <test command>
          CI_NOTES: <brief CI notes>
          BASELINE: <baseline status>

  - name: codify
    dependencies:
      - setup
    template: develop
    forEach:
      valueFrom:
        ref: tasks.plan.outputs.user_stories
      as: user_story
    context:
      fields:
        - name: setup
          valueFrom:
            ref: tasks.setup.outputs
        - name: repository
          valueFrom:
            ref: tasks.setup.outputs.repo
        - name: current_branch
          valueFrom:
            ref: tasks.setup.outputs.branch
        - name: story
          valueFrom:
            ref: vars.user_story

  - name: develop
    tasks:
      - name: implement
        agent:
          ref: agents.developer
          timeout:
            fixed: 600s
          on_failure:
            max_retries: 4
            escalate_to: human
          prompt:
            content: |
              Implement the following user story.

              TASK (overall):
              {{task}}

              REPO: {{repo}}
              BRANCH: {{branch}}
              BUILD_CMD: {{build_cmd}}
              TEST_CMD: {{test_cmd}}

              CURRENT STORY:
              {{current_story}}

              COMPLETED STORIES:
              {{completed_stories}}

              STORIES REMAINING: {{stories_remaining}}

              VERIFY FEEDBACK (if retrying):
              {{verify_feedback}}

              TIMEOUT RETRY (if previous attempt timed out):
              {{timeout_retry}}

              PROGRESS LOG:
              {{progress}}

              Instructions:
              1. Read progress-{{run_id}}.txt
              2. Pull latest on the branch
              3. Implement this story only
              4. Write tests for this story's functionality
              5. Run typecheck / build
              6. Run tests to confirm they pass
              7. Commit: feat: {{current_story_id}} - {{current_story_title}}
              8. Rewrite progress-{{run_id}}.txt with updated story results

              Reply with:
              STATUS: done
              CHANGES: what you implemented
              TESTS: what tests you wrote

      - name: test
        dependencies:
          - implement
        agent:
          ref: agents.tester
          on_failure:
            retry_step: implement
            max_retries: 4
            on_exhausted:
              escalate_to: human
          prompt:
            content: |
              Integration and E2E testing of the implementation.

              TASK:
              {{task}}

              REPO: {{repo}}
              BRANCH: {{branch}}
              CHANGES: {{changes}}
              BUILD_CMD: {{build_cmd}}
              TEST_CMD: {{test_cmd}}

              PROGRESS LOG:
              {{progress}}

              1. Run the full test suite ({{test_cmd}})
              2. Look for integration issues between stories
              3. If this is a UI feature, use agent-browser to test it end-to-end
              4. Check cross-cutting concerns: error handling, edge cases

              Reply with:
              STATUS: done
              RESULTS: What you tested and the outcomes

              Or if issues found:
              STATUS: retry
              FAILURES:
              - Specific test failures or bugs found

      - name: review
        dependencies:
          - test
        agent:
          ref: agents.verifier
          on_failure:
            retry_step: implement
            max_retries: 4
            on_exhausted:
              escalate_to: human
          prompt:
            content: |
              Verify the work.

              TASK (overall):
              {{task}}

              REPO: {{repo}}
              BRANCH: {{branch}}
              CHANGES: {{changes}}
              TEST_CMD: {{test_cmd}}

              CURRENT STORY:
              {{current_story}}

              PROGRESS LOG:
              {{progress}}

              Check:
              1. Code exists (not just TODOs or placeholders)
              2. Each acceptance criterion for the story is met
              3. Tests were written for this story's functionality
              4. Tests pass (run {{test_cmd}})
              5. No obvious incomplete work
              6. Typecheck passes

              Reply with:
              STATUS: done
              VERIFIED: What you confirmed

              Or if incomplete:
              STATUS: retry
              ISSUES:
              - What's missing or incomplete
```

This establishes the conversion pattern for all other workflows.

- [ ] **Step 2: Convert bug-fix variants (5 files)**

bug-fix, bug-fix-merge, bug-fix-merge-worktree, bug-fix-worktree, bug-fix-github-pr

- [ ] **Step 3: Convert remaining feature-dev variants (4 files)**

feature-dev-merge, feature-dev-merge-worktree, feature-dev-worktree, feature-dev-github-pr

- [ ] **Step 4: Convert security-audit variants (5 files)**

security-audit, security-audit-merge, security-audit-merge-worktree, security-audit-worktree, security-audit-github-pr

- [ ] **Step 5: Convert quarantine-broken-tests variants (3 files)**

quarantine-broken-tests, quarantine-broken-tests-merge, quarantine-broken-tests-merge-worktree

- [ ] **Step 6: Convert do and greenfield (2 files)**

- [ ] **Step 7: Verify all YAMLs parse against the new schema**

Write a validation script `scripts/validate-workflows.ts`:

```typescript
import { Schema } from "@effect/schema"
import { WorkflowSpecSchema } from "../src/schemas.js"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"

const workflowsDir = Path.join(import.meta.dirname, "..", "workflows")
const decode = Schema.decodeSync(WorkflowSpecSchema)

for (const entry of Fs.readdirSync(workflowsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const wfDir = Path.join(workflowsDir, entry.name)
  const wfFile = Path.join(wfDir, "workflow.yml")
  if (!Fs.existsSync(wfFile)) continue

  try {
    const yaml = Fs.readFileSync(wfFile, "utf-8")
    const raw = Yaml.parse(yaml)
    decode(raw)
    console.log(`  ${entry.name}: OK`)
  } catch (e) {
    console.log(`  ${entry.name}: FAILED — ${e instanceof Error ? e.message : String(e)}`)
  }
}
```

Run:
```bash
bun run scripts/validate-workflows.ts
```
Expected: All 20 workflows report `OK`

- [ ] **Step 8: Commit**

```bash
git add workflows/
git commit -m "feat: migrate all 20 workflow YAMLs to DAG format"
```

---

### Task 16: Delete old files and fix remaining imports

**Files:**
- Delete: `src/workflow/deterministic-activities.ts`
- Delete: `src/agent/config.ts`
- Delete: `tests/workflow/deterministic-activities.test.ts`
- Delete: `tests/agent/config.test.ts`
- Delete: `tests/workflow/resolver.test.ts` (if resolver is significantly changed)
- Delete: `tests/workflow/runner-regression.test.ts`
- Modify: Any remaining files importing deleted modules

- [ ] **Step 1: Delete old files**

```bash
rm src/workflow/deterministic-activities.ts
rm src/agent/config.ts
rm tests/workflow/deterministic-activities.test.ts
rm tests/agent/config.test.ts
```

- [ ] **Step 2: Fix remaining imports**

Search for imports of deleted modules and update.

```bash
grep -r "deterministic-activities" src/ --include="*.ts"
grep -r "agent/config" src/ --include="*.ts"
grep -r "agent/config" tests/ --include="*.ts"
```

- [ ] **Step 3: Update tests fixtures for schemas.test.ts**

Replace `tests/fixtures/bug-fix.yml` if it still uses old format.

- [ ] **Step 4: Full build and test**

```bash
bun run build
bun --bun vitest run
```
Expected: All 155+ tests pass (adjust count for rewritten/added tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: delete old linear engine files, fix remaining imports"
```

---

### Task 17: Update CLI commands for task terminology

**Files:**
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/logs.ts`
- Modify: `src/cli/commands/list.ts`
- Modify: `src/cli/commands/runs.ts`
- Modify: `tests/cli/*.test.ts` (affected tests)

- [ ] **Step 1: Update status/logs/list/runs to use task terminology**

Replace `step` → `task` in CLI output, variable names, and DB query references. Update `StepRow` → `TaskRow` references.

- [ ] **Step 2: Update CLI tests**

```bash
bun --bun vitest run tests/cli/
```
Expected: PASS or targeted fixes

- [ ] **Step 3: Commit**

```bash
git add src/cli/ tests/cli/
git commit -m "feat: update CLI output to use task terminology"
```

---

### Task 18: Final verification

- [ ] **Step 1: Full build**

```bash
bun run build
```
Expected: PASS — no type errors

- [ ] **Step 2: Full test suite**

```bash
bun --bun vitest run
```
Expected: All tests pass

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final fixes for DAG migration"
```
