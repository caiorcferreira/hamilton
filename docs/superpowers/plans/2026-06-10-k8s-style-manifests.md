# K8s-Style Manifests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor all Hamilton YAML manifests to use k8s-style envelope structure (apiVersion, kind, metadata, spec) with runtime dispatch on `kind`.

**Architecture:** A `parseManifest()` function validates the envelope first, then dispatches to kind-specific `@effect/schema` decoders. All types get restructured to nest identity fields under `metadata` and behavior fields under `spec`. Downstream code updates field access paths accordingly.

**Tech Stack:** TypeScript, Effect-TS, @effect/schema, bun:sqlite, vitest

---

### Task 1: Add `InvalidManifestEnvelopeError` to schemas.ts

**Files:**
- Modify: `src/schemas.ts`
- Modify: `src/workflow/loader.ts`

- [ ] **Step 1: Add InvalidManifestEnvelopeError and envelope schema to src/schemas.ts**

Add these exports at the top of `src/schemas.ts`, after the existing imports:

```typescript
import { Data } from "effect"

export class InvalidManifestEnvelopeError extends Data.TaggedError("InvalidManifestEnvelopeError")<{
  message: string
}> {}

const ApiVersionSchema = Schema.Literal("dag.hamilton.io/v1alpha1")

const KindSchema = Schema.Literal("Agent", "Workflow")

const AgentMetadataSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String)
})

const WorkflowMetadataSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.Number,
  description: Schema.optional(Schema.String)
})

const ManifestEnvelopeSchema = Schema.Struct({
  apiVersion: ApiVersionSchema,
  kind: KindSchema,
  metadata: Schema.Union(AgentMetadataSchema, WorkflowMetadataSchema)
})
```

- [ ] **Step 2: Add `parseManifest()` to src/schemas.ts**

Add at the bottom of `src/schemas.ts`:

```typescript
export function parseManifest(raw: unknown): AgentManifest | WorkflowSpec {
  const envelope = Schema.decodeUnknownSync(ManifestEnvelopeSchema)(raw)
  if (envelope.kind === "Agent") {
    return Schema.decodeUnknownSync(AgentManifestK8sSchema)(raw)
  }
  return Schema.decodeUnknownSync(WorkflowSpecK8sSchema)(raw)
}
```

This function will not compile yet — the k8s schemas are defined in Task 2. That's expected.

- [ ] **Step 3: Run build to verify no syntax errors in existing code**

Run: `bun run build`
Expected: Build fails on `parseManifest` referencing `AgentManifestK8sSchema` and `WorkflowSpecK8sSchema` which don't exist yet. That's fine — we're building incrementally. The existing schemas still work.

- [ ] **Step 4: Commit**

```bash
git add src/schemas.ts
git commit -m "feat: add InvalidManifestEnvelopeError, envelope schema, parseManifest stub"
```

---

### Task 2: Restructure AgentManifestSchema for k8s envelope

**Files:**
- Modify: `src/schemas.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing test in tests/schemas.test.ts**

Add a new `describe` block after the existing `WorkflowSpecSchema` tests:

```typescript
import { AgentManifestSchema as AgentManifestK8sSchema } from "../src/schemas.js"

describe("AgentManifestSchema (k8s envelope)", () => {
  it("parses a valid agent manifest with envelope", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Agent",
      metadata: { name: "planner" },
      spec: {
        settings: { model: "default" }
      }
    }
    const spec = Schema.decodeUnknownSync(AgentManifestK8sSchema)(raw)
    expect(spec.metadata.name).toBe("planner")
    expect(spec.spec.settings.model).toBe("default")
  })

  it("rejects unknown apiVersion", () => {
    const raw = {
      apiVersion: "bad.io/v1",
      kind: "Agent",
      metadata: { name: "planner" },
      spec: { settings: {} }
    }
    expect(() => Schema.decodeUnknownSync(AgentManifestK8sSchema)(raw)).toThrow()
  })

  it("rejects wrong kind", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Pod",
      metadata: { name: "planner" },
      spec: { settings: {} }
    }
    expect(() => Schema.decodeUnknownSync(AgentManifestK8sSchema)(raw)).toThrow()
  })

  it("parses agent with skills and systemPrompt", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Agent",
      metadata: { name: "developer", description: "Writes code" },
      spec: {
        settings: { model: "default", skills: ["hamilton-agents"] },
        systemPrompt: { agent: "AGENTS.md", soul: "SOUL.md", identity: "IDENTITY.md" }
      }
    }
    const spec = Schema.decodeUnknownSync(AgentManifestK8sSchema)(raw)
    expect(spec.metadata.name).toBe("developer")
    expect(spec.metadata.description).toBe("Writes code")
    expect(spec.spec.settings.skills).toEqual(["hamilton-agents"])
    expect(spec.spec.systemPrompt?.agent).toBe("AGENTS.md")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/schemas.test.ts`
Expected: FAIL — `AgentManifestK8sSchema` does not exist yet.

- [ ] **Step 3: Restructure AgentManifestSchema in src/schemas.ts**

Replace the existing `AgentManifestSchema` and its sub-schemas with:

```typescript
const AgentManifestSettingsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(Schema.String))
})

