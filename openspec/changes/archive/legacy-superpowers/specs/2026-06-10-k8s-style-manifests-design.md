# K8s-Style YAML Manifests

Refactor Hamilton's YAML manifest files to follow a Kubernetes-style envelope structure with `apiVersion`, `kind`, `metadata`, and `spec` fields.

## Motivation

Current manifests use flat YAML structures that conflate identity, configuration, and runtime concerns. A k8s-style envelope provides:

- Clear separation of identity (`metadata`) from behavior (`spec`)
- Self-describing files — `kind` tells you what you're reading without guessing from directory location
- Forward compatibility — `apiVersion` enables schema evolution
- Familiar mental model for anyone who has worked with k8s manifests

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| `kind` semantics | Runtime discriminator | Loader reads `kind` first and dispatches to kind-specific parser |
| `apiVersion` policy | Strict — reject unknowns | Only `dag.hamilton.io/v1alpha1` accepted; unknown values are parse errors |
| `description` placement | `metadata.description` for both Agent and Workflow | Consistent k8s convention; future-proofs agents |
| `metadata.name` vs directory | `metadata.name` must match dir name | Preserves current behavior; keeps discovery simple |
| `systemPrompt` placement | `spec.systemPrompt` (spec-level) | Persona assembly is a spec concern, not a runtime setting |
| Parsing approach | Single-pass envelope parser | Clean dispatch, good error messages, easy to extend |

## Envelope Structure

Every manifest file has a required envelope:

```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent | Workflow
metadata:
  name: <string>
  ...
```

**Envelope rules:**

- `apiVersion`: exactly `"dag.hamilton.io/v1alpha1"` — any other value is a parse error
- `kind`: exactly `"Agent"` or `"Workflow"` — any other value is a parse error
- `metadata.name`: required, must match the directory name
- Unknown fields in the envelope are rejected (strict schema)

**Dispatch flow:**

```
parseManifest(yaml) → validate envelope → read kind
  kind=Agent    → parseAgentManifest(yaml)
  kind=Workflow → parseWorkflowSpec(yaml)
```

**New error type:** `InvalidManifestEnvelopeError` — surfaces when envelope validation fails before kind dispatch.

## Agent Manifest

### Before

```yaml
name: developer
settings:
  model: default
  systemPrompt:
    agent: AGENTS.md
    soul: SOUL.md
  skills:
    - hamilton-agents
```

### After

```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: developer
  description: |
    Implements user stories in a fresh session with tests and typechecking.
spec:
  settings:
    model: default
    skills:
      - hamilton-agents
  systemPrompt:
    agent: AGENTS.md
    soul: SOUL.md
    identity: IDENTITY.md
```

**Changes from current:**

- `name` moves into `metadata`
- `description` added to `metadata` (new optional field)
- `systemPrompt` promoted from `settings.systemPrompt` to `spec.systemPrompt`
- `spec.settings` holds only runtime settings: `model` and `skills`
- Auto-discovery behavior unchanged: if `spec.systemPrompt` is absent, loader checks for sibling `AGENTS.md`/`SOUL.md`/`IDENTITY.md` files
- `dirPath` and merged `systemPrompt` remain derived (computed at load time, not in YAML)

**TypeScript type changes:**

- `AgentManifest.metadata.name` replaces `AgentManifest.name`
- `AgentManifest.metadata.description` is new optional string
- `AgentManifest.spec.settings` replaces `AgentManifest.settings`
- `AgentManifest.spec.systemPrompt` replaces `AgentManifest.settings.systemPrompt`

## Workflow Manifest

### Before

```yaml
name: feature-dev
version: 5
description: |
  Plan, implement, test...
run:
  entrypoint: plan
  timeout: 300s
variants:
  supported: [branchout, merge, worktree, github_pr]
tasks:
  - name: plan
    dependencies: []
    agent:
      executorRef: planner
      prompt:
        content: |
          ...
      on_failure:
        max_retries: 4
        escalate_to: human
```

### After

```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: feature-dev
  version: 6
  description: |
    Plan, implement, test...
spec:
  run:
    entrypoint: plan
    timeout: 300s
  variants:
    supported: [branchout, merge, worktree, github_pr]
  tasks:
    - name: plan
      dependencies: []
      agent:
        executorRef: planner
        prompt:
          content: |
            ...
        on_failure:
          max_retries: 4
          escalate_to: human
```

**Changes from current:**

- `name`, `version`, `description` move into `metadata`
- `run`, `variants`, `tasks` move under `spec`
- `task.agent` shape unchanged — `executorRef`, `prompt`, `on_failure`, `output`, `timeout` all stay the same
- `forEach`, `template`, `context` on tasks also unchanged
- File resolution (prompt.file, schema.file) still resolves relative to workflow directory
- `agentRegistry: Map<string, AgentManifest>` remains derived (injected by loader)

**TypeScript type changes:**

- `WorkflowSpec.metadata.name` replaces `WorkflowSpec.name`
- `WorkflowSpec.metadata.version` replaces `WorkflowSpec.version`
- `WorkflowSpec.metadata.description` replaces `WorkflowSpec.description`
- `WorkflowSpec.spec` contains `run`, `variants`, `tasks`
- All downstream code accessing these fields updates accordingly

## Schema & Loader Changes

