# TODO Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five independent fixes from TODO.md: fix suggestion text, deduplicate cwd/project_dir, split git tools into standalone extension, rename init to setup, and move output schemas into agent manifests.

**Architecture:** Each change is an isolated, self-contained modification. The git extension follows the existing settings-driven extension pattern (RTK, LSP). Agent output schemas follow the same `SchemaConfig` resolution pattern already used for task schemas, moved to agent manifests with fallback inheritance in the loader.

**Tech Stack:** TypeScript, bun, Effect-TS, @effect/schema, @effect/cli, @earendil-works/pi-coding-agent, Handlebars templates, vitest

---

### Task 1: Fix suggestion text in run command

**Files:**
- Modify: `src/cli/commands/run.ts:125`

- [ ] **Step 1: Fix the suggestion string**

In `src/cli/commands/run.ts`, line 125, change:
```typescript
yield* Console.log("Running in background. Use 'hamilton status <run-id>' to check progress.")
```
to:
```typescript
yield* Console.log("Running in background. Use 'hamilton workflow status <run-id>' to check progress.")
```

- [ ] **Step 2: Run existing tests and commit**

```bash
bun --bun vitest run tests/cli/run.test.ts
```

```bash
git add src/cli/commands/run.ts
git commit -m "fix: correct suggestion text from 'hamilton status' to 'hamilton workflow status'"
```

---

### Task 2: Deduplicate cwd → project_dir

**Files:**
- Modify: `src/workflow/env.ts:1-13`
- Modify: `src/cli/commands/run.ts:84`
- Modify: `src/cli/commands/resume.ts:62`
- Modify: `src/workflow/runner.ts:83,115,230`
- Modify: `src/prompts/builder.ts:60`
- Modify: `src/workflow/variants.ts:28,58,89,114,145`
- Modify: `bundle/workflows/feature-dev/workflow.yml:61,99`
- Modify: `tests/prompts/builder.test.ts:60,111,121,123,174,176`
- Modify: `tests/prompts/template.test.ts:28,33`

- [ ] **Step 1: Remove cwd from WorkflowEnv and rename in source files**

`src/workflow/env.ts` — remove line 2 (`cwd?: string`):
```typescript
export interface WorkflowEnv {
  user_input?: string
  run_id?: string
  
  change_dir?: string
  tasks?: Record<string, { outputs: Record<string, unknown> }>
  parameters?: Record<string, unknown>
  currentIteration?: {
    tasks?: Record<string, { outputs: Record<string, unknown> }>
  }
  [key: string]: unknown
}
```

`src/cli/commands/run.ts:84` — change:
```typescript
runWorkflow(spec, { user_input: params.prompt, cwd: process.cwd() }, {
```
to:
```typescript
runWorkflow(spec, { user_input: params.prompt, project_dir: process.cwd() }, {
```

`src/cli/commands/resume.ts:62` — change:
```typescript
context.cwd = process.cwd()
```
to:
```typescript
context.project_dir = process.cwd()
```

`src/workflow/runner.ts:83` — change:
```typescript
executionContext: { cwd: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
```
to:
```typescript
executionContext: { project_dir: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
```

`src/workflow/runner.ts:230` — change:
```typescript
const workdir = task.script.workdir ?? (taskEnv.cwd as string | undefined) ?? process.cwd()
```
to:
```typescript
const workdir = task.script.workdir ?? (taskEnv.project_dir as string | undefined) ?? process.cwd()
```

`src/prompts/builder.ts:60` — change:
```typescript
- Current directory: {{inputs.parameters.cwd}}
```
to:
```typescript
- Current directory: {{inputs.parameters.project_dir}}
```

`src/workflow/variants.ts` — change `cd {{cwd}}` to `cd {{project_dir}}` on all 5 lines (28, 58, 89, 114, 145).

- [ ] **Step 2: Update bundle workflow YAML references**

`bundle/workflows/feature-dev/workflow.yml`:
- Line 61: `cd {{inputs.cwd}}` → `cd {{inputs.project_dir}}`
- Line 99: `Repository: {{inputs.cwd}}` → `Repository: {{inputs.project_dir}}`

- [ ] **Step 3: Update test files**