export const AgentManifestSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamilton.io/v1alpha1"),
  kind: Schema.Literal("Agent"),
  metadata: AgentMetadataSchema,
  spec: Schema.Struct({
    settings: AgentManifestSettingsSchema,
    systemPrompt: Schema.optional(SystemPromptPathsSchema)
  })
})
```

Remove the old `AgentManifestSettingsSchema` that had `systemPrompt` nested under it. The `SystemPromptPathsSchema` stays as-is.

Also update the `parseManifest()` stub from Task 1 to reference `AgentManifestSchema` (the renamed symbol):

```typescript
export function parseManifest(raw: unknown): any {
  const envelope = Schema.decodeUnknownSync(ManifestEnvelopeSchema)(raw)
  if (envelope.kind === "Agent") {
    return Schema.decodeUnknownSync(AgentManifestSchema)(raw)
  }
  return Schema.decodeUnknownSync(WorkflowSpecSchema)(raw)
}
```

- [ ] **Step 4: Update src/types.ts — restructure AgentManifest**

Replace the existing `AgentManifestSettings` and `AgentManifest` interfaces:

```typescript
export interface AgentManifestSettings {
  model?: string
  skills?: string[]
}

export interface AgentManifest {
  metadata: {
    name: string
    description?: string
  }
  dirPath: string
  spec: {
    settings: AgentManifestSettings
    systemPrompt?: SystemPromptPaths
  }
  systemPrompt: SystemPromptPaths
}
```

Note: `dirPath` and top-level `systemPrompt` remain derived (added at load time, not in YAML). `metadata.name` replaces `name`, `spec.settings` replaces `settings`, `spec.systemPrompt` replaces `settings.systemPrompt`.

- [ ] **Step 5: Run build to check type consistency**

Run: `bun run build`
Expected: Build may fail on downstream files that access `agent.name`, `agent.settings`, `agent.settings.systemPrompt`. That's expected — we fix those in Task 6. For now, just verify schemas.ts and types.ts compile cleanly by checking that the only errors are in downstream files.

- [ ] **Step 6: Commit**

```bash
git add src/schemas.ts src/types.ts tests/schemas.test.ts
git commit -m "feat: restructure AgentManifest for k8s envelope, add schema tests"
```

---

### Task 3: Restructure WorkflowSpecSchema for k8s envelope

**Files:**
- Modify: `src/schemas.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing tests in tests/schemas.test.ts**

Update the existing `WorkflowSpecSchema` tests to use k8s envelope. Replace all raw YAML objects with the envelope structure. Also add new tests for envelope validation.

The existing `validYaml`-style tests all need to wrap their raw objects:

```typescript
describe("WorkflowSpecSchema (k8s envelope)", () => {
  it("parses a valid DAG workflow YAML", () => {
    const yaml = Fs.readFileSync(
      Path.join(import.meta.dirname, "fixtures", "feature-dev.yml"),
      "utf-8"
    )
    const raw = Yaml.parse(yaml)
    const spec = decode(raw)
    expect(spec.metadata.version).toBeDefined()
    expect(spec.metadata.name).toBe("feature-dev")
    expect(spec.spec.run.entrypoint).toBe("plan")
    expect(spec.spec.run.timeout).toBe("300s")
    expect(spec.spec.tasks).toHaveLength(4)
    expect(spec.spec.tasks[0].name).toBe("plan")
  })

  it("rejects a workflow with missing run.entrypoint", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { name: "bad", version: 1 },
      spec: {
        run: { timeout: "300s" },
        tasks: [{ name: "t", agent: { executorRef: "a", prompt: { content: "do" } } }]
      }
    }
    expect(() => decode(raw)).toThrow()
  })

  it("allows a task with only name when it has nested tasks", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { name: "ok", version: 1 },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [
          { name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } },
          { name: "t2", tasks: [{ name: "sub", agent: { executorRef: "a", prompt: { content: "x" } } }] }
        ]
      }
    }
    const spec = decode(raw)
    expect(spec.spec.tasks).toHaveLength(2)
  })

  it("allows a task with template reference", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { name: "ok", version: 1 },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [
          { name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } },
          { name: "t2", template: "t1" }
        ]
      }
    }
    const spec = decode(raw)
    expect(spec.spec.tasks[1].template).toBe("t1")
  })

  it("rejects a template reference to nonexistent task", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { name: "bad", version: 1 },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [
          { name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } },
          { name: "t2", template: "nonexistent" }
        ]
      }
    }
    expect(() => decode(raw)).toThrow()
  })

  it("rejects unknown apiVersion", () => {
    const raw = {
      apiVersion: "bad.io/v1",
      kind: "Workflow",
      metadata: { name: "test", version: 1 },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [{ name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } }]
      }
    }
    expect(() => decode(raw)).toThrow()
  })

  it("rejects wrong kind", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Agent",
      metadata: { name: "test", version: 1 },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [{ name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } }]
      }
    }
    expect(() => decode(raw)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/schemas.test.ts`
