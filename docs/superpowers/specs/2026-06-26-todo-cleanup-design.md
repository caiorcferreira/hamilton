# Fix suggestion in run commands

**Current behaviour:** When running a workflow in background mode, the suggestion text says `hamilton status <run-id>`, which is incorrect — the correct command is `hamilton workflow status <run-id>`.

**Change:** In `src/cli/commands/run.ts:125`, change the string from:
```
"Running in background. Use 'hamilton status <run-id>' to check progress."
```
to:
```
"Running in background. Use 'hamilton workflow status <run-id>' to check progress."
```

---

# Deduplicate cwd and project_dir

Both `cwd` and `project_dir` serve the same purpose in initial parameters and the workflow environment. Keep only `project_dir` everywhere.

## Source changes

| File | Line | Change |
|------|------|--------|
| `src/workflow/env.ts` | 2 | Remove `cwd?: string` from `WorkflowEnv` |
| `src/cli/commands/run.ts` | 84 | `{ user_input, cwd: process.cwd() }` to `{ user_input, project_dir: process.cwd() }` |
| `src/cli/commands/resume.ts` | 62 | `context.cwd = process.cwd()` to `context.project_dir = process.cwd()` |
| `src/workflow/runner.ts` | 83 | `executionContext: { cwd: process.cwd() }` to `executionContext: { project_dir: process.cwd() }` |
| `src/workflow/runner.ts` | 230 | `taskEnv.cwd` to `taskEnv.project_dir` |
| `src/prompts/builder.ts` | 60 | `{{inputs.parameters.cwd}}` to `{{inputs.parameters.project_dir}}` in default context template |
| `src/workflow/variants.ts` | 28,58,89,114,145 | `cd {{cwd}}` to `cd {{project_dir}}` in all variant templates |

## Bundle workflow changes

| File | Lines | Change |
|------|-------|--------|
| `bundle/workflows/feature-dev/workflow.yml` | 61,99 | `{{inputs.cwd}}` to `{{inputs.project_dir}}` |

No other bundle workflow YAMLs or INSTRUCTIONS.md files reference `cwd` — feature-dev is the only one.

## Test changes

All test files that set `cwd` in mock `WorkflowEnv` or template parameters rename it to `project_dir`:

| File | Lines |
|------|-------|
| `tests/prompts/builder.test.ts` | 60,111,121,123,174,176 |
| `tests/prompts/template.test.ts` | 28,33 |

---

# Split git tools into their own extension

`git_diff` is currently registered inside `createWorkflowExtension()` alongside `write_task_output` and `todowrite`. Extract it into a standalone, settings-driven extension like RTK and LSP.

## New file

`src/executors/pi/extensions/git-extension.ts`

```typescript
export function createGitExtension(projectDir: string): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool(defineTool({
      name: "git_diff",
      label: "Git Diff",
      description: "Show git diff for the working directory...",
      parameters: Type.Object({
        staged: Type.Optional(Type.Boolean(...))
      }),
      promptSnippet: "- git_diff: shows current git diff (staged or unstaged)",
      execute: async (_toolCallId, { staged }, _signal, _onUpdate, _ctx) => {
        const args = staged ? ["diff", "--cached"] : ["diff"]
        const proc = Bun.spawnSync(["git", ...args], {
          cwd: projectDir,
          stdout: "pipe",
          stderr: "pipe"
        })
        // ... same error handling and return logic
      }
    }))
  }
}
```

Key change: the git working directory is `projectDir` instead of `process.cwd()`.

## Extension registration (`src/executors/pi/extensions/extensions.ts`)

Add `createGitExtension` to the switch statement:

```typescript
case "git":
  factories.push(createGitExtension(projectDir) as ExtensionFactory)
  break
```

The `buildExtensions` function signature changes to accept `projectDir`:

```typescript
export function buildExtensions(settings: ExtensionSettings, projectDir: string): ExtensionFactory[]
```

## Default settings (`src/cli/commands/init.ts`)

Add `git` to the default extension list in `buildSettingsYaml()`:

```yaml
extensions:
  - name: rtk
    enabled: true
  - name: lsp
    enabled: true
  - name: git
    enabled: true
```

## Workflow extension cleanup (`src/executors/pi/extensions/workflow-extension.ts`)

Remove lines 81-118 — the `git_diff` tool registration. Only `write_task_output` and `todowrite` remain.

## Call sites that invoke `buildExtensions`

Update `src/executors/pi/pi-executor.ts` to pass `projectDir` to `buildExtensions`. Check all callers of `buildExtensions` in tests.

---

# Rename init command to setup

The `init` command is renamed to `setup`. A future `init` command will handle project onboarding (creating `.hamilton/` directory, ingesting specs, etc.).