`tests/prompts/builder.test.ts:60` — change:
```typescript
const env: WorkflowEnv = { tasks: {}, parameters: { cwd: "/tmp/repo" } }
```
to:
```typescript
const env: WorkflowEnv = { tasks: {}, parameters: { project_dir: "/tmp/repo" } }
```

`tests/prompts/builder.test.ts:111` — change:
```typescript
env: { tasks: {}, parameters: { cwd: "/tmp/repo" } },
```
to:
```typescript
env: { tasks: {}, parameters: { project_dir: "/tmp/repo" } },
```

`tests/prompts/builder.test.ts:121` — change:
```typescript
fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "Working in {{inputs.cwd}}" } },
```
to:
```typescript
fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "Working in {{inputs.project_dir}}" } },
```

`tests/prompts/builder.test.ts:123` — change:
```typescript
env: { tasks: {}, cwd: "/tmp/repo" },
```
to:
```typescript
env: { tasks: {}, project_dir: "/tmp/repo" },
```

`tests/prompts/builder.test.ts:174` — change:
```typescript
const env: WorkflowEnv = { cwd: "/tmp/repo" }
```
to:
```typescript
const env: WorkflowEnv = { project_dir: "/tmp/repo" }
```

`tests/prompts/builder.test.ts:176` — change:
```typescript
fragments: { agent: { content: "You are a coder." }, soul: { content: "Working from {{inputs.cwd}}" }, context: { content: "" } },
```
to:
```typescript
fragments: { agent: { content: "You are a coder." }, soul: { content: "Working from {{inputs.project_dir}}" }, context: { content: "" } },
```

`tests/prompts/template.test.ts:28` — change:
```typescript
cwd: "/home/project",
```
to:
```typescript
project_dir: "/home/project",
```

`tests/prompts/template.test.ts:33` — change:
```typescript
expect(render("DIR: {{inputs.cwd}}", ctx, lenient)).toBe("DIR: /home/project")
```
to:
```typescript
expect(render("DIR: {{inputs.project_dir}}", ctx, lenient)).toBe("DIR: /home/project")
```

- [ ] **Step 4: Run tests and commit**

```bash
bun --bun vitest run tests/prompts/builder.test.ts tests/prompts/template.test.ts
```

```bash
git add src/workflow/env.ts src/cli/commands/run.ts src/cli/commands/resume.ts src/workflow/runner.ts src/prompts/builder.ts src/workflow/variants.ts bundle/workflows/feature-dev/workflow.yml tests/prompts/builder.test.ts tests/prompts/template.test.ts
git commit -m "refactor: deduplicate cwd and project_dir — keep only project_dir everywhere"
```

---

### Task 3: Split git tools into standalone extension

**Files:**
- Create: `src/executors/pi/extensions/git-extension.ts`
- Modify: `src/executors/pi/extensions/workflow-extension.ts:81-118` (remove `git_diff`)
- Modify: `src/executors/pi/extensions/extensions.ts:34-54`
- Modify: `src/executors/pi/pi-executor.ts:131`
- Modify: `src/cli/commands/init.ts:144-176` (add `git` to default extensions)
- Modify: `tests/executors/pi/extensions.test.ts:70-109`

- [ ] **Step 1: Create the git extension file**