### New schemas in `src/schemas.ts`

- `ManifestEnvelopeSchema` — validates `apiVersion` + `kind` + `metadata` existence (internal, not exported)
- `AgentManifestSchema` — restructured for k8s envelope shape
- `WorkflowSpecSchema` — restructured for k8s envelope shape

### New `parseManifest()` function

Lives in `src/schemas.ts` (alongside existing schemas — it's a schema concern, not a workflow concern):

```
parseManifest(rawYaml):
  1. parse YAML string
  2. validate envelope (apiVersion, kind, metadata)
  3. dispatch on kind:
     "Agent"    → Schema.decodeUnknownSync(AgentManifestSchema)(parsed)
     "Workflow" → Schema.decodeUnknownSync(WorkflowSpecSchema)(parsed)
  4. return typed result
```

### Loader changes (`src/workflow/loader.ts`)

```
loadWorkflowSpec():
  1. loadAgentManifests() — unchanged
  2. read workflow.yml
  3. parseManifest(yaml) — NEW: validates envelope, dispatches on kind
     → kind must be "Workflow"
  4. resolveWorkflowSpec() — unchanged
  5. composeVariants() — unchanged
  6. validate executorRefs — unchanged
  7. return WorkflowSpec
```

### Agent registry changes (`src/workflow/agent-registry.ts`)

```
loadAgentDir():
  1. read agent.yml
  2. parseManifest(yaml) — NEW: validates envelope, dispatches on kind
     → kind must be "Agent"
  3. validate metadata.name matches dir name — unchanged
  4. auto-discover systemPrompt defaults — unchanged
  5. return AgentManifest
```

### Error handling

- `InvalidManifestEnvelopeError` — bad apiVersion, unknown kind, missing metadata (new)
- `AgentManifestParseError` — agent spec validation failures (existing)
- `WorkflowParseError` — workflow spec validation failures (existing)
- `DuplicateAgentError` — name collision (existing, unchanged)

## Field Access Migration

| Current access | New access |
|---|---|
| `spec.name` | `spec.metadata.name` |
| `spec.version` | `spec.metadata.version` |
| `spec.description` | `spec.metadata.description` |
| `spec.run` | `spec.spec.run` |
| `spec.variants` | `spec.spec.variants` |
| `spec.tasks` | `spec.spec.tasks` |
| `agent.name` | `agent.metadata.name` |
| `agent.settings` | `agent.spec.settings` |
| `agent.systemPrompt` | `agent.spec.systemPrompt` |

### Files most likely impacted

- `src/workflow/runner.ts` — reads `task.agent.executorRef`, task iteration
- `src/workflow/variants.ts` — reads `spec.tasks`, `spec.variants`
- `src/workflow/engine.ts` — reads `spec.name`, `spec.version`, `spec.run`
- `src/workflow/run-state-machine.ts` — reads task fields
- `src/cli/commands/list.ts` — displays workflow name/description
- `src/cli/commands/run.ts` — reads `spec.run`, `spec.name`
- `src/cli/commands/status.ts` — reads task names
- `src/cli/commands/resume.ts` — reads spec fields
- `src/prompts/builder.ts` — reads `spec.name`
- `src/mcp/server.ts` — reads workflow metadata
- `src/agent/config.ts` — reads agent settings
- `src/prompts/persona.ts` — reads agent systemPrompt
- `src/db/queries.ts` — stores workflow metadata

## Manifest YAML File Migrations

### Scope

- 4 shared agents under `manifest/agents/`
- 14 workflow-local agents under `manifest/workflows/*/agents/`
- 6 workflow.yml files under `manifest/workflows/`
- All workflow versions bumped by 1
- Test fixtures (`tests/fixtures/feature-dev.yml`) also updated
- No content changes to prompts, schemas, or persona files

### Example: Shared agent (`manifest/agents/verifier/agent.yml`)

Before:
```yaml
name: verifier
settings:
  model: default
```

After:
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Agent
metadata:
  name: verifier
spec:
  settings:
    model: default
```

### Example: Workflow (`manifest/workflows/feature-dev/workflow.yml`)

Before:
```yaml
name: feature-dev
version: 5
description: |
  Plan, implement...
run:
  entrypoint: plan
  timeout: 300s
tasks:
  ...
```

After:
```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: feature-dev
  version: 6
  description: |
    Plan, implement...
spec:
  run:
    entrypoint: plan
    timeout: 300s
  tasks:
    ...
```

## Testing

- Existing test fixtures updated to k8s style
- Schema tests updated for new envelope structure
- Loader tests updated to construct YAML with envelope
- Agent-registry tests updated for new agent shape
- Runner, engine, variants, CLI tests updated for nested field access
- New tests: `parseManifest()` rejects unknown apiVersion, unknown kind, missing metadata
- New tests: `parseManifest()` dispatches correctly on kind
- No database schema changes — DB stores name/version as separate columns already

## Out of Scope

- No changes to prompt template syntax (`{{mustache}}`)
- No changes to task definition shapes (`agent`, `forEach`, `template`, `context`)
- No changes to JSON schema output validation
- No changes to persona files (AGENTS.md, SOUL.md, IDENTITY.md)
- No new manifest kinds (future: `Kind: Extension`, `Kind: Skill`, etc.)
- No k8s-like label selectors or annotation system