## Source changes

| File | Change |
|------|--------|
| `src/cli/commands/init.ts` | Rename file to `setup.ts`. Rename exports: `initHamilton` to `setupHamilton`, `initCommand` to `setupCommand`, `InitError` to `SetupError`. `parseModelAliasArgs`, `askModelAliases`, `buildSettingsYaml` stay unchanged (no init prefix). |
| `src/cli/main.ts` | Update import from `./commands/init.js` to `./commands/setup.js`. Rename `initCommand` to `setupCommand` in subcommand registration. Rename `isInitCommand` guard to `isSetupCommand`. |

## Error message changes

All error messages referencing `hamilton init` change to `hamilton setup`:

| File | Lines |
|------|-------|
| `src/cli/commands/run.ts` | 48 |
| `src/cli/commands/install-logic.ts` | 33, 80 |
| `src/cli/commands/resume.ts` | 27 |
| `src/cli/commands/status.ts` | 18 |
| `src/cli/commands/pause.ts` | 18 |
| `src/cli/commands/logs.ts` | 29 |

## Test changes

Rename `tests/cli/init.test.ts` to `tests/cli/setup.test.ts`. Update all import references and test names from `init` to `setup`.

---

# Move output schemas to shared agent manifests

Output schemas for shared agents (currently defined per-workflow in each workflow's `schemas/` directory) move to the agent manifests. Workflows using a shared agent inherit the agent's output schema — they no longer need to redeclare it.

## Agent manifest schema (`src/schemas.ts`)

Add an optional `output` field to `AgentManifestSchema.spec`:

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

## Agent YAML changes

Add `output` to shared agent manifests that have canonical schemas:

```yaml
# bundle/agents/setup/agent.yml
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

```yaml
# bundle/agents/verifier/agent.yml (same structure)
```

`do` and `pr` shared agents are not currently used by any workflow — leave their manifests unchanged.

## Schema JSON files

Canonical schemas from feature-dev become the shared agent schemas:

```
bundle/agents/setup/schemas/output.json      ← bundle/workflows/feature-dev/schemas/setup.json
bundle/agents/verifier/schemas/output.json   ← bundle/workflows/feature-dev/schemas/verifyImplementation.json
```

## Agent registry (`src/workflow/agent-registry.ts`)

When loading an agent manifest, resolve `output.schema.file` relative to the agent's directory (same pattern as `resolveWorkflowSpec` does for task schemas). Store the resolved `schema.content` on the `AgentManifest` type.

Add an `outputSchema` field to the `AgentManifest` interface (alongside existing `dirPath`, `systemPrompt`, etc.).

## Workflow resolution (`src/workflow/loader.ts`)

In `resolveWorkflowSpec`, after the existing schema resolution pass, for each task with an agent:

```
if (!task.agent.output?.schema && agentManifest.outputSchema) {
  task.agent.output = { schema: { content: agentManifest.outputSchema } }
}
```

This inherits the agent's schema as a fallback — tasks that declare their own `output.schema` are not overridden.

## Workflow YAML cleanup

Remove `output.schema` from tasks that use shared agents (those agents now declare their own). Keep `output.schema` for workflow-local agents (planner, developer, tester, doer, etc.).

| Workflow | Task | Action |
|----------|------|--------|
| feature-dev | setup | Remove `output.schema` — inherited from `bundle/agents/setup` |
| feature-dev | verifyImplementation | Remove `output.schema` — inherited from `bundle/agents/verifier` |
| bug-fix | setup | Remove `output.schema` |
| bug-fix | verify | Remove `output.schema` |
| security-audit | setup | Remove `output.schema` |
| security-audit | verify-story | Remove `output.schema` |
| quarantine-broken-tests | setup | Remove `output.schema` |
| scaffold | verify | Remove `output.schema` |

## Side effect: unused schema files become dead code

After this change, the following files are no longer referenced:

```
bundle/workflows/bug-fix/schemas/setup.json
bundle/workflows/bug-fix/schemas/verify.json
bundle/workflows/security-audit/schemas/setup.json
bundle/workflows/security-audit/schemas/verify-story.json
bundle/workflows/quarantine-broken-tests/schemas/setup.json
bundle/workflows/scaffold/schemas/verify.json
bundle/workflows/feature-dev/schemas/setup.json
bundle/workflows/feature-dev/schemas/verifyImplementation.json
```

Remove these files. The canonical versions now live under `bundle/agents/<name>/schemas/output.json`.

## Verification

Existing tests pass. Schema inheritance is verified: tasks without explicit `output.schema` using shared agents still receive a validated output schema at runtime.
