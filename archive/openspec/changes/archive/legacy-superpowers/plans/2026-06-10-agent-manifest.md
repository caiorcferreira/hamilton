# Agent Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract agent definitions from inline workflow.yml `agents:` blocks into standalone `agent.yml` manifest files, replacing `task.agent.ref` with `task.agent.executorRef`.

**Architecture:** Two-pass load — first scan all `agent.yml` files into a unified registry (rejecting name collisions), then parse `workflow.yml` which no longer has an `agents:` key. Tasks reference agents by plain name via `executorRef`. Convention-over-configuration resolves `systemPrompt` paths to sibling `AGENTS.md`/`SOUL.md`/`IDENTITY.md`. The shared-agents symlink module is deleted entirely.

**Tech Stack:** TypeScript, Effect-TS, @effect/schema, yaml (npm), bun:sqlite, vitest

---

## File Structure

**New files:**
- `src/workflow/agent-registry.ts` — agent manifest types, `AgentManifestParseError`, `DuplicateAgentError`, `loadAgentManifests()`, `resolveSystemPromptDefaults()`
- `tests/workflow/agent-registry.test.ts` — tests for agent manifest loading, collision detection, systemPrompt defaults

**Modified files:**
- `src/types.ts` — remove `AgentRole`, `WorkflowAgent`, `AgentSettings`, `RefPath`; rename `TaskAgent.ref` to `TaskAgent.executorRef`; add `AgentManifest`, `AgentManifestSettings`; change `WorkflowSpec.agents` to `agentRegistry`
- `src/schemas.ts` — remove `AgentRoleSchema`, `AgentSettingsSchema`, `WorkflowAgentSchema`, `RefPathSchema`; rename `TaskAgentSchema.ref` to `executorRef`; remove `WorkflowSpecSchema.agents`; add `AgentManifestSchema`
- `src/workflow/loader.ts` — two-pass load: `loadAgentManifests()` then `loadWorkflowSpec()` without agents; add `AgentNotFoundError` error type
- `src/workflow/runner.ts` — remove `ensureSharedAgentsSymlink` import/call; use `agentRegistry.get(task.agent.executorRef)` instead of `spec.agents.find()`
- `src/workflow/variants.ts` — replace `agents: WorkflowAgent[]` in `VariantDefinition` + `VARIANT_REGISTRY` with `executorRef` refs; remove variant agent injection
- `src/prompts/persona.ts` — change path resolution base from `workflowDir` to `agentDir` (the directory containing `agent.yml`)
- `src/agent/config.ts` — import `AgentManifestSettings` instead of `AgentSettings`
- `src/cli/commands/run.ts` — call `loadAgentManifests()` before `loadWorkflowSpec()` and pass registry

**Deleted files:**
- `src/workflow/shared-agents.ts`
- `tests/workflow/shared-agents.test.ts`

**Migrated manifest files (all 6 workflows + 4 shared agents):**
- `manifest/agents/do/agent.yml`, `manifest/agents/pr/agent.yml`, `manifest/agents/setup/agent.yml`, `manifest/agents/verifier/agent.yml`
- `manifest/workflows/feature-dev/agents/planner/agent.yml`, `manifest/workflows/feature-dev/agents/developer/agent.yml`, `manifest/workflows/feature-dev/agents/tester/agent.yml`
- `manifest/workflows/bug-fix/agents/triager/agent.yml`, `manifest/workflows/bug-fix/agents/investigator/agent.yml`, `manifest/workflows/bug-fix/agents/fixer/agent.yml`
- `manifest/workflows/security-audit/agents/scanner/agent.yml`, `manifest/workflows/security-audit/agents/prioritizer/agent.yml`, `manifest/workflows/security-audit/agents/fixer/agent.yml`, `manifest/workflows/security-audit/agents/tester/agent.yml`
- `manifest/workflows/quarantine-broken-tests/agents/quarantiner/agent.yml`, `manifest/workflows/quarantine-broken-tests/agents/verifier/agent.yml`
- `manifest/workflows/greenfield/agents/scaffolder/agent.yml`
- `manifest/workflows/do/agents/doer/agent.yml`
- All 6 `manifest/workflows/*/workflow.yml` — remove `agents:` key, rename `ref:` to `executorRef:`, bump version

**Test files updated:**
- `tests/types.test.ts` — remove `AgentRole`, `WorkflowAgent` references; add `AgentManifest`; change `ref` to `executorRef`; remove `agents:` from `WorkflowSpec`
- `tests/schemas.test.ts` — remove `agents:` from all test data; change `ref` to `executorRef`; remove "rejects no agents" test; update fixture
- `tests/workflow/loader.test.ts` — remove `agents:` from YAML; change `ref` to `executorRef`; add agent manifest files to test fixtures
- `tests/workflow/runner.test.ts` — remove `agents:` from `makeSpec()`; change `ref` to `executorRef`; add `agentRegistry` to spec; remove symlink test section
- `tests/workflow/runner-regression.test.ts` — remove `agents:`; change `ref` to `executorRef`
- `tests/workflow/variants.test.ts` — remove `agents:` from `baseSpec()`; change variant defs to use `executorRef`; remove agent merging tests
- `tests/workflow/run-state-machine.test.ts` — remove `agents:`; change `ref` to `executorRef`
- `tests/e2e/workflows.test.ts` — remove `agents:`; change `ref` to `executorRef`
- `tests/cli/run.test.ts` — remove `agents:` from YAML; change `ref` to `executorRef`
- `tests/fixtures/feature-dev.yml` — remove `agents:`; change `ref` to `executorRef`

---

### Task 1: Define new types and remove old types in `src/types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Replace types in `src/types.ts`**

Remove these types: `AgentRole`, `WorkflowAgent`, `AgentSettings`, `RefPath`.

Rename `TaskAgent.ref` to `TaskAgent.executorRef`.

Change `WorkflowSpec.agents: WorkflowAgent[]` to `WorkflowSpec.agentRegistry: Map<string, AgentManifest>`.

Add `AgentManifest` and `AgentManifestSettings`:

```typescript
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

export interface AgentManifestSettings {
  model?: string
  systemPrompt?: SystemPromptPaths
  skills?: string[]
}

export interface AgentManifest {
  name: string
  dirPath: string
  settings: AgentManifestSettings
  systemPrompt: SystemPromptPaths
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

export interface SchemaConfig {
  content?: Record<string, unknown>
  file?: string
}

export interface OutputConfig {
  schema?: SchemaConfig
}

export interface Prompt {
  content?: string
  file?: string
}

export interface TaskAgent {
  executorRef: string
  timeout?: Timeout
  on_failure?: OnFailure
  output?: OutputConfig
  prompt: Prompt
}

export interface ForEach {
  valueFrom: { ref: string }
  as: string
}

export interface ContextField {
  name: string
  valueFrom: { ref: string }
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

export type VariantPlacement = "start" | "end"

export interface VariantCapabilities {
  provides: string[]
  replaces: string[]
}

export interface VariantTask {
  placement: VariantPlacement
  capabilities: VariantCapabilities
  task: WorkflowTask
}

export interface WorkflowSpec {
  version: number
  name: string
  description?: string
  run: RunConfig
  variants?: {
    supported: string[]
  }
  agentRegistry: Map<string, AgentManifest>
  tasks: WorkflowTask[]
}
```