Create `src/executors/pi/extensions/git-extension.ts`:

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export function createGitExtension(projectDir: string): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool(defineTool({
      name: "git_diff",
      label: "Git Diff",
      description: "Show git diff for the working directory. Set staged=true to see staged changes (git diff --cached). Defaults to unstaged changes.",
      parameters: Type.Object({
        staged: Type.Optional(Type.Boolean({ description: "Show staged changes instead of unstaged (default: false)" }))
      }),
      promptSnippet: "- git_diff: shows current git diff (staged or unstaged)",
      execute: async (_toolCallId, { staged }, _signal, _onUpdate, _ctx) => {
        try {
          const args = staged ? ["diff", "--cached"] : ["diff"]
          const proc = Bun.spawnSync(["git", ...args], {
            cwd: projectDir,
            stdout: "pipe",
            stderr: "pipe"
          })
          const output = new TextDecoder().decode(proc.stdout)
          const errorOutput = new TextDecoder().decode(proc.stderr)

          if (proc.exitCode !== 0 && errorOutput) {
            return {
              content: [{ type: "text" as const, text: `git diff failed: ${errorOutput.trim()}` }],
              details: {}
            }
          }

          return {
            content: [{ type: "text" as const, text: output || "No changes." }],
            details: {}
          }
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: `git diff error: ${String(e)}` }],
            details: {}
          }
        }
      }
    }))
  }
}
```

- [ ] **Step 2: Remove git_diff from workflow-extension.ts**

In `src/executors/pi/extensions/workflow-extension.ts`, remove lines 81-118 (the entire `git_diff` tool registration block — from `pi.registerTool(defineTool({` on line 81 through the closing `}))` on line 118).

- [ ] **Step 3: Update extensions.ts to register the git extension**

Modify `src/executors/pi/extensions/extensions.ts`:

Add import at top:
```typescript
import { createGitExtension } from "./git-extension.js"
```

Change `buildExtensions` signature from:
```typescript
export function buildExtensions(
  settings: ExtensionSettings
): ExtensionFactory[] {
```
to:
```typescript
export function buildExtensions(
  settings: ExtensionSettings,
  projectDir: string
): ExtensionFactory[] {
```

Add case to switch statement after `case "lsp":` (around line 49):
```typescript
      case "git":
        factories.push(createGitExtension(projectDir) as ExtensionFactory)
        break
```

- [ ] **Step 4: Update pi-executor.ts to pass projectDir**

In `src/executors/pi/pi-executor.ts`, line 131, change:
```typescript
const extensionFactories = buildExtensions(extSettings)
```
to:
```typescript
const extensionFactories = buildExtensions(extSettings, cwd)
```

- [ ] **Step 5: Add git to default settings**

In `src/cli/commands/init.ts`, in `buildSettingsYaml()`, add `git` to the extensions array (around line 148). Change:
```typescript
extensions: [
  { name: "rtk", enabled: true },
  { name: "lsp", enabled: true }
],
```
to:
```typescript
extensions: [
  { name: "rtk", enabled: true },
  { name: "lsp", enabled: true },
  { name: "git", enabled: true }
],
```

- [ ] **Step 6: Update extension tests**

In `tests/executors/pi/extensions.test.ts`, update all `buildExtensions` calls to pass a `projectDir` argument.

Line 72: `buildExtensions({})` → `buildExtensions({}, "/tmp")`
Line 77-78: `buildExtensions({...})` → `buildExtensions({...}, "/tmp")`  
Line 85-86: `buildExtensions({...})` → `buildExtensions({...}, "/tmp")`
Line 92-93: `buildExtensions({...})` → `buildExtensions({...}, "/tmp")`
Line 104-105: `buildExtensions({...})` → `buildExtensions({...}, "/tmp")`

Add a new test for the `git` extension:
```typescript
it("includes git when enabled", () => {
  const result = buildExtensions({
    extensions: [{ name: "git", enabled: true }]
  }, "/tmp/repo")
  expect(result).toHaveLength(1)
  expect(typeof result[0]).toBe("function")
})
```

- [ ] **Step 7: Update init test for default extensions count**

In `tests/cli/init.test.ts`, the `buildSettingsYaml` tests on lines 263-282 check `extensions` length of `2`. Update to expect `3`:

Line 267: `expect(parsed.extensions).toHaveLength(2)` → `expect(parsed.extensions).toHaveLength(3)`
Line 274: `expect(parsed.extensions).toHaveLength(2)` → `expect(parsed.extensions).toHaveLength(3)`

- [ ] **Step 8: Remove git_diff tests from workflow-extension test**

In `tests/executors/pi/workflow-extension.test.ts`, remove the `git_diff` test blocks (lines 197-233):
- Remove: `it("registers the git_diff tool on pi", ...)` (lines 197-206)
- Remove: `it("git_diff tool returns unstaged diff ...", ...)` (lines 208-220)
- Remove: `it("git_diff tool returns staged diff ...", ...)` (lines 222-233)

The test at line 205 that checks `registeredNames` includes `"git_diff"` will no longer fail since the extension no longer registers it.

- [ ] **Step 9: Run tests and commit**

```bash
bun --bun vitest run tests/executors/pi/extensions.test.ts tests/executors/pi/workflow-extension.test.ts tests/cli/init.test.ts
```

```bash
bun run build
```

```bash
git add src/executors/pi/extensions/git-extension.ts src/executors/pi/extensions/workflow-extension.ts src/executors/pi/extensions/extensions.ts src/executors/pi/pi-executor.ts src/cli/commands/init.ts tests/executors/pi/extensions.test.ts tests/executors/pi/workflow-extension.test.ts tests/cli/init.test.ts
git commit -m "refactor: split git_diff into standalone git extension registered via settings.yaml"
```

---

### Task 4: Rename init command to setup

**Files:**
- Rename: `src/cli/commands/init.ts` → `src/cli/commands/setup.ts`
- Modify: `src/cli/main.ts:6,39,47`
- Modify: `src/cli/commands/run.ts:48`
- Modify: `src/cli/commands/install-logic.ts:33,80`
- Modify: `src/cli/commands/resume.ts:27`
- Modify: `src/cli/commands/status.ts:18`
- Modify: `src/cli/commands/pause.ts:18`
- Modify: `src/cli/commands/logs.ts:29`
- Rename: `tests/cli/init.test.ts` → `tests/cli/setup.test.ts`

- [ ] **Step 1: Rename and update the setup command file**

Rename file:
```bash
mv src/cli/commands/init.ts src/cli/commands/setup.ts
```

In `src/cli/commands/setup.ts`, replace:
- `class InitError` → `class SetupError`
- `InitError` (all occurrences in functions) → `SetupError`
- `export function initHamilton` → `export function setupHamilton`
- `export const initCommand` → `export const setupCommand`

The command name in `Command.make` stays the same approach — update to:
```typescript
export const setupCommand = Command.make("setup", { force, copyPiConfigs, modelAlias }, ({ force, copyPiConfigs, modelAlias }) =>
```

The `buildSettingsYaml` function and `parseModelAliasArgs` / `askModelAliases` stay unchanged.

- [ ] **Step 2: Update the CLI entry point**

In `src/cli/main.ts`:

Line 6: Change import from:
```typescript
import { initCommand } from "./commands/init.js"
```
to:
```typescript
import { setupCommand } from "./commands/setup.js"
```

Line 39: Change subcommand from:
```typescript
Command.withSubcommands([initCommand, doctorCommand, workflowCommand, mcpCommand, telemetryCommand])
```
to:
```typescript
Command.withSubcommands([setupCommand, doctorCommand, workflowCommand, mcpCommand, telemetryCommand])
```

Lines 47: Change guard from:
```typescript
const isInitCommand = process.argv.length > 2 && process.argv[2] === "init"
```
to:
```typescript
const isSetupCommand = process.argv.length > 2 && process.argv[2] === "setup"
```

Line 49: Change from:
```typescript
const program = isInitCommand
```
to:
```typescript
const program = isSetupCommand
```

- [ ] **Step 3: Update error messages referencing hamilton init**

In each file below, change `"hamilton init"` to `"hamilton setup"`:

`src/cli/commands/run.ts:48`:
```typescript
return yield* _(Effect.fail(new Error('Hamilton is not initialized. Run "hamilton setup" first.')))
```

`src/cli/commands/install-logic.ts:33`:
```typescript
new InstallError({ workflowSlug, message: 'Hamilton is not initialized. Run "hamilton setup" first.' })
```

`src/cli/commands/install-logic.ts:80`:
```typescript
new InstallError({ workflowSlug, message: 'Hamilton is not initialized. Run "hamilton setup" first.' })
```

`src/cli/commands/resume.ts:27`:
```typescript
message: 'Hamilton is not initialized. Run "hamilton setup" first.'
```

`src/cli/commands/status.ts:18`:
```typescript
message: 'Hamilton is not initialized. Run "hamilton setup" first.'
```

`src/cli/commands/pause.ts:18`:
```typescript
message: 'Hamilton is not initialized. Run "hamilton setup" first.'
```

`src/cli/commands/logs.ts:29`:
```typescript
message: 'Hamilton is not initialized. Run "hamilton setup" first.'
```

- [ ] **Step 4: Rename and update the test file**

```bash
mv tests/cli/init.test.ts tests/cli/setup.test.ts
```

In `tests/cli/setup.test.ts`:

Line 7: Change import from:
```typescript
import { initHamilton, parseModelAliasArgs, buildSettingsYaml } from "../../src/cli/commands/init.js"
```
to:
```typescript
import { setupHamilton, parseModelAliasArgs, buildSettingsYaml } from "../../src/cli/commands/setup.js"
```

Replace all occurrences of `initHamilton()` with `setupHamilton()` throughout the file (there are ~20 calls).

Line 9: Change describe block from:
```typescript
describe("initHamilton", () => {
```
to:
```typescript
describe("setupHamilton", () => {
```

- [ ] **Step 5: Run tests and commit**

```bash
bun --bun vitest run tests/cli/setup.test.ts
```

```bash
bun run build
```

```bash
git add src/cli/commands/init.ts src/cli/commands/setup.ts src/cli/main.ts src/cli/commands/run.ts src/cli/commands/install-logic.ts src/cli/commands/resume.ts src/cli/commands/status.ts src/cli/commands/pause.ts src/cli/commands/logs.ts tests/cli/init.test.ts tests/cli/setup.test.ts
git commit -m "refactor: rename init command to setup, free init for project onboarding"
```

---

### Task 5: Move output schemas into agent manifests

**Files:**
- Modify: `src/schemas.ts:44-52` (add `output` to AgentManifestSchema)
- Modify: `bundle/agents/setup/agent.yml`
- Modify: `bundle/agents/verifier/agent.yml`
- Create: `bundle/agents/setup/schemas/output.json`
- Create: `bundle/agents/verifier/schemas/output.json`
- Modify: `src/workflow/agent-registry.ts` (resolve agent output schemas)
- Modify: `src/workflow/loader.ts` (inherit agent schemas in resolveWorkflowSpec)
- Modify: `src/types.ts` (add `outputSchema` to AgentManifest type)
- Modify: `bundle/workflows/feature-dev/workflow.yml` (remove output.schema from setup, verifyImplementation)
- Modify: `bundle/workflows/bug-fix/workflow.yml` (remove output.schema from setup, verify)
- Modify: `bundle/workflows/scaffold/workflow.yml` (remove output.schema from verify)
- Modify: `bundle/workflows/security-audit/workflow.yml` (remove output.schema from setup, verify-story)
- Modify: `bundle/workflows/quarantine-broken-tests/workflow.yml` (remove output.schema from setup)
- Delete: 8 stale schema JSON files

- [ ] **Step 1: Add output field to AgentManifestSchema**

In `src/schemas.ts`, modify `AgentManifestSchema` (lines 44-52) to add an optional `output` field:

```typescript
export const AgentManifestSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamiltonai.dev/v1alpha1"),
  kind: Schema.Literal("Agent"),
  metadata: AgentMetadataSchema,
  spec: Schema.Struct({
    settings: AgentManifestSettingsSchema,
    systemPrompt: Schema.optional(SystemPromptPathsSchema),
    output: Schema.optional(Schema.Struct({
      schema: Schema.optional(SchemaConfigSchema)
    }))
  })
})
```

- [ ] **Step 2: Create canonical schema files for shared agents**

Copy canonical schemas from feature-dev to the shared agent directories:

```bash
mkdir -p bundle/agents/setup/schemas bundle/agents/verifier/schemas
cp bundle/workflows/feature-dev/schemas/setup.json bundle/agents/setup/schemas/output.json
cp bundle/workflows/feature-dev/schemas/verifyImplementation.json bundle/agents/verifier/schemas/output.json
```

- [ ] **Step 3: Update agent manifests to declare output schemas**

`bundle/agents/setup/agent.yml` — add `output` section:
```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: setup
spec:
  settings:
    model: default
  output:
    schema:
      file: schemas/output.json
```

`bundle/agents/verifier/agent.yml` — add `output` section:
```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: verifier
spec:
  settings:
    model: default
  output:
    schema:
      file: schemas/output.json
```

- [ ] **Step 4: Add outputSchema to AgentManifest type**

In `src/types.ts`, find the `AgentManifest` interface. Add an `outputSchema` field:

```typescript
export interface AgentManifest {
  metadata: {
    name: string
    description?: string
  }
  dirPath: string
  spec: {
    settings: {
      model?: string
      skills?: string[]
    }
    systemPrompt?: SystemPromptPaths
  }
  systemPrompt: SystemPromptPaths
  outputSchema?: Record<string, unknown>
}
```

- [ ] **Step 5: Resolve agent output schemas in agent-registry**

In `src/workflow/agent-registry.ts`, in `loadAgentDir()`, after resolving `systemPrompt` (around line 89), add output schema resolution:

```typescript
let outputSchema: Record<string, unknown> | undefined = undefined
const outputConfig = raw.spec?.output?.schema
if (outputConfig?.file) {
  const schemaPath = Path.resolve(dirPath, outputConfig.file)
  try {
    const schemaRaw = Fs.readFileSync(schemaPath, "utf-8")
    outputSchema = JSON.parse(schemaRaw)
  } catch {
    throw new AgentManifestParseError({
      filePath,
      message: `Output schema file not found or invalid: ${outputConfig.file}`
    })
  }
}
```

Add `outputSchema` to the return object (after `systemPrompt`):
```typescript
return {
  metadata: { ... },
  dirPath,
  spec: { ... },
  systemPrompt,
  outputSchema
}
```

- [ ] **Step 6: Inherit agent output schemas in workflow loader**

In `src/workflow/loader.ts`, in `resolveWorkflowSpec()`, after the existing output schema resolution loop (after line 63), add agent schema inheritance:

```typescript
for (const task of tasks) {
  if (!task.agent) continue
  if (!task.agent.output?.schema) continue
  // (existing resolution stays above)
}

for (const task of tasks) {
  if (!task.agent) continue
  if (task.agent.output?.schema) continue
  const agentManifest = agentRegistry.get(task.agent.executorRef)
  if (!agentManifest) continue
  if (agentManifest.outputSchema) {
    task.agent.output = { schema: { content: agentManifest.outputSchema } }
  }
}
```

This requires passing `agentRegistry` into `resolveWorkflowSpec`. Update the function signature from:
```typescript
export function resolveWorkflowSpec(workflowDir: string, spec: any): any {
```
to:
```typescript
export function resolveWorkflowSpec(workflowDir: string, spec: any, agentRegistry: Map<string, AgentManifest>): any {
```

And update the call site at line 116:
```typescript
const decoded = resolveWorkflowSpec(dir, Schema.decodeUnknownSync(WorkflowSpecSchema)(raw), agentRegistry as Map<string, AgentManifest>)
```

- [ ] **Step 7: Remove output.schema from tasks using shared agents**

In each workflow YAML, remove the `output:` block from tasks that use shared agents:

**`bundle/workflows/feature-dev/workflow.yml`** — remove `output:` block from:
- `setup` task (lines ~70-73 — remove `output:\n  schema:\n    file: schemas/setup.json`)
- `verifyImplementation` task (lines ~205-207 — remove `output:\n  schema:\n    file: schemas/verifyImplementation.json`)

**`bundle/workflows/bug-fix/workflow.yml`** — remove `output:` block from:
- `setup` task (lines 105-107 — remove `output:\n  schema:\n    file: schemas/setup.json`)
- `verify` task (lines 197-199 — remove `output:\n  schema:\n    file: schemas/verify.json`)

**`bundle/workflows/scaffold/workflow.yml`** — remove `output:` block from verify task (`output:\n  schema:\n    file: schemas/verify.json`).

**`bundle/workflows/security-audit/workflow.yml`** — remove `output:` block from:
- setup task (`output:\n  schema:\n    file: schemas/setup.json`)
- verify-story task (`output:\n  schema:\n    file: schemas/verify-story.json`)

**`bundle/workflows/quarantine-broken-tests/workflow.yml`** — remove `output:` block from setup task (`output:\n  schema:\n    file: schemas/setup.json`).
Do NOT remove from verify — it uses workflow-local `qa-verifier`, not the shared `verifier`.

- [ ] **Step 8: Delete stale schema files**

```bash
rm bundle/workflows/bug-fix/schemas/setup.json
rm bundle/workflows/bug-fix/schemas/verify.json
rm bundle/workflows/security-audit/schemas/setup.json
rm bundle/workflows/security-audit/schemas/verify-story.json
rm bundle/workflows/quarantine-broken-tests/schemas/setup.json
rm bundle/workflows/scaffold/schemas/verify.json
rm bundle/workflows/feature-dev/schemas/setup.json
rm bundle/workflows/feature-dev/schemas/verifyImplementation.json
```

Do NOT delete `bundle/workflows/quarantine-broken-tests/schemas/verify.json` — it belongs to a workflow-local agent (`qa-verifier`).

- [ ] **Step 9: Run tests and build**

```bash
bun --bun vitest run tests/workflow/loader.test.ts tests/workflow/agent-registry.test.ts tests/cli/setup.test.ts tests/schemas.test.ts
```

```bash
bun run build
```

Update the 4 direct calls to `resolveWorkflowSpec` in `tests/workflow/loader.test.ts` to pass an empty `Map` as the third argument:

Line 177: `resolveWorkflowSpec(wfDir, spec)` → `resolveWorkflowSpec(wfDir, spec, new Map())`
Line 200: `resolveWorkflowSpec(wfDir, spec)` → `resolveWorkflowSpec(wfDir, spec, new Map())`
Line 219: `resolveWorkflowSpec(tmpDir, spec)` → `resolveWorkflowSpec(tmpDir, spec, new Map())`
Line 237: `resolveWorkflowSpec(tmpDir, spec)` → `resolveWorkflowSpec(tmpDir, spec, new Map())`

```bash
git add src/schemas.ts src/types.ts src/workflow/agent-registry.ts src/workflow/loader.ts bundle/agents/setup/agent.yml bundle/agents/setup/schemas/output.json bundle/agents/verifier/agent.yml bundle/agents/verifier/schemas/output.json bundle/workflows/feature-dev/workflow.yml bundle/workflows/bug-fix/workflow.yml bundle/workflows/scaffold/workflow.yml bundle/workflows/security-audit/workflow.yml bundle/workflows/quarantine-broken-tests/workflow.yml bundle/workflows/bug-fix/schemas/setup.json bundle/workflows/bug-fix/schemas/verify.json bundle/workflows/security-audit/schemas/setup.json bundle/workflows/security-audit/schemas/verify-story.json bundle/workflows/quarantine-broken-tests/schemas/setup.json bundle/workflows/scaffold/schemas/verify.json bundle/workflows/feature-dev/schemas/setup.json bundle/workflows/feature-dev/schemas/verifyImplementation.json
git commit -m "refactor: move shared agent output schemas into agent manifests with inheritance"
```

---

### Task 6: Update TODO.md

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Mark completed items as done in TODO.md**

Move these five items from `## Next Up` / `### Core Engine` to `## Completed` (most recent first):

Remove from `## Next Up`:
- `- [ ] Fix suggestion in run commands that is incorrect, it should be \`hamilton workflow status <status-id>\`.`
- `- [ ] Duplication between cwd and project_dir in the initial parameters must be solved`
- `- [ ] Split git tools into their own extension`

Remove from `### Core Engine`:
- `- [ ] Change \`init\` command to \`setup\``
- `- [ ] Move shared agents schema to the agent folder and use in workflows`

Add to `## Completed` (at the top, after the header):
```markdown
- [x] Fix suggestion in run commands — use `hamilton workflow status <run-id>` instead of `hamilton status <run-id>`
- [x] Deduplicate cwd and project_dir in initial parameters — keep only project_dir
- [x] Split git tools into standalone extension — createGitExtension, registered via settings.yaml
- [x] Rename init command to setup
- [x] Move shared agent output schemas into agent manifests with inheritance in workflow loader
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "chore: mark todo cleanup items as completed in TODO.md"
```

---

### Task 7: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
bun --bun vitest run
```

Expected: all 155 tests pass.

- [ ] **Step 2: Run build**

```bash
bun run build
```

Expected: TypeScript compilation succeeds with no errors.
