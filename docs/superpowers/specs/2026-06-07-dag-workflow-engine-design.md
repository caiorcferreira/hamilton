# DAG Workflow Engine Design

## Summary

Refactor the Hamilton workflow YAML format and execution engine from a linear step-based model to a DAG (directed acyclic graph) task-based model. Tasks declare `dependencies` forming the graph. The engine topologically sorts and executes sequentially. Templates and `forEach` enable reusable, dynamic task instantiation.

## Approach

Clean-slate rewrite of `src/schemas.ts`, `src/types.ts`, `src/workflow/loader.ts`, `src/workflow/engine.ts`, `src/workflow/runner.ts`, and `src/workflow/context.ts`. Convert all 20 workflow YAMLs. Reuse the state machine (adapted for tasks), event bus, pi-executor (with schema-aware write_step_output), agent persona resolution, and CLI commands. Delete old linear engine code after migration.

## YAML Schema

### Top-level

```yaml
version: 1
name: string
description: string          # optional
run:
  entrypoint: string         # task name — DAG starts here
  timeout: string            # Go-style duration ("300s"), default per-task timeout
agents: []
tasks: []
```

### Task definition

All fields are optional except `name`.

```yaml
tasks:
  - name: string             # required, unique within workflow
    dependencies: []string   # NOT allowed if this task is used as a template
    agent:                   # present = executable task
      ref: string            # dotted path, e.g. agents.planner
      timeout:
        fixed: string        # Go-style duration
      on_failure:
        max_retries: number
        escalate_to: string  # "human" pauses the run
        retry_step: string   # retry sibling task by name (templates only)
        on_exhausted:
          escalate_to: string
      output:
        schema: {}           # JSON Schema object for write_step_output validation
      prompt:
        content: string      # template with {{variable}} syntax
    template: string         # instantiates another task by name
    forEach:                 # only valid with template
      valueFrom:
        ref: string          # dotted path to array in accumulated context
      as: string             # variable name, accessible as vars.<name>
    context:                 # explicit field mapping (replaces auto-derived)
      fields:
        - name: string
          valueFrom:
            ref: string      # dotted path to upstream output field
    tasks:                   # nested sub-task definitions
      - name: string
        ...
```

### Template semantics

Any task — with or without nested `tasks` — can be used as a template. There is no special `template` flag or separate `templates:` section. A task referenced via `template: <name>` cannot have a `dependencies` field, because it is not part of the static execution graph — it is instantiated dynamically by the referencing task. Template tasks are never executed directly by the engine; they only run when another task instantiates them via `template`.

### Nested tasks (sub-tasks)

A task with nested `tasks` defines a sub-DAG. When used as a template, the sub-DAG is expanded inline. Sub-tasks follow the same schema rules: they can have `dependencies` (scoped to sibling sub-tasks), `agent`, `output`, `on_failure`, `retry_step`, and `prompt`.

### Agent definition

```yaml
agents:
  - name: string             # primary identifier (replaces old slug + name)
    role: string             # analysis | coding | verification | testing | pr | scanning
    description: string      # optional
    settings:
      model: string          # optional
      systemPrompt:
        agent: string        # path to AGENTS.md (relative to workflow dir)
        soul: string         # path to SOUL.md
        identity: string     # path to IDENTITY.md
      skills: []string       # optional
```

### Field mapping: old → new

| Old field | New field | Notes |
|---|---|---|
| `slug` (workflow) | removed | `name` is the identifier |
| `polling` | `run` | `run.entrypoint` + `run.timeout` |
| `polling.timeoutSeconds` | `run.timeout` | Go-style duration string ("300s") |
| `steps` | `tasks` | |
| `steps[].slug` | `tasks[].name` | |
| `steps[].type: loop` | `forEach` | |
| `steps[].input` | `agent.prompt.content` | |
| `steps[].expects` | removed | output validation via `output.schema` |
| `steps[].timeoutSeconds` | `agent.timeout.fixed` | Go-style duration string |
| `steps[].on_fail` | `agent.on_failure` | |
| `steps[].on_fail.retry_step` | `agent.on_failure.retry_step` | templates only |
| `agents[].slug` | `agents[].name` | |
| `agents[].name` (display) | removed | `name` is now both identifier and display |
| `agents[].workspace.baseDir` | removed | |
| `agents[].workspace.files` | `agents[].settings.systemPrompt` | file paths directly |
| `agents[].workspace.skills` | `agents[].settings.skills` | |
| `agents[].model` | `agents[].settings.model` | |
| `agents[].pollingModel` | removed | |
| `agents[].timeoutSeconds` | removed | per-task `agent.timeout.fixed` or `run.timeout` |
| `context` (top-level) | removed | auto-derived from upstream outputs |

## Engine

### Execution flow

1. Parse YAML → validate against schema
2. Collect tasks reachable from `run.entrypoint` by walking `dependencies` (static set)
3. Topological sort the known tasks
4. Execute sequentially in topological order:
   - When reaching a task with `template` + `forEach`, resolve the array at `valueFrom.ref` from accumulated context, dynamically create N instances, expand nested sub-tasks, execute all instances sequentially
   - The graph grows at runtime — additional tasks are discovered during execution