Note: `ForEach.valueFrom` and `ContextField.valueFrom` drop the `RefPath` wrapper — they now inline `{ ref: string }`.

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "refactor: replace WorkflowAgent/AgentRole/AgentSettings with AgentManifest, rename ref to executorRef"
```

---

### Task 2: Update schemas in `src/schemas.ts`

**Files:**
- Modify: `src/schemas.ts`

- [ ] **Step 1: Rewrite `src/schemas.ts`**

Remove: `AgentRoleSchema`, `AgentSettingsSchema`, `WorkflowAgentSchema`, `RefPathSchema`.

Rename `TaskAgentSchema.ref` to `TaskAgentSchema.executorRef`.

Inline `RefPathSchema` into `ForEachSchema` and `ContextFieldSchema`.

Remove `agents` from `WorkflowSpecSchema`.

```typescript
import { Schema } from "@effect/schema"

const SystemPromptPathsSchema = Schema.Struct({
  agent: Schema.String,
  soul: Schema.String,
  identity: Schema.String
})

const AgentManifestSettingsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  systemPrompt: Schema.optional(SystemPromptPathsSchema),
  skills: Schema.optional(Schema.Array(Schema.String))
})

export const AgentManifestSchema = Schema.Struct({
  name: Schema.String,
  settings: AgentManifestSettingsSchema
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

const SchemaConfigSchema = Schema.Union(
  Schema.Struct({
    content: Schema.Record({ key: Schema.String, value: Schema.Unknown })
  }),
  Schema.Struct({
    file: Schema.String
  }),
  Schema.Struct({
    content: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    file: Schema.String
  })
)

const OutputConfigSchema = Schema.Struct({
  schema: Schema.optional(SchemaConfigSchema)
})

const PromptSchema = Schema.Struct({
  content: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String)
}).pipe(
  Schema.filter(
    (p: any) => (p.content ? !p.file : !!p.file),
    { message: () => "prompt must have exactly one of 'content' or 'file'" }
  )
)

const TaskAgentSchema = Schema.Struct({
  executorRef: Schema.String,
  timeout: Schema.optional(TimeoutSchema),
  on_failure: Schema.optional(OnFailureSchema),
  output: Schema.optional(OutputConfigSchema),
  prompt: PromptSchema
})

const ForEachSchema = Schema.Struct({
  valueFrom: Schema.Struct({ ref: Schema.String }),
  as: Schema.String
})

const ContextFieldSchema = Schema.Struct({
  name: Schema.String,
  valueFrom: Schema.Struct({ ref: Schema.String })
})

const ContextFieldsSchema = Schema.Struct({
  fields: Schema.Array(ContextFieldSchema)
})

const WorkflowTaskSchema: Schema.Schema<any> = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(TaskAgentSchema),
  template: Schema.optional(Schema.String),
  forEach: Schema.optional(ForEachSchema),
  context: Schema.optional(ContextFieldsSchema),
  tasks: Schema.optional(Schema.suspend(() => Schema.Array(WorkflowTaskSchema)))
})

const RunConfigSchema = Schema.Struct({
  entrypoint: Schema.String,
  timeout: Schema.String
})

const VariantsConfigSchema = Schema.Struct({
  supported: Schema.Array(Schema.String)
})

