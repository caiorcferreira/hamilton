# Agent Manifest — Design Spec

## Problem

Agent definitions are embedded inline in each workflow's `workflow.yml` under a top-level `agents:` key. This means agents cannot be defined or reused independently of workflows. Tasks reference agents via `task.agent.ref: "agents.<name>"` — a dotted convention that requires stripping a prefix at runtime. Persona content (AGENTS.md, SOUL.md, IDENTITY.md) lives alongside the workflow YAML, connected only by path strings in `systemPrompt`.

## Solution

Extract agents into standalone YAML manifests (`agent.yml`). Each agent gets its own `agent.yml` file holding structural metadata (name, model, skills, optional systemPrompt path overrides). Persona Markdown files remain as siblings. Workflow YAML drops the `agents:` key entirely. Tasks reference agents by plain name via `executorRef`.

## Approach: Two-Pass Load

The loader first scans all `agent.yml` files (shared + workflow-local), building a unified agent registry keyed by name. Then it loads `workflow.yml`, which contains only orchestration (tasks). Every `executorRef` is resolved against the registry. Name collisions across shared and workflow-local agents are rejected at load time.

## Agent Manifest Schema

Each `agent.yml` defines a single agent. Structural metadata only — persona content stays in sibling Markdown files.

**File location patterns:**
- Shared: `manifest/agents/<name>/agent.yml`
- Workflow-local: `manifest/workflows/<wf>/agents/<name>/agent.yml`

**Example (`manifest/agents/setup/agent.yml`):**

```yaml
name: setup
settings:
  model: default
  skills:
    - git
    - worktree
```

**Conventions:**
- `systemPrompt` paths default to sibling `AGENTS.md`, `SOUL.md`, `IDENTITY.md` when those files exist. Only specify `systemPrompt` explicitly to override.
- The `role` field is removed — agent manifests have no `role`.
- `name` must be globally unique across all shared + workflow-local agents (load-time validation rejects duplicates).
- `settings.model` and `settings.skills` come from the manifest; workflows cannot override them.
- `name` in `agent.yml` must match the directory name (e.g. `manifest/agents/setup/agent.yml` must have `name: setup`).

**Example with explicit systemPrompt override:**

```yaml
name: planner
settings:
  model: default
  systemPrompt:
    agent: custom/AGENT_PROMPT.md
```

Here `soul` and `identity` still default to sibling SOUL.md and IDENTITY.md.

## Workflow YAML Schema Changes

The `workflow.yml` file drops the top-level `agents:` key. Tasks reference agents by name via `executorRef` (replacing `ref`), without the `agents.` prefix.

**Before (current):**

```yaml
name: feature-dev
version: 5
agents:
  - name: planner
    role: analysis
    settings:
      model: default
      systemPrompt:
        agent: agents/planner/AGENTS.md
        soul: agents/planner/SOUL.md
        identity: agents/planner/IDENTITY.md
tasks:
  - name: plan
    agent:
      ref: agents.planner
      prompt:
        content: |
          ...
```

**After (new):**

```yaml
name: feature-dev
version: 6
tasks:
  - name: plan
    agent:
      executorRef: planner
      prompt:
        content: |
          ...
```

**Changes summary:**
- Top-level `agents:` key removed from workflow.yml
- `task.agent.ref: "agents.<name>"` becomes `task.agent.executorRef: "<name>"` (no prefix)
- `task.agent.prompt`, `output`, `on_failure`, `timeout` stay nested under `task.agent`
- `version` bumps from 5 to 6
- The shared agents symlink mechanism (`ensureSharedAgentsSymlink`) is removed — agent manifests are loaded directly by the registry

## Loading & Resolution Pipeline

The loader changes from single-pass to two-pass:

**Pass 1 — Build agent registry:**
1. Scan `manifest/agents/*/agent.yml` for shared agents
2. Scan `manifest/workflows/<wf>/agents/*/agent.yml` for workflow-local agents
3. Merge into a single `Map<string, AgentManifest>` keyed by agent name
4. Reject on name collision with `DuplicateAgentError`
5. For each agent, resolve systemPrompt defaults: if `systemPrompt` is omitted and sibling `AGENTS.md` exists, set it to `AGENTS.md`/`SOUL.md`/`IDENTITY.md`

**Pass 2 — Load workflow:**
1. Parse `workflow.yml` (no `agents:` key expected)
2. For each task with `agent.executorRef`, look up the name in the registry
3. If not found, throw `AgentNotFoundError`
4. `WorkflowSpec` carries `agentRegistry: Map<string, AgentManifest>` instead of `agents: WorkflowAgent[]`

**Runner changes (`src/workflow/runner.ts`):**
- Replace `task.agent.ref.replace("agents.", "")` + `spec.agents.find()` with `agentRegistry.get(task.agent.executorRef)`
- `resolvePersona()` continues to work — it takes `SystemPromptPaths` + `workflowDir` and reads the files. Paths now originate from the agent manifest (with convention defaults applied).

**Validation (`src/schemas.ts`):**
- `TaskAgentSchema.ref` becomes `TaskAgentSchema.executorRef` (string, required)
- Remove `WorkflowSpecSchema.agents` validation
- Add post-parse validation: every `executorRef` in tasks must exist in the registry

## Error Handling & Validation

**New tagged errors:**
- `DuplicateAgentError` — two agents share the same name across shared + workflow-local registries. Includes both file paths and the conflicting name.
- `AgentNotFoundError` — a task's `executorRef` doesn't match any agent in the registry. Includes the task name and the missing executorRef value.
- `AgentManifestParseError` — an `agent.yml` file fails YAML parsing or schema validation. Includes the file path and parse error details.

**Validation rules (enforced at load time):**
1. Every `executorRef` in every task must resolve to an agent in the registry
2. Agent names must be globally unique (no shared/workflow-local collisions)
3. If `systemPrompt` paths are explicitly set, the referenced files must exist
4. Convention-defaulted systemPrompt files are optional (an agent can exist with no AGENTS.md)
5. `name` in agent.yml must match the directory name

**Downstream type changes:**
- `WorkflowSpec` drops `agents: WorkflowAgent[]`, adds `agentRegistry: Map<string, AgentManifest>`
- `WorkflowAgent`, `AgentRole`, and `AgentSettings` types replaced by `AgentManifest`
- `src/types.ts`: `TaskAgent.ref` becomes `TaskAgent.executorRef`
- `src/schemas.ts`: `TaskAgentSchema` field rename + removal of `WorkflowSpecSchema.agents`
- `src/workflow/shared-agents.ts` module and `ensureSharedAgentsSymlink()` removed entirely