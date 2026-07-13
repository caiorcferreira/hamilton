# How Workflows Run

> ⚠️ **Autonomous mode (experimental).** This documents Hamilton's workflow engine, which is under active rework and can change without notice. See [The three modes](./modes.md). For the working path today, use [Assisted mode](./skills.md).

What happens under the hood when you run `hamilton workflow run <slug> <prompt>`.

## The Lifecycle

Every workflow run goes through four phases:

```
load → resolve → execute → persist
```

### 1. Load

The engine reads the workflow YAML from `~/.hamilton/workflows/<slug>/workflow.yml`
(or the bundled location). It parses the YAML, validates it against the schema, and
builds an in-memory `WorkflowSpec`.

If the YAML is invalid (missing fields, wrong types, circular dependencies), loading
fails immediately with an error before any work starts.

### 2. Resolve

The engine resolves every `executorRef` in the workflow to an agent directory:

1. Check `~/.hamilton/workflows/<slug>/agents/<name>/` (workflow-local agents take priority)
2. Fall back to `~/.hamilton/agents/<name>/` (shared pool)
3. If neither exists, fail with `AgentNotFoundError`

This two-tier system means workflows can bring their own agents or reuse shared ones.
A workflow can even override a shared agent by providing a workflow-local version with
the same name.

### 3. Execute

Execution follows the DAG (Directed Acyclic Graph):

1. Tasks with no dependencies start immediately
2. When a task completes, downstream tasks become eligible
3. Tasks run sequentially within the engine (no parallelism)
4. Each task:
   - Builds a system prompt from agent persona files (INSTRUCTIONS.md, SOUL.md, CONTEXT.md)
   - Renders the task prompt through Handlebars with accumulated context
   - Injects matching guidelines based on the project's file types
   - Creates a Pi SDK session with the resolved model and enabled extensions
   - Calls the AI agent with the assembled prompts
   - Validates the agent's JSON output against the task's schema
   - Stores the output for downstream tasks

### 4. Persist

After each task, the engine writes state to `~/.hamilton/hamilton.db`:

- Task status (running → completed / failed)
- Token usage
- Output payloads to `~/.hamilton/runs/<id>/task-outputs/`

This enables pause/resume across processes. On resume, the engine reads the database,
skips completed tasks, and continues from the first pending task.

## Context Flow

Each task's output becomes available to downstream tasks through template variables.

Given a task named `triage` that outputs `{ "severity": "high", "root_cause": "..." }`:

```yaml
- name: fix
  dependencies: [triage]
  agent:
    executorRef: fixer
    prompt:
      content: |
        The bug is severity {{inputs.tasks.triage.outputs.severity}}.
        Root cause: {{inputs.tasks.triage.outputs.root_cause}}
```

Template variables use `{{inputs.tasks.<task-name>.outputs.<field>}}` syntax.
The engine uses [Handlebars](https://handlebarsjs.com/) for template rendering.

## State Machine

The engine is a finite state machine backed by SQLite:

```
idle → running → completed
         ↓
       paused → running
         ↓
       failed
```

- **idle**: Initial state, no run active
- **running**: Tasks are executing
- **paused**: Engine stopped after current task, waiting for resume
- **completed**: All tasks finished, summary written
- **failed**: A task exceeded `max_retries` without success

Transitions are validated at the database level. You can't complete a task that's
already completed, or pause a run that's already failed.

## What "Done" Means

A run is `completed` when every task reaches `done` status OR when a task with
`escalate_to: human` fails and the user decides to stop.

A run is `failed` when a task exhausts its retries and the `on_failure` policy is
`escalate_to: abort` or the user cancels.