export const WorkflowSpecSchema = Schema.Struct({
  version: Schema.Number,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  run: RunConfigSchema,
  variants: Schema.optional(VariantsConfigSchema),
  tasks: Schema.Array(WorkflowTaskSchema)
}).pipe(
  Schema.filter(
    (spec: any) => {
      const taskNames = new Set(spec.tasks.map((t: any) => t.name))
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

- [ ] **Step 2: Commit**

```bash
git add src/schemas.ts
git commit -m "refactor: update schemas — remove agents from WorkflowSpecSchema, rename ref to executorRef"
```

---

### Task 3: Create agent-registry module

**Files:**
- Create: `src/workflow/agent-registry.ts`
- Create: `tests/workflow/agent-registry.test.ts`

- [ ] **Step 1: Write the failing test for `loadAgentManifests`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadAgentManifests, DuplicateAgentError, AgentManifestParseError } from "../../src/workflow/agent-registry.js"

describe("loadAgentManifests", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-agent-reg-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loads shared agent manifests into a registry", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const setupDir = Path.join(agentsDir, "setup")
    Fs.mkdirSync(setupDir, { recursive: true })
    Fs.writeFileSync(Path.join(setupDir, "agent.yml"), "name: setup\nsettings:\n  model: default\n")
    Fs.writeFileSync(Path.join(setupDir, "AGENTS.md"), "Be a setup agent")

    const exit = await Effect.runPromiseExit(loadAgentManifests(agentsDir, []))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.has("setup")).toBe(true)
      expect(exit.value.get("setup")!.name).toBe("setup")
      expect(exit.value.get("setup")!.systemPrompt.agent).toBe("AGENTS.md")
    }
  })

  it("loads workflow-local agent manifests and merges with shared", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const setupDir = Path.join(agentsDir, "setup")
    Fs.mkdirSync(setupDir, { recursive: true })
    Fs.writeFileSync(Path.join(setupDir, "agent.yml"), "name: setup\nsettings:\n  model: default\n")

    const wfAgentsDir = Path.join(tmpDir, "workflows", "my-wf", "agents")
    const plannerDir = Path.join(wfAgentsDir, "planner")
    Fs.mkdirSync(plannerDir, { recursive: true })
    Fs.writeFileSync(Path.join(plannerDir, "agent.yml"), "name: planner\nsettings:\n  model: default\n")

    const exit = await Effect.runPromiseExit(loadAgentManifests(agentsDir, [
      { name: "my-wf", dir: Path.join(tmpDir, "workflows", "my-wf") }
    ]))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.has("setup")).toBe(true)
      expect(exit.value.has("planner")).toBe(true)
    }
  })

  it("rejects duplicate agent names across shared and workflow-local", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const setupDir = Path.join(agentsDir, "setup")
    Fs.mkdirSync(setupDir, { recursive: true })
    Fs.writeFileSync(Path.join(setupDir, "agent.yml"), "name: setup\nsettings:\n  model: default\n")

    const wfAgentsDir = Path.join(tmpDir, "workflows", "my-wf", "agents")
    const dupeDir = Path.join(wfAgentsDir, "setup")
    Fs.mkdirSync(dupeDir, { recursive: true })
    Fs.writeFileSync(Path.join(dupeDir, "agent.yml"), "name: setup\nsettings:\n  model: fast\n")

    const exit = await Effect.runPromiseExit(loadAgentManifests(agentsDir, [
      { name: "my-wf", dir: Path.join(tmpDir, "workflows", "my-wf") }
    ]))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("DuplicateAgentError")
    }
  })

  it("rejects agent.yml where name does not match directory", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const wrongDir = Path.join(agentsDir, "setup")
    Fs.mkdirSync(wrongDir, { recursive: true })
    Fs.writeFileSync(Path.join(wrongDir, "agent.yml"), "name: wrong-name\nsettings:\n  model: default\n")

    const exit = await Effect.runPromiseExit(loadAgentManifests(agentsDir, []))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("AgentManifestParseError")
    }
  })

  it("defaults systemPrompt to sibling files when they exist", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const setupDir = Path.join(agentsDir, "setup")
    Fs.mkdirSync(setupDir, { recursive: true })
    Fs.writeFileSync(Path.join(setupDir, "agent.yml"), "name: setup\nsettings:\n  model: default\n")
    Fs.writeFileSync(Path.join(setupDir, "AGENTS.md"), "agent content")
    Fs.writeFileSync(Path.join(setupDir, "SOUL.md"), "soul content")
    Fs.writeFileSync(Path.join(setupDir, "IDENTITY.md"), "identity content")

    const exit = await Effect.runPromiseExit(loadAgentManifests(agentsDir, []))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const agent = exit.value.get("setup")!
      expect(agent.systemPrompt.agent).toBe("AGENTS.md")
      expect(agent.systemPrompt.soul).toBe("SOUL.md")
      expect(agent.systemPrompt.identity).toBe("IDENTITY.md")
    }
  })

  it("uses empty strings for systemPrompt when sibling files do not exist", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const setupDir = Path.join(agentsDir, "setup")
    Fs.mkdirSync(setupDir, { recursive: true })
    Fs.writeFileSync(Path.join(setupDir, "agent.yml"), "name: setup\nsettings:\n  model: default\n")

    const exit = await Effect.runPromiseExit(loadAgentManifests(agentsDir, []))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const agent = exit.value.get("setup")!
      expect(agent.systemPrompt.agent).toBe("")
      expect(agent.systemPrompt.soul).toBe("")
      expect(agent.systemPrompt.identity).toBe("")
    }
  })

  it("uses explicit systemPrompt when provided, defaults other fields", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const setupDir = Path.join(agentsDir, "setup")
    Fs.mkdirSync(setupDir, { recursive: true })
    Fs.writeFileSync(Path.join(setupDir, "agent.yml"), "name: setup\nsettings:\n  model: default\n  systemPrompt:\n    agent: custom/PROMPT.md\n")
    Fs.writeFileSync(Path.join(setupDir, "SOUL.md"), "soul content")

    const exit = await Effect.runPromiseExit(loadAgentManifests(agentsDir, []))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const agent = exit.value.get("setup")!
      expect(agent.systemPrompt.agent).toBe("custom/PROMPT.md")
      expect(agent.systemPrompt.soul).toBe("SOUL.md")
      expect(agent.systemPrompt.identity).toBe("")
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/workflow/agent-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/workflow/agent-registry.ts`**

```typescript
import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"
import { Schema } from "@effect/schema"
import type { AgentManifest, SystemPromptPaths } from "../types.js"
import { AgentManifestSchema } from "../schemas.js"

export class DuplicateAgentError extends Data.TaggedError("DuplicateAgentError")<{
  name: string
  sharedPath: string
  localPath: string
}> {}

export class AgentManifestParseError extends Data.TaggedError("AgentManifestParseError")<{
  filePath: string
  message: string
}> {}

export interface WorkflowDescriptor {
  name: string
  dir: string
}

const SIBLING_EXTENSIONS: Record<keyof SystemPromptPaths, string> = {
  agent: "AGENTS.md",
  soul: "SOUL.md",
  identity: "IDENTITY.md"
}

function resolveSystemPromptDefaults(
  agentDir: string,
  explicit?: SystemPromptPaths
): SystemPromptPaths {
  const result: SystemPromptPaths = { agent: "", soul: "", identity: "" }

  for (const key of Object.keys(SIBLING_EXTENSIONS) as (keyof SystemPromptPaths)[]) {
    if (explicit && explicit[key]) {
      result[key] = explicit[key]
    } else {
      const sibling = Path.join(agentDir, SIBLING_EXTENSIONS[key])
      result[key] = Fs.existsSync(sibling) ? SIBLING_EXTENSIONS[key] : ""
    }
  }

  return result
}

function loadOneManifest(agentDir: string): Effect.Effect<AgentManifest, AgentManifestParseError> {
  return Effect.gen(function* (_) {
    const filePath = Path.join(agentDir, "agent.yml")
    const content = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(filePath, "utf-8"),
        catch: () => new AgentManifestParseError({ filePath, message: "file not found" })
      })
    )

    const raw = yield* _(
      Effect.try({
        try: () => Yaml.parse(content) as unknown,
        catch: (e) => new AgentManifestParseError({ filePath, message: String(e) })
      })
    )

    const parsed = yield* _(
      Effect.try({
        try: () => Schema.decodeUnknownSync(AgentManifestSchema)(raw),
        catch: (e) => new AgentManifestParseError({ filePath, message: String(e) })
      })
    )

    const dirName = Path.basename(agentDir)
    if (parsed.name !== dirName) {
      yield* _(Effect.fail(new AgentManifestParseError({
        filePath,
        message: `name "${parsed.name}" does not match directory "${dirName}"`
      })))
    }

    const systemPrompt = resolveSystemPromptDefaults(agentDir, parsed.settings.systemPrompt)

    return {
      name: parsed.name,
      dirPath: agentDir,
      settings: parsed.settings,
      systemPrompt
    }
  })
}