Expected: FAIL — schema doesn't expect envelope structure yet.

- [ ] **Step 3: Restructure WorkflowSpecSchema in src/schemas.ts**

Replace the existing `WorkflowSpecSchema` with the k8s envelope version:

```typescript
export const WorkflowSpecSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamilton.io/v1alpha1"),
  kind: Schema.Literal("Workflow"),
  metadata: WorkflowMetadataSchema,
  spec: Schema.Struct({
    run: RunConfigSchema,
    variants: Schema.optional(VariantsConfigSchema),
    tasks: Schema.Array(WorkflowTaskSchema)
  })
}).pipe(
  Schema.filter(
    (spec: any) => {
      const taskNames = new Set(spec.spec.tasks.map((t: any) => t.name))
      let valid = true
      for (const task of spec.spec.tasks) {
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

Note: The `Schema.filter` now accesses `spec.spec.tasks` instead of `spec.tasks`.

- [ ] **Step 4: Update src/types.ts — restructure WorkflowSpec**

Replace the existing `WorkflowSpec` interface:

```typescript
export interface WorkflowSpec {
  metadata: {
    version: number
    name: string
    description?: string
  }
  spec: {
    run: RunConfig
    variants?: {
      supported: string[]
    }
    tasks: WorkflowTask[]
  }
  agentRegistry: Map<string, AgentManifest>
}
```

- [ ] **Step 5: Run build to check type consistency**

Run: `bun run build`
Expected: Many downstream type errors from field access changes. That's expected — we fix those in Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/schemas.ts src/types.ts tests/schemas.test.ts
git commit -m "feat: restructure WorkflowSpec for k8s envelope, add envelope validation tests"
```

---

### Task 4: Update agent-registry.ts for k8s agent manifest

