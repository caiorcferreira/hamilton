# Workflow YAML Reference

Hamilton workflows are defined as YAML files at `~/.hamilton/workflows/<slug>/workflow.yml`.
Every workflow consists of agents (who does the work), tasks (what gets done), and a run
configuration (how it starts).

## Complete example (minimal)

```yaml
name: do
version: 1
description: Single general-purpose agent for arbitrary tasks.
run:
  entrypoint: execute
  timeout: 300s

agents:
  - name: doer
    role: coding
    settings:
      model: default
      systemPrompt:
        agent: agents/doer/AGENTS.md
        soul: agents/doer/SOUL.md
        identity: agents/doer/IDENTITY.md

tasks:
  - name: execute
    agent:
      ref: agents.doer
      prompt:
        content: |
          Execute the following task end-to-end.

          TASK:
          {{task}}

          Reply with:
          STATUS: done
          CHANGES: What you did
```

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique workflow name. Must match the directory name. |
| `version` | `number` | Yes | Schema version. Current: `1`. |
| `description` | `string` | No | Human-readable description. |
| `run` | `RunConfig` | Yes | Entrypoint task name and global timeout. |
| `agents` | `WorkflowAgent[]` | Yes | At least one agent definition. |
| `tasks` | `WorkflowTask[]` | Yes | The DAG of tasks to execute. |

### `RunConfig`

```yaml
run:
  entrypoint: plan
  timeout: 300s
```

| Field | Type | Description |
|-------|------|-------------|
| `entrypoint` | `string` | Name of the first task. Must match a `tasks[].name`. |
| `timeout` | `string` | Global per-task timeout. Format: `Ns`, `Nm`, `Nh` (e.g. `"300s"`, `"5m"`). Falls back to 300s if unparseable. |

## Agents

Each agent is a role + persona definition. Tasks reference agents by name.

```yaml
agents:
  - name: planner
    role: analysis
    description: Decomposes tasks into stories.   # optional
    settings:
      model: default                               # optional, defaults to "default"
      skills:                                       # optional
        - hamilton-agents
        - agent-browser
      systemPrompt:                                 # REQUIRED
        agent: agents/planner/AGENTS.md
        soul: agents/planner/SOUL.md
        identity: agents/planner/IDENTITY.md
```

### `AgentRole`

One of six predefined roles:

| Role | Purpose |
|------|---------|
| `analysis` | Problem decomposition, planning. |
| `coding` | Implementation, fixes, setup. |
| `verification` | Review, visual checks, correctness. |
| `testing` | Integration/E2E testing. |
| `pr` | Pull request creation. |
| `scanning` | Security scanning, vulnerability detection. |

### `SystemPromptPaths`

Three paths relative to the workflow directory. Each points to a markdown file:

| Field | Required | Wrapped as | Purpose |
|-------|----------|------------|---------|
| `agent` | **Yes** | `<agent>...</agent>` | Core behavioral instructions — process, output format. |
| `soul` | No | `<style>...</style>` | Agent personality, voice, values. |
| `identity` | No | `<identity>...</identity>` | Name and role label. |

Persona files can be **workflow-local** (e.g. `agents/planner/AGENTS.md`) or **shared**
(via the `shared/agents/` symlink to `~/.hamilton/agents/`, e.g.
`shared/agents/setup/AGENTS.md`).

## Tasks

Tasks form a DAG. Each task can define dependencies, which agent executes it, what prompt
to send, and how to handle failures.

### `WorkflowTask`

```yaml
tasks:
  - name: plan
    dependencies: []                         # optional: names of prerequisite tasks
    agent:                                   # required unless using template/tasks
      ref: agents.planner                    # "agents.<agent-name>"
      timeout:                               # optional: per-task override
        fixed: "120s"
      prompt:                                # required
        content: |
          Analyze this problem:
          {{task}}
      output:                                # optional: JSON schema for step output
        schema:
          content:
            type: object
            required: [status]
            properties:
            status:
              type: string
              enum: [done, failed]
      on_failure:                            # optional
        max_retries: 4
        escalate_to: human
    context:                                 # optional: explicit context fields
      fields:
        - name: repo
          valueFrom:
            ref: tasks.setup.outputs.repo
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique task name within the workflow. |
| `dependencies` | `string[]` | No | Task names that must complete before this one. |
| `agent` | `TaskAgent` | Conditional | The agent binding. Required unless using `template`+`forEach` or nested `tasks`. |
| `template` | `string` | No | Name of another task to reuse (for `forEach` loops). |
| `forEach` | `ForEach` | No | Iterate over an array, instantiating the template task for each item. |
| `context` | `ContextFields` | No | Explicit field mapping. If omitted, all accumulated outputs + vars are passed. |
| `tasks` | `WorkflowTask[]` | No | Nested sub-tasks (alternative to `template`). |

### Prompt

Exactly one of `content` or `file` must be present:

```yaml
# Inline content (with template variables)
prompt:
  content: |
    Fix this bug:
    {{task}}
    REPO: {{tasks.setup.outputs.repo}}