export function loadAgentManifests(
  sharedAgentsDir: string,
  workflows: WorkflowDescriptor[]
): Effect.Effect<Map<string, AgentManifest>, DuplicateAgentError | AgentManifestParseError> {
  return Effect.gen(function* (_) {
    const registry = new Map<string, AgentManifest>()

    const addManifest = (dir: string, source: "shared" | "local") =>
      Effect.gen(function* (_) {
        if (!Fs.existsSync(dir)) return
        const entries = Fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => e.isDirectory() && Fs.existsSync(Path.join(dir, e.name, "agent.yml")))

        for (const entry of entries) {
          const agentDir = Path.join(dir, entry.name)
          const manifest = yield* _(loadOneManifest(agentDir))

          if (registry.has(manifest.name)) {
            const existing = registry.get(manifest.name)!
            yield* _(Effect.fail(new DuplicateAgentError({
              name: manifest.name,
              sharedPath: existing.dirPath,
              localPath: manifest.dirPath
            })))
          }

          registry.set(manifest.name, manifest)
        }
      })

    yield* _(addManifest(sharedAgentsDir, "shared"))

    for (const wf of workflows) {
      const wfAgentsDir = Path.join(wf.dir, "agents")
      yield* _(addManifest(wfAgentsDir, "local"))
    }

    return registry
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/workflow/agent-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/agent-registry.ts tests/workflow/agent-registry.test.ts
git commit -m "feat: add agent-registry module with loadAgentManifests, DuplicateAgentError, AgentManifestParseError"
```

---

### Task 4: Update loader.ts — two-pass load, add AgentNotFoundError

**Files:**
- Modify: `src/workflow/loader.ts`
- Modify: `tests/workflow/loader.test.ts`

- [ ] **Step 1: Write the failing test for two-pass load**

Replace the entire `tests/workflow/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec, WorkflowNotFoundError, WorkflowParseError, AgentNotFoundError } from "../../src/workflow/loader.js"

const validYaml = `version: 1
name: test-wf
run:
  entrypoint: t1
  timeout: 300s
tasks:
  - name: t1
    agent:
      executorRef: a1
      prompt:
        content: do it
`

const invalidYaml = `version: not-a-number
name: bad
run:
  entrypoint: t1
  timeout: 300s
tasks:
  - name: t1
    agent:
      executorRef: a1
      prompt:
        content: do it
`

describe("loadWorkflowSpec", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
    const wfDir = Path.join(tmpDir, "workflows", "test-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), validYaml)

    const badDir = Path.join(tmpDir, "workflows", "bad-wf")
    Fs.mkdirSync(badDir, { recursive: true })
    Fs.writeFileSync(Path.join(badDir, "workflow.yml"), invalidYaml)

    const agentsDir = Path.join(tmpDir, "agents")
    const a1Dir = Path.join(agentsDir, "a1")
    Fs.mkdirSync(a1Dir, { recursive: true })
    Fs.writeFileSync(Path.join(a1Dir, "agent.yml"), "name: a1\nsettings:\n  model: default\n")
    Fs.writeFileSync(Path.join(a1Dir, "AGENTS.md"), "test agent")
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  })

  it("loads a valid DAG workflow YAML with agent registry", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const workflows = [{ name: "test-wf", dir: Path.join(tmpDir, "workflows", "test-wf") }]
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "test-wf", agentsDir, workflows))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.name).toBe("test-wf")
      expect(exit.value.version).toBe(1)
      expect(exit.value.run.entrypoint).toBe("t1")
      expect(exit.value.agentRegistry.has("a1")).toBe(true)
      expect(exit.value.tasks).toHaveLength(1)
      expect(exit.value.tasks[0].name).toBe("t1")
    } else {
      expect.unreachable("Expected success but got failure")
    }
  })

  it("fails with WorkflowNotFoundError for nonexistent workflow", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "nonexistent", agentsDir, []))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("WorkflowNotFoundError")
    }
  })

  it("fails with WorkflowParseError for invalid YAML", async () => {
    const agentsDir = Path.join(tmpDir, "agents")
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "bad-wf", agentsDir, []))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("WorkflowParseError")
    }
  })

  it("fails with AgentNotFoundError when executorRef has no matching agent", async () => {
    const wfDir = Path.join(tmpDir, "workflows", "missing-agent-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), `version: 1
name: missing-agent-wf
run:
  entrypoint: t1
  timeout: 300s
tasks:
  - name: t1
    agent:
      executorRef: nonexistent
      prompt:
        content: do it
`)

    const agentsDir = Path.join(tmpDir, "agents")
    const workflows = [{ name: "missing-agent-wf", dir: wfDir }]
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "missing-agent-wf", agentsDir, workflows))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("AgentNotFoundError")
    }
  })
})

describe("resolveWorkflowSpec", () => {
  it("resolves prompt.file by reading file from workflow dir", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const wfDir = Path.join(tmpDir, "prompt-file-wf")
      const promptsDir = Path.join(wfDir, "prompts")
      Fs.mkdirSync(promptsDir, { recursive: true })
      Fs.writeFileSync(Path.join(promptsDir, "my-prompt.md"), "prompt from file")
      const spec = {
        version: 1,
        name: "prompt-file-wf",
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { file: "prompts/my-prompt.md" } } }]
      }
      const resolved = resolveWorkflowSpec(wfDir, spec)
      expect(resolved.tasks[0].agent.prompt.content).toBe("prompt from file")
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("resolves schema.file by reading and parsing JSON from workflow dir", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const wfDir = Path.join(tmpDir, "schema-file-wf")
      const schemasDir = Path.join(wfDir, "schemas")
      Fs.mkdirSync(schemasDir, { recursive: true })
      Fs.writeFileSync(Path.join(schemasDir, "out.json"), JSON.stringify({ type: "object", required: ["status"], properties: { status: { type: "string" } } }))
      const spec = {
        version: 1,
        name: "schema-file-wf",
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { content: "do" }, output: { schema: { file: "schemas/out.json" } } } }]
      }
      const resolved = resolveWorkflowSpec(wfDir, spec)
      expect(resolved.tasks[0].agent.output.schema.content).toEqual({ type: "object", required: ["status"], properties: { status: { type: "string" } } })
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("throws on nonexistent prompt file", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const spec = {
        version: 1,
        name: "bad",
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { file: "nonexistent.md" } } }]
      }
      expect(() => resolveWorkflowSpec(tmpDir, spec)).toThrow("Prompt file not found: nonexistent.md")
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("throws on nonexistent schema file", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const spec = {
        version: 1,
        name: "bad",
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { content: "do" }, output: { schema: { file: "nonexistent.json" } } } }]
      }
      expect(() => resolveWorkflowSpec(tmpDir, spec)).toThrow("Schema file not found: nonexistent.json")
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: FAIL — `loadWorkflowSpec` signature mismatch, `AgentNotFoundError` not exported

- [ ] **Step 3: Rewrite `src/workflow/loader.ts`**

```typescript
import { Effect } from "effect"
import { Schema } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { WorkflowSpec, AgentManifest } from "../types.js"
import { WorkflowSpecSchema } from "../schemas.js"
import { composeVariants } from "./variants.js"
import { loadAgentManifests, type WorkflowDescriptor, DuplicateAgentError, AgentManifestParseError } from "./agent-registry.js"

export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>("WorkflowNotFoundError")("WorkflowNotFoundError", {
  workflowName: Schema.String,
  dir: Schema.String
}) {}

export class WorkflowParseError extends Schema.TaggedError<WorkflowParseError>("WorkflowParseError")("WorkflowParseError", {
  workflowName: Schema.String,
  message: Schema.String
}) {}

export class AgentNotFoundError extends Schema.TaggedError<AgentNotFoundError>("AgentNotFoundError")("AgentNotFoundError", {
  taskName: Schema.String,
  executorRef: Schema.String
}) {}

function walkTasks(tasks: any[]): any[] {
  for (const task of tasks) {
    if (task.tasks && task.tasks.length > 0) walkTasks(task.tasks)
  }
  return tasks
}

export function resolveWorkflowSpec(workflowDir: string, spec: any): any {
  const tasks = walkTasks(spec.tasks)
  for (const task of tasks) {
    if (!task.agent) continue
    if (task.agent.prompt?.file) {
      const promptPath = Path.resolve(workflowDir, task.agent.prompt.file)
      let content: string
      try {
        content = Fs.readFileSync(promptPath, "utf-8")
      } catch {
        throw new Error(`Prompt file not found: ${task.agent.prompt.file}`)
      }
      task.agent.prompt.content = content
    }
    if (task.agent.output?.schema?.file) {
      const schemaPath = Path.resolve(workflowDir, task.agent.output.schema.file)
      let raw: string
      try {
        raw = Fs.readFileSync(schemaPath, "utf-8")
      } catch {
        throw new Error(`Schema file not found: ${task.agent.output.schema.file}`)
      }
      task.agent.output.schema.content = JSON.parse(raw)
    }
  }
  return spec
}

export function loadWorkflowSpec(
  workflowsDir: string,
  workflowName: string,
  sharedAgentsDir: string,
  workflows: WorkflowDescriptor[],
  activeVariants: string[] = []
): Effect.Effect<WorkflowSpec, WorkflowNotFoundError | WorkflowParseError | AgentNotFoundError | DuplicateAgentError | AgentManifestParseError> {
  return Effect.gen(function* (_) {
    const agentRegistry = yield* _(loadAgentManifests(sharedAgentsDir, workflows))

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

    const parsed = yield* _(
      Effect.try({
        try: () => Schema.decodeUnknownSync(WorkflowSpecSchema)(raw),
        catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
      })
    )

    const tasks = walkTasks(parsed.tasks)
    for (const task of tasks) {
      if (task.agent && !agentRegistry.has(task.agent.executorRef)) {
        yield* _(Effect.fail(new AgentNotFoundError({
          taskName: task.name,
          executorRef: task.agent.executorRef
        })))
      }
    }

    const resolved = resolveWorkflowSpec(dir, parsed)
    const composed = composeVariants(resolved as WorkflowSpec, agentRegistry, activeVariants)

    return { ...composed, agentRegistry }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/loader.ts tests/workflow/loader.test.ts
git commit -m "refactor: two-pass workflow load — agent registry first, then workflow.yml without agents key"
```

---

### Task 5: Update variants.ts — use executorRef, remove variant agent injection

**Files:**
- Modify: `src/workflow/variants.ts`
- Modify: `tests/workflow/variants.test.ts`

- [ ] **Step 1: Rewrite `src/workflow/variants.ts`**

Replace `agents: WorkflowAgent[]` in `VariantDefinition` with nothing. Remove all `agents` entries from `VARIANT_REGISTRY`. Change all `ref:` to `executorRef:`. Change `composeVariants` signature to take `agentRegistry` instead of using `spec.agents`, and remove the agent-merging block at the end.

```typescript
import { Data } from "effect"

import type { WorkflowSpec, WorkflowTask, VariantTask, AgentManifest } from "../types.js"

export class UnsupportedVariantError extends Data.TaggedError("UnsupportedVariantError")<{
  variant: string
  supported: string[]
}> {}

interface VariantDefinition {
  tasks: VariantTask[]
}

export const VARIANT_REGISTRY: Record<string, VariantDefinition> = {
  branchout: {
    tasks: [
      {
        placement: "start",
        capabilities: { provides: ["workspace-created"], replaces: [] },
        task: {
          name: "create-branch",
          agent: {
            executorRef: "setup",
            prompt: {
              content: "Run the following commands:\n1. cd {{tasks.plan.outputs.repo}}\n2. git checkout -b {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done"
            }
          }
        }
      }
    ]
  },
  worktree: {
    tasks: [
      {
        placement: "start",
        capabilities: { provides: ["workspace-created"], replaces: ["workspace-created"] },
        task: {
          name: "create-worktree",
          agent: {
            executorRef: "setup",
            prompt: {
              content: "Create an isolated git worktree.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nDeterministic activity: createGitWorktree\n\nReply with STATUS: done, WORKTREE_PATH: <path>, ORIGINAL_BRANCH: <branch>"
            }
          }
        }
      },
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "cleanup-worktree",
          agent: {
            executorRef: "setup",
            prompt: {
              content: "Clean up the worktree.\n\nREPO: {{tasks.plan.outputs.repo}}\n\nDeterministic activity: cleanupGitWorktree\n\nReply with STATUS: done"
            }
          }
        }
      }
    ]
  },
  merge: {
    tasks: [
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "finalize-merge",
          agent: {
            executorRef: "setup",
            prompt: {
              content: "Finalize by squashing changes and merging.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done"
            }
          }
        }
      }
    ]
  },
  github_pr: {
    tasks: [
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "create-pr",
          agent: {
            executorRef: "developer",
            prompt: {
              content: "Create a pull request.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done, PR: <url>"
            }
          }
        }
      },
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "review",
          agent: {
            executorRef: "verifier",
            prompt: {
              content: "Review the PR.\n\nPR: {{pr}}\n\nReply with STATUS: done, DECISION: approved"
            }
          }
        }
      }
    ]
  }
}