**Files:**
- Modify: `src/workflow/agent-registry.ts`
- Modify: `tests/workflow/agent-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Update the `makeAgentYaml` helper in `tests/workflow/agent-registry.test.ts` to produce k8s-style YAML:

```typescript
function makeAgentYaml(dir: string, name: string, settings?: Record<string, unknown>) {
  Fs.mkdirSync(dir, { recursive: true })
  const settingsYaml = settings
    ? Object.entries(settings).map(([k, v]) => `    ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")
    : "    model: default"
  const yaml = `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  settings:\n${settingsYaml}\n`
  Fs.writeFileSync(Path.join(dir, "agent.yml"), yaml)
}
```

Update all assertions that access `manifest.name` → `manifest.metadata.name`, `manifest.settings` → `manifest.spec.settings`, `manifest.systemPrompt` → `manifest.spec.systemPrompt` (where referring to explicit YAML), but keep top-level `manifest.systemPrompt` (the merged result) as-is since that stays at top level in the type.

Specific assertion changes needed in the test file:
- `manifest.name` → `manifest.metadata.name`
- `manifest.settings` → `manifest.spec.settings` (where checking settings content)
- `manifest.spec.systemPrompt` (the explicit YAML paths, not the merged result) — but the existing tests check `manifest.systemPrompt` which is the merged result. Keep those as-is since the merged `systemPrompt` stays at top level.
- The `name/directory mismatch` test: `loadAgentDir` validates `metadata.name` matches dir name. The assertion stays the same since it checks `AgentManifestParseError`.

Also update the `systemPrompt` test that checks explicit systemPrompt in settings — the YAML needs to be under `spec.systemPrompt` now:

```typescript
it("uses explicit systemPrompt for specified keys and defaults others from sibling files", async () => {
  const sharedDir = Path.join(tmpDir, "shared-agents")
  Fs.mkdirSync(Path.join(sharedDir, "custom"), { recursive: true })
  const yaml = `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: custom\nspec:\n  settings:\n    model: default\n  systemPrompt:\n    agent: custom/AGENTS.md\n    soul: custom/SOUL.md\n    identity: custom/IDENTITY.md\n`
  Fs.writeFileSync(Path.join(sharedDir, "custom", "agent.yml"), yaml)
  makeSiblingFiles(Path.join(sharedDir, "custom"), {
    agents: "Should be ignored",
    soul: "Should be ignored",
    identity: "Should be ignored"
  })

  const result = await Effect.runPromiseExit(loadAgentManifests(sharedDir, []))
  expect(Exit.isSuccess(result)).toBe(true)
  if (Exit.isSuccess(result)) {
    const manifest = result.value.get("custom")!
    expect(manifest.systemPrompt.agent).toBe("custom/AGENTS.md")
    expect(manifest.systemPrompt.soul).toBe("custom/SOUL.md")
    expect(manifest.systemPrompt.identity).toBe("custom/IDENTITY.md")
  }
})
```

And the partial systemPrompt test:

```typescript
it("uses explicit systemPrompt for some keys, defaults rest from sibling files", async () => {
  const sharedDir = Path.join(tmpDir, "shared-agents")
  Fs.mkdirSync(Path.join(sharedDir, "partial"), { recursive: true })
  const yaml = `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: partial\nspec:\n  settings:\n    model: default\n  systemPrompt:\n    agent: partial/custom-agent.md\n`
  Fs.writeFileSync(Path.join(sharedDir, "partial", "agent.yml"), yaml)
  makeSiblingFiles(Path.join(sharedDir, "partial"), {
    agents: "Ignored - explicitly set",
    soul: "Found from file",
    identity: "Found from file"
  })

  const result = await Effect.runPromiseExit(loadAgentManifests(sharedDir, []))
  expect(Exit.isSuccess(result)).toBe(true)
  if (Exit.isSuccess(result)) {
    const manifest = result.value.get("partial")!
    expect(manifest.systemPrompt.agent).toBe("partial/custom-agent.md")
    expect(manifest.systemPrompt.soul).toBe("SOUL.md")
    expect(manifest.systemPrompt.identity).toBe("IDENTITY.md")
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/workflow/agent-registry.test.ts`
Expected: FAIL — agent-registry doesn't parse k8s envelope yet.

- [ ] **Step 3: Update loadAgentDir in src/workflow/agent-registry.ts**

Replace the `loadAgentDir` function. Key changes:
- Parse and validate envelope using `parseManifest()` (validate kind is "Agent")
- Access `raw.metadata.name` instead of `raw.name` for the name/directory check
- Access `raw.spec.settings.model` instead of `raw.settings?.model`
- Access `raw.spec.systemPrompt` instead of `raw.settings?.systemPrompt` for explicit prompt paths

```typescript
import { Schema } from "@effect/schema"
import { InvalidManifestEnvelopeError } from "../schemas.js"

function loadAgentDir(
  agentsDir: string,
  dirName: string
): Effect.Effect<AgentManifest, AgentManifestParseError | InvalidManifestEnvelopeError> {
  return Effect.gen(function* (_) {
    const dirPath = Path.join(agentsDir, dirName)
    const filePath = Path.join(dirPath, "agent.yml")

    const content = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(filePath, "utf-8"),
        catch: () => new AgentManifestParseError({
          filePath,
          message: `agent.yml not found in ${dirPath}`
        })
      })
    )

    const raw = yield* _(
      Effect.try({
        try: () => Yaml.parse(content) as any,
        catch: (e) => new AgentManifestParseError({
          filePath,
          message: `Failed to parse agent.yml: ${String(e)}`
        })
      })
    )

    yield* _(
      Effect.try({
        try: () => {
          if (raw.apiVersion !== "dag.hamilton.io/v1alpha1") {
            throw new Error(`Invalid apiVersion: ${raw.apiVersion}`)
          }
          if (raw.kind !== "Agent") {
            throw new Error(`Invalid kind: ${raw.kind}, expected Agent`)
          }
        },
        catch: (e) => new InvalidManifestEnvelopeError({
          message: String(e)
        })
      })
    )

    const metadataName = raw.metadata?.name
    if (!metadataName || metadataName !== dirName) {
      return yield* _(
        Effect.fail(new AgentManifestParseError({
          filePath,
          message: `Agent name "${metadataName}" does not match directory name "${dirName}"`
        }))
      )
    }

    const defaults = readSystemPromptDefaults(dirPath)
    const explicitPrompt = raw.spec?.systemPrompt as SystemPromptPaths | undefined
    const systemPrompt = mergeSystemPrompt(explicitPrompt, defaults)

    return {
      metadata: {
        name: metadataName,
        description: raw.metadata?.description
      },
      dirPath,
      spec: {
        settings: {
          model: raw.spec?.settings?.model,
          skills: raw.spec?.settings?.skills
        },
        systemPrompt: explicitPrompt
      },
      systemPrompt
    }
  })
}
```

Also update `loadAgentManifests` return type to include `InvalidManifestEnvelopeError`:

```typescript
export function loadAgentManifests(
  sharedAgentsDir: string,
  workflows: WorkflowDescriptor[]
): Effect.Effect<Map<string, AgentManifest>, DuplicateAgentError | AgentManifestParseError | InvalidManifestEnvelopeError> {
```

And update the registry access — `m.name` becomes `m.metadata.name`:

In `loadAgentManifests`, change `registry.set(m.name, m)` to `registry.set(m.metadata.name, m)` and `sourceMap.set(m.name, ...)` to `sourceMap.set(m.metadata.name, ...)` and `if (registry.has(m.name))` to `if (registry.has(m.metadata.name))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/workflow/agent-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/agent-registry.ts tests/workflow/agent-registry.test.ts
git commit -m "feat: update agent-registry for k8s agent manifest parsing"
```

---

### Task 5: Update loader.ts for k8s workflow manifest

**Files:**
- Modify: `src/workflow/loader.ts`
- Modify: `tests/workflow/loader.test.ts`
- Modify: `tests/fixtures/feature-dev.yml`

- [ ] **Step 1: Update test fixture and loader test YAML**

Update `tests/fixtures/feature-dev.yml` to k8s envelope. Replace the top-level flat structure with:

```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: feature-dev
  version: 1
  description: Feature development workflow
spec:
  run:
    entrypoint: plan
    timeout: 300s
  variants:
    supported: [branchout, merge, worktree, github_pr]
  tasks:
    - name: plan
      agent:
        executorRef: planner
        prompt:
          content: |
            Plan the task: {{task}}
        on_failure:
          max_retries: 4
          escalate_to: human
      output:
        schema:
          content:
            type: object
            properties:
              status:
                type: string
                enum: [done, failed]
            required: [status]
    - name: setup
      dependencies: [plan]
      agent:
        executorRef: setup
        timeout:
          fixed: "300s"
        prompt:
          content: |
            Setup repo: {{tasks.setup.outputs.repo}}
    - name: codify
      dependencies: [setup]
      template: develop
      forEach:
        valueFrom:
          ref: tasks.plan.outputs.user_stories
        as: user_story
      context:
        fields:
          - name: repo
            valueFrom:
              ref: tasks.setup.outputs.repo
    - name: develop
      tasks:
        - name: implement
          agent:
            executorRef: developer
            timeout:
              fixed: "600s"
            prompt:
              content: |
                Implement story
            on_failure:
              max_retries: 4
              escalate_to: human
          output:
            schema:
              content:
                type: object
                properties:
                  status:
                    type: string
                    enum: [done, failed]
                required: [status]
        - name: test
          dependencies: [implement]
          agent:
            executorRef: tester
            prompt:
              content: |
                Test story
          on_failure:
            max_retries: 4
            retry_step: implement
            escalate_to: human
```

Update `tests/workflow/loader.test.ts` — change `validYaml` and `invalidYaml`:

```typescript
const validYaml = `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: test-wf
  version: 1
spec:
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

const invalidYaml = `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: bad
  version: not-a-number
spec:
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
```

Also update `makeAgentDir` to produce k8s-style agent YAML:

```typescript
function makeAgentDir(agentsDir: string, name: string): void {
  const dir = Path.join(agentsDir, name)
  Fs.mkdirSync(dir, { recursive: true })
  Fs.writeFileSync(Path.join(dir, "AGENTS.md"), `Agent ${name}`)
  Fs.writeFileSync(Path.join(dir, "agent.yml"), `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  settings:\n    model: default\n`)
}
```

Update loader test assertions:

- `exit.value.name` → `exit.value.metadata.name`
- `exit.value.version` → `exit.value.metadata.version`
- `exit.value.run.entrypoint` → `exit.value.spec.run.entrypoint`
- `exit.value.run.timeout` → `exit.value.spec.run.timeout`
- `exit.value.tasks` → `exit.value.spec.tasks`

And update the `missingRefYaml` in the test:

```typescript
const missingRefYaml = `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: test-wf
  version: 1
spec:
  run:
    entrypoint: t1
    timeout: 300s
  tasks:
    - name: t1
      agent:
        executorRef: nonexistent
        prompt:
          content: do it
`
```

Also update `resolveWorkflowSpec` test assertions — the `spec` objects need to use k8s structure:

```typescript
const spec = {
  apiVersion: "dag.hamilton.io/v1alpha1",
  kind: "Workflow",
  metadata: { name: "prompt-file-wf", version: 1 },
  spec: {
    run: { entrypoint: "t1", timeout: "300s" },
    tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { file: "prompts/my-prompt.md" } } }]
  }
}
const resolved = resolveWorkflowSpec(wfDir, spec)
expect(resolved.spec.tasks[0].agent.prompt.content).toBe("prompt from file")
```

All `resolveWorkflowSpec` test specs need this same migration pattern — wrap the flat structure into `metadata` + `spec`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: FAIL — loader doesn't handle k8s envelope yet.

- [ ] **Step 3: Update loader.ts for k8s workflow envelope**

In `src/workflow/loader.ts`, update `loadWorkflowSpec`:

After YAML parsing, add envelope validation before schema decode:

```typescript
yield* _(
  Effect.try({
    try: () => {
      if ((raw as any).apiVersion !== "dag.hamilton.io/v1alpha1") {
        throw new Error(`Invalid apiVersion: ${(raw as any).apiVersion}`)
      }
      if ((raw as any).kind !== "Workflow") {
        throw new Error(`Invalid kind: ${(raw as any).kind}, expected Workflow`)
      }
    },
    catch: (e) => new InvalidManifestEnvelopeError({ message: String(e) })
  })
)
```

Import `InvalidManifestEnvelopeError` from `../schemas.js`.

Also update `resolveWorkflowSpec` to access `spec.spec.tasks` instead of `spec.tasks`:

```typescript
export function resolveWorkflowSpec(workflowDir: string, spec: any): any {
  const tasks = walkTasks(spec.spec.tasks)
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
```

And update the executorRef validation:

```typescript
for (const task of walkTasks((spec as any).spec.tasks as any[])) {
  if (task.agent && !agentRegistry.has(task.agent.executorRef)) {
    yield* _(Effect.fail(new AgentNotFoundError({ taskName: task.name, executorRef: task.agent.executorRef })))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/loader.ts tests/workflow/loader.test.ts tests/fixtures/feature-dev.yml
git commit -m "feat: update loader for k8s workflow envelope, update test fixtures"
```

---

### Task 6: Update all downstream source files for nested field access

**Files:**
- Modify: `src/workflow/runner.ts`
- Modify: `src/workflow/engine.ts`
- Modify: `src/workflow/variants.ts`
- Modify: `src/workflow/run-state-machine.ts`
- Modify: `src/cli/commands/list.ts`
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/resume.ts`
- Modify: `src/cli/commands/install-logic.ts`
- Modify: `src/prompts/builder.ts`
- Modify: `src/prompts/persona.ts`
- Modify: `src/agent/config.ts`
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Update src/workflow/engine.ts**

This file mostly operates on `WorkflowTask[]` and doesn't access `WorkflowSpec` top-level fields directly. No changes expected. Verify by grepping for `spec.name`, `spec.version`, `spec.run`, `spec.tasks`.

- [ ] **Step 2: Update src/workflow/runner.ts**

Search and replace field access paths:

- `spec.name` → `spec.metadata.name`
- `spec.run.entrypoint` → `spec.spec.run.entrypoint`
- `spec.run.timeout` → `spec.spec.run.timeout`
- `spec.tasks` → `spec.spec.tasks`
- `spec.agentRegistry.get(...)` — stays the same (agentRegistry is at top level)
- `agent.name` → `agent.metadata.name`
- `agent.settings` → `agent.spec.settings`
- `agent.systemPrompt` → `agent.systemPrompt` (stays at top level — it's the merged result)
- `agent.dirPath` → `agent.dirPath` (stays at top level)

For `resolveAgentDefaults(agent.settings)` — change to `resolveAgentDefaults(agent.spec.settings)`.

- [ ] **Step 3: Update src/workflow/variants.ts**

- `spec.tasks` → `spec.spec.tasks`
- `spec.run.entrypoint` → `spec.spec.run.entrypoint`
- `spec.variants` → `spec.spec.variants`

- [ ] **Step 4: Update src/workflow/run-state-machine.ts**

- `spec.name` → `spec.metadata.name`
- `spec.tasks` → `spec.spec.tasks`

In `collectAllTaskNames`, change `spec.tasks` to `spec.spec.tasks`.

- [ ] **Step 5: Update src/cli/commands/list.ts**

- `spec.name` → `spec.metadata.name`
- `spec.version` → `spec.metadata.version`
- `spec.description` → `spec.metadata.description`

- [ ] **Step 6: Update src/cli/commands/run.ts**

- `spec.name` → `spec.metadata.name`
- `spec.run` → `spec.spec.run`

- [ ] **Step 7: Update src/cli/commands/status.ts**

- `spec.name` → `spec.metadata.name`
- `spec.tasks` → `spec.spec.tasks`

- [ ] **Step 8: Update src/cli/commands/resume.ts**

- `spec.name` → `spec.metadata.name`

- [ ] **Step 9: Update src/cli/commands/install-logic.ts**

Check for any field access on `WorkflowSpec` objects. If it accesses `name`, change to `metadata.name`.

- [ ] **Step 10: Update src/prompts/builder.ts**

- `spec.name` → `spec.metadata.name` (if accessed)

- [ ] **Step 11: Update src/prompts/persona.ts**

- `agent.dirPath` remains at top level
- `agent.systemPrompt` remains at top level (merged result)
- The function signature takes `agentDir: string` — no changes needed here

- [ ] **Step 12: Update src/agent/config.ts**

- `agent.settings` → `agent.spec.settings`
- `resolveAgentDefaults(agent.spec.settings)`
- `loadModelAliases()` and `resolveModelAlias()` — check if they access settings directly

- [ ] **Step 13: Update src/mcp/server.ts**

- `spec.name` → `spec.metadata.name`
- `spec.tasks` → `spec.spec.tasks`

- [ ] **Step 14: Run build**

Run: `bun run build`
Expected: Clean build with no type errors.

- [ ] **Step 15: Commit**

```bash
git add src/
git commit -m "refactor: update all downstream source files for k8s nested field access"
```

---

### Task 7: Update all test files for nested field access

**Files:**
- Modify: `tests/workflow/runner.test.ts`
- Modify: `tests/workflow/engine.test.ts`
- Modify: `tests/workflow/variants.test.ts`
- Modify: `tests/workflow/run-state-machine.test.ts`
- Modify: `tests/cli/run.test.ts`
- Modify: `tests/cli/list.test.ts`
- Modify: `tests/cli/pause.test.ts`
- Modify: `tests/cli/status.test.ts`
- Modify: `tests/e2e/workflows.test.ts`
- Modify: `tests/workflow/runner-regression.test.ts`
- Modify: `tests/cli/install.test.ts`

- [ ] **Step 1: Update tests/workflow/runner.test.ts**

In `makeAgentManifest`:
- `name,` → `metadata: { name },`
- `settings: { model: "default" }` → `spec: { settings: { model: "default" } }`
- `systemPrompt: { ... }` stays at top level (merged result)

In `makeSpec`:
- `version: 1, name: "test-flow",` → `metadata: { version: 1, name: "test-flow" },`
- `run: { ... },` → `spec: { run: { ... }, tasks: [ ... ] },`
- Move `tasks` array inside `spec`

In all tests that construct `WorkflowSpec` overrides:
- `name:` → `metadata: { name: ... }`
- `version:` → `metadata: { version: ... }`
- `run:` → `spec: { run: ... }`
- `tasks:` → `spec: { tasks: ... }`

- [ ] **Step 2: Update tests/workflow/variants.test.ts**

In `baseSpec`:
- `version: 1, name: "test-wf",` → `metadata: { version: 1, name: "test-wf" },`
- `run: { ... }, variants: { ... }, tasks` → move under `spec`

In assertions that check `spec.tasks`:
- `spec.tasks` → `spec.spec.tasks`
- `spec.run.entrypoint` → `spec.spec.run.entrypoint`
- `spec.variants` → `spec.spec.variants`

- [ ] **Step 3: Update tests/workflow/run-state-machine.test.ts**

In `makeSpec`:
- `name: "test-wf", version: 1,` → `metadata: { name: "test-wf", version: 1 },`
- `run: { ... },` → `spec: { run: { ... }, tasks: [ ... ] },`

- [ ] **Step 4: Update tests/workflow/engine.test.ts**

This file mostly operates on `WorkflowTask[]` directly — no `WorkflowSpec` construction. Check for any `spec` usage.

- [ ] **Step 5: Update tests/cli/run.test.ts**

Update YAML strings to k8s envelope format. In `validYaml`:
```typescript
const validYaml = `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: test-wf
  version: 1
spec:
  run:
    entrypoint: step-1
    timeout: 300s
  variants:
    supported: [branchout]
  tasks:
    - name: step-1
      agent:
        executorRef: agent-1
        prompt:
          content: do it
`
```

Update all assertions accessing `spec.name`, `spec.version`, `spec.run`, `spec.tasks`.

- [ ] **Step 6: Update remaining test files**

Follow the same pattern for:
- `tests/cli/list.test.ts`
- `tests/cli/pause.test.ts`
- `tests/cli/status.test.ts`
- `tests/cli/install.test.ts` (checks `workflow.yml` exists — no content assertions)
- `tests/e2e/workflows.test.ts`
- `tests/workflow/runner-regression.test.ts`

- [ ] **Step 7: Run full test suite**

Run: `bun --bun vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add tests/
git commit -m "refactor: update all test files for k8s nested field access"
```

---

### Task 8: Migrate all YAML manifest files to k8s envelope

**Files:**
- Modify: all `manifest/agents/*/agent.yml` (4 files)
- Modify: all `manifest/workflows/*/agents/*/agent.yml` (14 files)
- Modify: all `manifest/workflows/*/workflow.yml` (6 files)

- [ ] **Step 1: Migrate shared agent manifests**

For each file under `manifest/agents/`, add the envelope and restructure:

`manifest/agents/do/agent.yml`:
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: do
spec:
  settings:
    model: default
```

`manifest/agents/pr/agent.yml`:
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: pr
spec:
  settings:
    model: default
```

`manifest/agents/setup/agent.yml`:
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: setup
spec:
  settings:
    model: default
    skills:
      - hamilton-agents
```

`manifest/agents/verifier/agent.yml`:
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: verifier
spec:
  settings:
    model: default
    skills:
      - hamilton-agents
```

- [ ] **Step 2: Migrate workflow-local agent manifests**

For each of the 14 `agent.yml` files under `manifest/workflows/*/agents/*/`, add the envelope:

Simple agents (most of them — `model: default` only):
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: <agent-name>
spec:
  settings:
    model: default
```

Agents with skills (developer, planner, tester in feature-dev):
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  settings:
    model: deepseek-v4-pro-official
    skills:
      - hamilton-agents
```

Full list of 14 agents: triager, investigator, fixer (bug-fix), doer (do), developer, planner, tester (feature-dev), scaffolder (greenfield), quarantiner, qa-verifier (quarantine-broken-tests), scanner, prioritizer, sec-fixer, sec-tester (security-audit).

- [ ] **Step 3: Migrate workflow.yml files**

For each of 6 workflow files, wrap the top-level fields in the envelope. Bump version by 1.

General pattern — wrap existing `name`, `version`, `description` into `metadata`, and `run`, `variants`, `tasks` into `spec`. Add `apiVersion` and `kind` at top.

Example for `manifest/workflows/bug-fix/workflow.yml`:
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: bug-fix
  version: 3
  description: |
    Triage, investigate, and fix bugs...
spec:
  run:
    entrypoint: triage
    timeout: 300s
  variants:
    supported: [branchout, merge, worktree, github_pr]
  tasks:
    - name: triage
      ... (unchanged)
```

Version bumps:
- bug-fix: 2 → 3
- do: 2 → 3
- feature-dev: 6 → 7
- greenfield: 2 → 3
- quarantine-broken-tests: 2 → 3
- security-audit: 2 → 3

Remove any comment lines from the top of workflow.yml files (the `# Ralph loop` comments). k8s manifests don't have free-floating comments before the envelope.

- [ ] **Step 4: Run build + full test suite**

Run: `bun run build && bun --bun vitest run`
Expected: Build passes, all 304 tests pass.

- [ ] **Step 5: Commit**

```bash
git add manifest/
git commit -m "feat: migrate all YAML manifests to k8s envelope structure"
```

---

### Task 9: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run build**

Run: `bun run build`
Expected: Clean build.

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`
Expected: All 304 tests pass.

- [ ] **Step 3: Verify each manifest file has k8s envelope**

Run: `for f in $(find manifest -name '*.yml'); do echo "=== $f ===" && head -2 "$f"; done`
Expected: Every file starts with `apiVersion: dag.hamilton.io/v1alpha1` and `kind: Agent|Workflow`.

- [ ] **Step 4: Verify no stale field access patterns remain**

Run: `rg 'spec\.name\b|spec\.version\b|spec\.description\b' src/`
Expected: No matches (these are now under `metadata`).

Run: `rg '\.name\b' src/workflow/agent-registry.ts | grep -v metadata`
Expected: Only `metadata.name` references, no bare `.name` on AgentManifest.

- [ ] **Step 5: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: final verification fixes for k8s manifest migration"
```