5. After each task completes, merge its output into the running context
6. Downstream tasks see context from all transitive upstream tasks

### Lazy DAG execution

The complete execution graph is not known at startup because `forEach` arrays are resolved from accumulated context at runtime. Topological sort is incremental: sort what's known, execute, discover more, repeat. The state machine must accommodate tasks inserted mid-run.

### Template expansion

When a task `T` has `template: X` and `forEach` with N items:

1. For each item, create an instance named `T/<index>` (e.g., `codify/0`, `codify/1`)
2. Bind `vars.<as>` to the current iteration value
3. If the template has nested `tasks`, expand those per instance (forming a per-iteration sub-DAG)
4. Execute all instances sequentially
5. Tasks that depend on `T` wait for all N instances to complete
6. Context from all instances is merged and available to downstream tasks

### Dotted path resolution

`ref` values use dotted path notation:
- `agents.planner` → find agent named `planner`
- `tasks.plan.outputs` → find task `plan` → its completed output object
- `tasks.plan.outputs.user_stories` → drill into output by key path
- `vars.user_story` → current forEach iteration value

### Timeout resolution

1. Task-level `agent.timeout.fixed` (if present)
2. Falls back to `run.timeout` (global default)
3. Both are Go-style duration strings, parsed via `go-duration-js`

### State machine

Adapt the existing `WorkflowRuntime` / `WorkflowRuntimeImpl` to track tasks instead of steps:
- Run states: `idle → running → paused → completed → failed` (unchanged)
- Task states: `pending → running → completed → failed` (was step states)
- `insertSteps` → `insertTasks` with dependency ordering
- Compound task IDs for dynamically-created tasks (e.g., `{runId}-codify/0-implement-{nanoid}`)
- Pause/resume: durable deferred signals, same mechanism

## Context

### Auto-derived (default)

When a task has no explicit `context.fields`, context is all transitive upstream task outputs shallow-merged in topological order. Later tasks overwrite earlier on key collision.

### Explicit `context.fields`

When present, replaces auto-derived context. Each field maps a dotted path from upstream outputs to a local name. Template sub-tasks inherit the instantiating task's context plus `vars.<as>`.

## Error Handling

```
agent.on_failure:
  max_retries: 4         # retry this task up to N times
  escalate_to: human     # "human" pauses the run
  retry_step: <name>     # retry sibling task (template sub-tasks only)
  on_exhausted:
    escalate_to: human   # what to do after all retries exhausted
```

- `max_retries` — retries the same task, publishing `StepRetrying` through EventBus
- `retry_step` — retries a different sibling task by `name` (only valid inside template expansion where sibling sub-tasks are in scope)
- `escalate_to: human` — pauses via `setDurableDeferred`, same mechanism as today
- Engine publishes events through existing `EventBus`

## Output Schema Validation

- `agent.output.schema` (JSON Schema object) is passed to the `write_step_output` tool
- When the agent calls `write_step_output`, the tool validates output against the schema
- On failure: tool returns schema errors to the agent (does not save output), agent self-corrects and retries
- On success: output saved, task marked complete
- No schema → no validation (current behavior)

The existing `write_step_output` tool in `src/agent/write-step-output-tool.ts` must be extended to accept an optional JSON Schema and perform validation using a JSON Schema validator (e.g., `ajv`).

## Shared Agent Resolution

- Source: `agents/shared/` (bundled shared personas: setup, verifier, pr, do)
- At runtime: before executing a workflow, engine checks if `workflows/<name>/shared/` exists
- If missing, copies shared agent files from the bundled `agents/shared/` into `workflows/<name>/shared/`
- Agent paths in YAML reference `shared/agents/<name>/AGENTS.md` (relative to workflow dir)
- This happens at execution time, not at install/build time

## Files to Create/Modify

### New / rewritten
- `src/schemas.ts` — new DAG schema using `@effect/schema`
- `src/types.ts` — new DAG types
- `src/workflow/engine.ts` — DAG builder: topological sort, template expansion, forEach instantiation
- `src/workflow/loader.ts` — updated YAML loading with new schema validation
- `src/workflow/context.ts` — dotted path resolution, auto-derived context merging
- `src/workflow/runner.ts` — DAG-aware sequential executor
- `src/agent/write-step-output-tool.ts` — add optional JSON Schema validation

### Adapted
- `src/workflow/run-state-machine.ts` — tasks instead of steps, dynamic task insertion
- `src/agent/activity.ts` — updated prompt building for new agent config structure
- `src/agent/persona.ts` — resolution from `settings.systemPrompt` paths
- `src/db/queries.ts` — task-level schema changes
- `src/db/schema.ts` — task-level schema changes
- `src/cli/commands/install.ts` — shared agent copy logic

### Deleted
- `src/workflow/deterministic-activities.ts` — git worktree activities replaced by task-based approach
- `src/agent/config.ts` — agent settings now inline in YAML

### YAML migration
- All 20 workflow YAMLs under `workflows/` converted to new format
- `version` reset to `1` for all

## Out of Scope

- Parallel task execution (sequential only)
- `notifications` field (already unused in current codebase)
- MCP server changes
- Observability / run-dir changes (reuse as-is)
- CLI command structure changes (reuse existing command tree)