export function composeVariants(
  spec: WorkflowSpec,
  agentRegistry: Map<string, AgentManifest>,
  activeVariants: string[]
): WorkflowSpec {
  if (activeVariants.length === 0) return spec

  const supported = spec.variants?.supported ?? []
  for (const v of activeVariants) {
    if (!supported.includes(v)) {
      throw new UnsupportedVariantError({ variant: v, supported })
    }
  }

  const orderedBySupported = supported.filter(v => activeVariants.includes(v))

  const startTasks: VariantTask[] = []
  const endTasks: VariantTask[] = []

  for (const v of orderedBySupported) {
    const def = VARIANT_REGISTRY[v]
    if (!def) continue
    for (const vt of def.tasks) {
      if (vt.placement === "start") startTasks.push(vt)
      else endTasks.push(vt)
    }
  }

  const replacedCapabilities: string[] = []

  const allVariantTasks = [...startTasks, ...endTasks]
  for (const vt of allVariantTasks) {
    replacedCapabilities.push(...vt.capabilities.replaces)
  }

  const kept: VariantTask[] = []
  for (const vt of allVariantTasks) {
    const isReplaced = vt.capabilities.provides.some(p => replacedCapabilities.includes(p))
    const isReplacer = vt.capabilities.replaces.length > 0
    if (isReplaced && !isReplacer) continue
    kept.push(vt)
  }

  const keptStart = kept.filter(vt => vt.placement === "start")
  const keptEnd = kept.filter(vt => vt.placement === "end")

  const composedTasks: WorkflowTask[] = [...spec.tasks]
  const startTaskDefs: { task: WorkflowTask; name: string }[] = []

  if (keptStart.length > 0) {
    let prevName: string | null = null
    for (const vt of keptStart) {
      const task: WorkflowTask = { ...vt.task, dependencies: [] }
      if (prevName) {
        task.dependencies = [prevName]
      }
      startTaskDefs.push({ task, name: vt.task.name })
      prevName = vt.task.name
    }
    const entryTask = composedTasks.find(t => t.name === spec.run.entrypoint)
    if (entryTask && prevName) {
      entryTask.dependencies = [...(entryTask.dependencies ?? []), prevName]
    }
    composedTasks.unshift(...startTaskDefs.map(s => s.task))
  }

  if (keptEnd.length > 0) {
    const dependents = new Set<string>()
    for (const t of composedTasks) {
      for (const dep of t.dependencies ?? []) {
        dependents.add(dep)
      }
    }
    const leaves = composedTasks.filter(t => !dependents.has(t.name))
    const leafNames = leaves.map(t => t.name)

    let prevName: string | null = null
    for (const vt of keptEnd) {
      const task: WorkflowTask = { ...vt.task, dependencies: [] }
      if (prevName) {
        task.dependencies = [prevName]
      } else {
        task.dependencies = [...leafNames]
      }
      composedTasks.push(task)
      prevName = vt.task.name
    }
  }

  return { ...spec, tasks: composedTasks }
}
```

- [ ] **Step 2: Update `tests/workflow/variants.test.ts`**

```typescript
import { describe, it, expect } from "vitest"
import { composeVariants, UnsupportedVariantError } from "../../src/workflow/variants.js"
import type { WorkflowSpec, WorkflowTask, AgentManifest } from "../../src/types.js"