# Or: reference an external file
prompt:
  file: prompts/fix-prompt.md
```

When `file` is used, the loader reads the file relative to the workflow directory and
inlines it as `content` at load time. Same handling for `output.schema.file` (reads a
`.json` file and inlines it as `schema.content`).

### Template variables

Prompts support `{{path.to.key}}` template variables resolved from the runtime context:

| Pattern | Source |
|---------|--------|
| `{{task}}` | The original user prompt. |
| `{{tasks.<name>.outputs.<field>}}` | Output of a completed task. |
| `{{vars.<name>}}` | Current iteration variable (from `forEach.as`). |
| `{{run_id}}` | The generated run ID. |
| `{{progress}}` | Contents of the progress file. |
| `{{retry_feedback}}` | Feedback from a failed attempt (set on retry). |

Unresolved references are left as-is (the `{{...}}` token remains in the prompt).

### forEach (loops)

Iterate over an array of values, running a template task for each:

```yaml
tasks:
  - name: implement-stories
    dependencies: [plan]
    template: implement-story             # references the template task
    forEach:
      valueFrom:
        ref: tasks.plan.outputs.stories_json   # must be an array
      as: current_story                         # variable name in template

  - name: implement-story                 # template — never executed directly
    agent:
      ref: agents.developer
      prompt:
        content: |
          CURRENT STORY:
          {{vars.current_story}}
```

The engine iterates over the array from `valueFrom.ref`, creates a sub-task for each item,
and aggregates outputs under `tasks.implement-stories/0`, `tasks.implement-stories/1`, etc.

### On-failure

```yaml
on_failure:
  max_retries: 4       # retry up to 4 times (0 = no retries)
  escalate_to: human    # escalate on exhaustion
  retry_step: implement # optional: retry a different sibling task instead
  on_exhausted:
    escalate_to: human  # escalation when retries are depleted
```

| Field | Type | Description |
|-------|------|-------------|
| `max_retries` | `number` | How many times to retry the step on failure. |
| `escalate_to` | `string` | `"human"` for human intervention on failure. |
| `retry_step` | `string` | Name of a sibling task to re-execute instead of retrying this one. |
| `on_exhausted` | `OnExhausted` | Action when all retries are depleted. |

### Context

Control which outputs flow into each task's prompt context:

```yaml
# Explicit: only these fields are passed
context:
  fields:
    - name: repository
      valueFrom:
        ref: tasks.setup.outputs.repo
    - name: story
      valueFrom:
        ref: vars.current_story

# Auto (default): all accumulated outputs + vars are passed
```

When `context` is omitted, every completed task's outputs and all `vars` are merged into
the context. Explicit `context.fields` acts as a filter — only named fields are included.

### Output schemas

Define the expected JSON shape of a task's output:

```yaml
output:
  schema:
    content:                          # inline JSON schema
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done, failed]
        result:
          type: string

# Or: reference an external schema file
output:
  schema:
    file: schemas/result.json          # reads + inlines as schema.content
```

## DAG execution

1. `collectReachableTasks(entrypoint)` — BFS from the entrypoint, discarding unreachable tasks.
2. `topologicalSort(reachable)` — Kahn's algorithm ordering by dependencies.
3. Tasks execute sequentially in sorted order. Each task receives context from all
   previously completed tasks.

## Shared agents

Workflow YAMLs can reference persona files from the shared agent pool via the
`shared/agents/` symlink. On `hamilton init`, a symlink is created:

```
~/.hamilton/workflows/<slug>/shared/agents -> ~/.hamilton/agents/
```

This lets workflows use paths like `shared/agents/setup/AGENTS.md` to reference shared
agents, while workflow-local agents use paths like `agents/planner/AGENTS.md`.