function baseSpec(tasks: WorkflowTask[]): WorkflowSpec {
  return {
    version: 1,
    name: "test-wf",
    run: { entrypoint: "plan", timeout: "300s" },
    variants: { supported: ["branchout", "worktree", "merge"] },
    agentRegistry: new Map<string, AgentManifest>([
      ["setup", { name: "setup", dirPath: "/agents/setup", settings: { model: "default" }, systemPrompt: { agent: "", soul: "", identity: "" } }]
    ]),
    tasks
  }
}

const baseRegistry = new Map<string, AgentManifest>([
  ["setup", { name: "setup", dirPath: "/agents/setup", settings: { model: "default" }, systemPrompt: { agent: "", soul: "", identity: "" } }]
])

describe("composeVariants", () => {
  it("returns base spec unchanged when no variants active", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, baseRegistry, [])
    expect(result.tasks.map(t => t.name)).toEqual(["plan"])
  })

  it("injects start task before entrypoint", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, baseRegistry, ["branchout"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-branch", "plan"])
  })

  it("injects end task after DAG leaves", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, baseRegistry, ["merge"])
    expect(result.tasks.map(t => t.name)).toEqual(["plan", "finalize-merge"])
  })

  it("applies replaces: worktree supersedes branchout", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, baseRegistry, ["branchout", "worktree"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree"])
  })

  it("chains multiple end tasks in supported order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, baseRegistry, ["merge", "worktree"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree", "finalize-merge"])
  })

  it("throws on unsupported variant", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    expect(() => composeVariants(spec, baseRegistry, ["nope"])).toThrow(UnsupportedVariantError)
  })

  it("respects supported order, not CLI order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, baseRegistry, ["worktree", "branchout"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree"])
  })

  it("does not mutate input spec", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const originalTaskCount = spec.tasks.length
    composeVariants(spec, baseRegistry, ["merge"])
    expect(spec.tasks.length).toBe(originalTaskCount)
  })

  it("handles DAG with branching leaves", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } },
      { name: "task-a", dependencies: ["plan"], agent: { executorRef: "setup", prompt: { content: "" } } },
      { name: "task-b", dependencies: ["plan"], agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, baseRegistry, ["merge"])
    expect(result.tasks.map(t => t.name)).toEqual(["plan", "task-a", "task-b", "finalize-merge"])
    const mergeTask = result.tasks.find(t => t.name === "finalize-merge")
    expect(mergeTask!.dependencies).toEqual(["task-a", "task-b"])
  })
})
```

- [ ] **Step 3: Run tests to verify**

Run: `bun --bun vitest run tests/workflow/variants.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/workflow/variants.ts tests/workflow/variants.test.ts
git commit -m "refactor: variants use executorRef, remove variant agent injection"
```

---

### Task 6: Update runner.ts — use agentRegistry, remove shared-agents

**Files:**
- Modify: `src/workflow/runner.ts`
- Modify: `tests/workflow/runner.test.ts`
- Delete: `src/workflow/shared-agents.ts`
- Delete: `tests/workflow/shared-agents.test.ts`

- [ ] **Step 1: Update runner.ts — replace agent resolution and remove symlink import**

In `src/workflow/runner.ts`:

1. Remove import of `ensureSharedAgentsSymlink` (line 21)
2. Remove the call `yield* _(ensureSharedAgentsSymlink(workflowDir))` (line 50)
3. Replace lines 94-96:

```typescript
const agentName = task.agent.ref.replace("agents.", "")
const agent = spec.agents.find(a => a.name === agentName)
if (!agent) return
```

with:

```typescript
const agent = spec.agentRegistry.get(task.agent.executorRef)
if (!agent) return
```

4. Replace `agent.settings.systemPrompt` in `resolvePersona` call (line 104) — now the systemPrompt comes from `agent.systemPrompt` (resolved by the registry), and paths resolve relative to `agent.dirPath`:

```typescript
const persona = yield* _(
  resolvePersona(agent.systemPrompt, agent.dirPath).pipe(
    Effect.mapError((e) => new Error(e.agentPath))
  )
)
```

- [ ] **Step 2: Update `tests/workflow/runner.test.ts`**

Key changes:
- Remove `agents:` from `makeSpec()` — add `agentRegistry` instead
- Change all `ref: "agents.xxx"` to `executorRef: "xxx"`
- Remove the `shared/agents symlink verification` describe block entirely

Replace `makeSpec`:

```typescript
const makeAgentManifest = (name: string): AgentManifest => ({
  name,
  dirPath: `/agents/${name}`,
  settings: { model: "default" },
  systemPrompt: { agent: `${name}/AGENTS.md`, soul: `${name}/SOUL.md`, identity: `${name}/IDENTITY.md` }
})

const makeSpec = (overrides?: Partial<WorkflowSpec>): WorkflowSpec => ({
  version: 1,
  name: "test-flow",
  run: { entrypoint: "plan", timeout: "300s" },
  agentRegistry: new Map([
    ["planner", makeAgentManifest("planner")],
    ["coder", makeAgentManifest("coder")]
  ]),
  tasks: [
    { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan the feature" } } },
    { name: "implement", dependencies: ["plan"], agent: { executorRef: "coder", prompt: { content: "Implement it" } } }
  ],
  ...overrides
})
```

Add import for `AgentManifest` type. Change all `ref:` to `executorRef:` in test data. Remove the bottom `describe("shared/agents symlink verification")` block entirely.

- [ ] **Step 3: Delete shared-agents files**

```bash
rm src/workflow/shared-agents.ts tests/workflow/shared-agents.test.ts
```

- [ ] **Step 4: Run runner tests**

Run: `bun --bun vitest run tests/workflow/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/runner.test.ts
git rm src/workflow/shared-agents.ts tests/workflow/shared-agents.test.ts
git commit -m "refactor: runner uses agentRegistry for agent resolution, remove shared-agents symlink module"
```

---

### Task 7: Update remaining test files

**Files:**
- Modify: `tests/types.test.ts`
- Modify: `tests/schemas.test.ts`
- Modify: `tests/workflow/run-state-machine.test.ts`
- Modify: `tests/workflow/runner-regression.test.ts`
- Modify: `tests/e2e/workflows.test.ts`
- Modify: `tests/cli/run.test.ts`
- Modify: `tests/fixtures/feature-dev.yml`

- [ ] **Step 1: Update `tests/types.test.ts`**

- Remove `AgentRole`, `WorkflowAgent` imports — add `AgentManifest` import
- Change `WorkflowAgent` object literal to `AgentManifest`
- Change `ref: "agents.planner"` to `executorRef: "planner"`
- Remove `role` from agent data
- Change `WorkflowSpec` literal: `agents: [agent]` → `agentRegistry: new Map([["planner", agent]])`

- [ ] **Step 2: Update `tests/schemas.test.ts`**

- Remove `agents:` from all test raw objects
- Change all `ref:` to `executorRef:` 
- Remove the "rejects a workflow with no agents" test (no longer applicable)
- Remove the "rejects an invalid agent role" test (no longer applicable)
- Update `tests/fixtures/feature-dev.yml`: remove `agents:` key, change `ref:` to `executorRef:`

- [ ] **Step 3: Update `tests/workflow/run-state-machine.test.ts`**

- Remove `agents:` from `makeSpec()` — add `agentRegistry` Map
- Change `ref:` to `executorRef:` in all tasks

- [ ] **Step 4: Update `tests/workflow/runner-regression.test.ts`**

- Remove `agents:` from `testSpec`
- Change `ref:` to `executorRef:`
- Add `agentRegistry` to spec

- [ ] **Step 5: Update `tests/e2e/workflows.test.ts`**

- Remove `agents:` from spec object
- Change `ref:` to `executorRef:`
- Add `agentRegistry` Map

- [ ] **Step 6: Update `tests/cli/run.test.ts`**

- Remove `agents:` section from `validYaml` string
- Change `ref:` to `executorRef:`

- [ ] **Step 7: Run full test suite**

Run: `bun --bun vitest run`
Expected: All tests pass (some will fail until manifest files are migrated — those are covered in Task 8)

- [ ] **Step 8: Commit**

```bash
git add tests/
git commit -m "refactor: update all test files — remove agents key, use executorRef, add agentRegistry"
```

---

### Task 8: Update `src/cli/commands/run.ts` and `src/agent/config.ts`

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/agent/config.ts`

- [ ] **Step 1: Update `src/cli/commands/run.ts`**

Change the `executeRun` function to load agent manifests before loading the workflow spec. The `loadWorkflowSpec` signature now takes `sharedAgentsDir` and `workflows` list.

```typescript
import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Exit, Scope } from "effect"
import * as Fs from "node:fs"
import { workflowsDir, hamiltonHome, runDir } from "../../paths.js"
import { resolveWorkflowSlug } from "../../workflow/resolver.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow } from "../../workflow/runner.js"
import type { WorkflowSpec as WfSpec } from "../../types.js"
import { EventBus, EventBusLive } from "../../events/bus.js"
import { FileLogger } from "../../observability/subscribers.js"
import { CliRenderer } from "../subscribers.js"

export interface RunParams {
  workflowSlug: string
  prompt: string
  variants?: string
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
}

function discoverWorkflows(wfDir: string): { name: string; dir: string }[] {
  if (!Fs.existsSync(wfDir)) return []
  return Fs.readdirSync(wfDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, dir: `${wfDir}/${e.name}` }))
}

export function executeRun(params: RunParams): Effect.Effect<RunResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new Error('Hamilton is not initialized. Run "hamilton init" first.')))
    }
    const wfDir = workflowsDir()
    const sharedAgentsDir = Path.join(hamiltonHome(), "agents")
    const availableSlugs = yield* _(
      Effect.try({
        try: () => {
          if (!Fs.existsSync(wfDir)) return [] as string[]
          return Fs.readdirSync(wfDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        },
        catch: () => [] as string[]
      }).pipe(Effect.orElseSucceed(() => [] as string[]))
    )

    const activeVariants = params.variants
      ? params.variants.split(",").map(v => v.trim()).filter(v => v.length > 0)
      : []

    const resolvedSlug = resolveWorkflowSlug(params.workflowSlug, new Set(availableSlugs))
    const workflowDescriptors = discoverWorkflows(wfDir)
    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug, sharedAgentsDir, workflowDescriptors, activeVariants)

    const result = yield* _(
      runWorkflow(spec as unknown as WfSpec, { task: params.prompt }, {
        workflowsDir: wfDir
      }).pipe(
        Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
      )
    )

    return {
      runId: result.runId,
      status: result.status,
      taskResults: result.taskResults
    }
  })
}

import * as Path from "node:path"

const slug = Args.text({ name: "slug" })
const prompt = Args.text({ name: "prompt" }).pipe(Args.repeated)
const variants = Options.text("variants").pipe(Options.optional)

export const runCommand = Command.make("run", { slug, prompt, variants }, ({ slug, prompt, variants }) =>
  Effect.gen(function* () {
    const promptText = prompt.join(" ")
    const result = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          return yield* executeRun({ workflowSlug: slug, prompt: promptText, variants: variants._tag === "Some" ? variants.value : undefined })
        })
      ).pipe(Effect.provide(EventBusLive))
    )
    if (Exit.isFailure(result)) {
      yield* Console.error(`Workflow failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Run ID: ${result.value.runId}`)
    yield* Console.log(`Status: ${result.value.status}`)
    for (const [step, status] of Object.entries(result.value.taskResults)) {
      yield* Console.log(`  ${step}: ${status}`)
    }
  })
).pipe(Command.withDescription("Run a workflow"))
```

- [ ] **Step 2: Update `src/agent/config.ts`**

Change `AgentSettings` import to `AgentManifestSettings`:

```typescript
import type { AgentManifestSettings } from "../types.js"

export interface ResolvedDefaults {
  model: string
  systemPrompt: AgentManifestSettings["systemPrompt"]
  skills: string[] | null
}

export function resolveAgentDefaults(settings: AgentManifestSettings): ResolvedDefaults {
  return {
    model: settings.model ?? "default",
    systemPrompt: settings.systemPrompt ?? { agent: "", soul: "", identity: "" },
    skills: settings.skills ?? null
  }
}
```

The rest of the file (`loadModelAliases`, `resolveModelAlias`, `CircularModelAliasError`) stays the same.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/run.ts src/agent/config.ts
git commit -m "refactor: update run command and agent config for new agent registry"
```

---

### Task 9: Update `src/prompts/persona.ts` — path resolution from agent dir

**Files:**
- Modify: `src/prompts/persona.ts`

- [ ] **Step 1: Change resolvePersona to accept agentDir**

The `resolvePersona` function currently resolves paths relative to `workflowDir`. Now it should resolve relative to `agentDir` (the `dirPath` from the manifest). The function signature and behavior are identical except the base directory changes.

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

function tryReadOptional(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

export function resolvePersona(
  paths: SystemPromptPaths,
  agentDir: string
): Effect.Effect<Persona, PersonaNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(agentDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => {
          if (!paths.agent) return ""
          return Fs.readFileSync(resolvePath(paths.agent), "utf-8")
        },
        catch: () => new PersonaNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = paths.soul ? tryReadOptional(resolvePath(paths.soul)) : ""
    const identity = paths.identity ? tryReadOptional(resolvePath(paths.identity)) : ""

    return { agent, soul, identity }
  })
}
```

This handles the case where `systemPrompt.agent` is empty string (agent exists with no persona file).

- [ ] **Step 2: Commit**

```bash
git add src/prompts/persona.ts
git commit -m "refactor: resolvePersona uses agentDir instead of workflowDir"
```

---

### Task 10: Migrate manifest files — create agent.yml files, update workflow.yml files

**Files:**
- Create: 4 shared `manifest/agents/*/agent.yml` files
- Create: 14 workflow-local `manifest/workflows/*/agents/*/agent.yml` files
- Modify: 6 `manifest/workflows/*/workflow.yml` files

- [ ] **Step 1: Create shared agent.yml files**

`manifest/agents/do/agent.yml`:
```yaml
name: do
settings:
  model: default
```

`manifest/agents/pr/agent.yml`:
```yaml
name: pr
settings:
  model: default
```

`manifest/agents/setup/agent.yml`:
```yaml
name: setup
settings:
  model: default
  skills:
    - hamilton-agents
```

`manifest/agents/verifier/agent.yml`:
```yaml
name: verifier
settings:
  model: default
  skills:
    - hamilton-agents
```

- [ ] **Step 2: Create workflow-local agent.yml files**

Each workflow's agents get their own `agent.yml`. For each, extract the `name`, `settings.model`, and `settings.skills` from the current `workflow.yml` `agents:` section. All have sibling AGENTS.md/SOUL.md/IDENTITY.md so systemPrompt defaults apply.

For `manifest/workflows/feature-dev/agents/planner/agent.yml`:
```yaml
name: planner
settings:
  model: deepseek-v4-pro-official
  skills:
    - hamilton-agents
```

For `manifest/workflows/feature-dev/agents/developer/agent.yml`:
```yaml
name: developer
settings:
  model: default
  skills:
    - hamilton-agents
```

For `manifest/workflows/feature-dev/agents/tester/agent.yml`:
```yaml
name: tester
settings:
  model: default
  skills:
    - hamilton-agents
```

For `manifest/workflows/bug-fix/agents/triager/agent.yml`:
```yaml
name: triager
settings:
  model: default
```

For `manifest/workflows/bug-fix/agents/investigator/agent.yml`:
```yaml
name: investigator
settings:
  model: default
```

For `manifest/workflows/bug-fix/agents/fixer/agent.yml`:
```yaml
name: fixer
settings:
  model: default
```

For `manifest/workflows/security-audit/agents/scanner/agent.yml`:
```yaml
name: scanner
settings:
  model: default
```

For `manifest/workflows/security-audit/agents/prioritizer/agent.yml`:
```yaml
name: prioritizer
settings:
  model: default
```

For `manifest/workflows/security-audit/agents/fixer/agent.yml`:
```yaml
name: fixer
settings:
  model: default
```

(Note: `security-audit/agents/fixer` is different from `bug-fix/agents/fixer` — different directories)

For `manifest/workflows/security-audit/agents/tester/agent.yml`:
```yaml
name: tester
settings:
  model: default
```

Similarly different from `feature-dev/agents/tester`.

For `manifest/workflows/quarantine-broken-tests/agents/quarantiner/agent.yml`:
```yaml
name: quarantiner
settings:
  model: default
```

For `manifest/workflows/quarantine-broken-tests/agents/verifier/agent.yml`:
```yaml
name: verifier
settings:
  model: default
```

For `manifest/workflows/greenfield/agents/scaffolder/agent.yml`:
```yaml
name: scaffolder
settings:
  model: default
```

For `manifest/workflows/do/agents/doer/agent.yml`:
```yaml
name: doer
settings:
  model: default
```

- [ ] **Step 3: Update all 6 workflow.yml files**

For each `manifest/workflows/*/workflow.yml`:
1. Remove the top-level `agents:` key and its contents entirely
2. Change every `ref: agents.xxx` to `executorRef: xxx` (stripping `agents.` prefix)
3. Bump `version` number

For `manifest/workflows/do/workflow.yml`:
```yaml
name: do
version: 2
description: |
  Single general-purpose agent that takes an arbitrary task description
  and executes it end-to-end — plans, executes, and reports results.
  For quick tasks that don't need a full multi-step pipeline.
run:
  entrypoint: execute
  timeout: 300s

tasks:
  - name: execute
    dependencies: []
    agent:
      executorRef: doer
      prompt:
        content: |
          Execute the following task end-to-end.

          TASK:
          {{task}}

          Instructions:
          1. Understand the task completely
          2. Plan your approach before starting
          3. Execute the plan step by step
          4. Verify the result matches the task requirements
          5. Report what you did

          Reply with:
          STATUS: done
          RESULT: Summary of what was accomplished
          CHANGES: What files or changes were made
      output:
        schema:
          file: schemas/execute.json
    on_failure:
      max_retries: 4
      escalate_to: human
```

Apply the same pattern (remove `agents:`, change `ref:` to `executorRef:`, bump version) to all other workflows: `feature-dev`, `bug-fix`, `security-audit`, `quarantine-broken-tests`, `greenfield`.

- [ ] **Step 4: Run build**

Run: `bun run build`
Expected: PASS (no type errors)

- [ ] **Step 5: Commit**

```bash
git add manifest/
git commit -m "feat: create agent.yml manifests for all shared and workflow-local agents, update workflow.yml files"
```

---

### Task 11: Fix name collisions across workflow-local agents

**Files:**
- Modify: `manifest/workflows/security-audit/agents/fixer/agent.yml` (rename to `sec-fixer`)
- Modify: `manifest/workflows/security-audit/agents/tester/agent.yml` (rename to `sec-tester`)
- Modify: `manifest/workflows/quarantine-broken-tests/agents/verifier/agent.yml` (rename to `qa-verifier`)
- Modify: corresponding `workflow.yml` files and directory names

There are name collisions across workflow-local agents that must be resolved since agent names must be globally unique:

- `fixer` exists in both `bug-fix` and `security-audit`
- `tester` exists in both `feature-dev` and `security-audit`
- `verifier` exists as shared agent AND in `quarantine-broken-tests`

- [ ] **Step 1: Rename conflicting workflow-local agents**

Rename directories and agent.yml name fields:
- `manifest/workflows/security-audit/agents/fixer/` → `sec-fixer/`
- `manifest/workflows/security-audit/agents/tester/` → `sec-tester/`
- `manifest/workflows/quarantine-broken-tests/agents/verifier/` → `qa-verifier/`

Update the `name:` field inside each `agent.yml` to match the new directory name.

- [ ] **Step 2: Update executorRefs in affected workflow.yml files**

In `manifest/workflows/security-audit/workflow.yml`: change `executorRef: fixer` to `executorRef: sec-fixer`, change `executorRef: tester` to `executorRef: sec-tester`.

In `manifest/workflows/quarantine-broken-tests/workflow.yml`: change `executorRef: verifier` to `executorRef: qa-verifier`.

- [ ] **Step 3: Commit**

```bash
git add manifest/
git commit -m "fix: rename conflicting workflow-local agents to ensure global uniqueness"
```

---

### Task 12: Build, full test suite, verify

**Files:**
- None (verification only)

- [ ] **Step 1: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit if any fixes needed**

If any test fixes are needed, commit them:

```bash
git add -A
git commit -m "fix: resolve remaining test failures after agent manifest migration"
```