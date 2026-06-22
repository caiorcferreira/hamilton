# Workflow YAML Reference

Hamilton workflows are defined as YAML files stored at `~/.hamilton/workflows/<slug>/workflow.yml`.
Each workflow defines a DAG of tasks executed by agents, with structured input/output contracts and
configurable failure handling.

## Envelope

Every workflow YAML has a required Kubernetes-style envelope:

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Workflow
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `apiVersion` | `string` | Yes | Must be `dag.hamiltonai.dev/v1alpha1` |
| `kind` | `string` | Yes | Must be `Workflow` |

The envelope validation fails with a clear error if either field is missing or incorrect.

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiVersion` | `string` | Yes | API version literal |
| `kind` | `string` | Yes | Resource kind literal |
| `metadata` | `Metadata` | Yes | Name, version, description |
| `spec` | `Spec` | Yes | Run config, variants, tasks |

### Metadata

```yaml
metadata:
  name: bug-fix
  version: 2
  description: |
    Triage, investigate, and fix bugs...
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique slug. Must match the directory name under `~/.hamilton/workflows/`. |
| `version` | `number` | Yes | Schema version. Incremented when the workflow format changes. |
| `description` | `string` | No | Human-readable description displayed in `hamilton workflow list`. |

### Spec

```yaml
spec:
  run:
    entrypoint: triage
    timeout: 300s
    max_recursion_depth: 10         # optional

  variants:
    supported: [branchout, merge, worktree, github_pr]

  tasks:
    - name: triage
      ...
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `run` | `RunConfig` | Yes | Entrypoint task and global timeout |
| `variants` | `VariantsConfig` | No | Supported variant composition |
| `tasks` | `Task[]` | Yes | The DAG of tasks |

---

## RunConfig

```yaml
run:
  entrypoint: triage
  timeout: 300s
  max_recursion_depth: 10
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `entrypoint` | `string` | Yes | -- | Name of the first task. Must match a `tasks[].name`. |
| `timeout` | `string` | Yes | -- | Global per-task timeout. Format: `Ns`, `Nm`, `Nh` (e.g. `300s`, `5m`, `1h`). Falls back to 300s if unparseable. |
| `max_recursion_depth` | `number` | No | -- | Maximum recursion depth for tasks with `when` conditions. Prevents infinite loops. |

### Timeout Resolution

Per-task timeout follows a fallback chain:

1. `task.agent.timeout.fixed` or `task.script.timeout.fixed`
2. `spec.run.timeout` (global)
3. `300s` (hardcoded default)

Durations support the `go-duration-js` format: `300s`, `5m`, `1h`, `90s`, `10m30s`. Numeric values without a suffix are treated as seconds.

---

## Variants

Variants inject tasks at the start or end of the DAG to modify workflow behavior without duplicating workflow specs.

```yaml
variants:
  supported: [branchout, merge, worktree, github_pr]
```

### Built-in Variants

| Variant | Placement | Injects | Requirements |
|---------|-----------|---------|--------------|
| `branchout` | Start | `create-branch` task (git checkout -b) | Provides capability `branch-created` |
| `worktree` | Start | `create-worktree` task (git worktree add) | Provides `workspace-created`, replaces `branch-created` |
| `merge` | Start + End | `cleanup-worktree` (requires `workspace-created`), `finalize-merge` (squash-merge) | Requires `workspace-created` from `worktree` variant |
| `github_pr` | End | `create-pr` task (gh pr create) | -- |

### How Variant Composition Works

Variants compute a capabilities graph: `provides`, `replaces`, `requires`. When multiple variants are active:
- Tasks with replaced capabilities are filtered out
- Start tasks are prepended to the DAG (chained to the entrypoint)
- End tasks are appended as leaf nodes (depend on all original leaf tasks)

### Using Variants

Specify variant names with `--variants` on the command line:

```bash
hamilton workflow run bug-fix "Fix crash" --variants branchout,merge
```

### Workflow Slug Conventions

Bundled workflows with variant suffixes are installed as separate entries:

| Suffix | Variants Active |
|--------|----------------|
| (no suffix) | None -- local-only |
| `-worktree` | `worktree` (isolated workspace) |
| `-merge` | `branchout,merge` (branch + squash-merge) |
| `-merge-worktree` | `worktree,merge` (workspace + merge) |
| `-github-pr` | `branchout,github_pr` (branch + PR) |

These are convenience aliases. The underlying workflow YAMLs are the same -- only the default active variants differ.

---

## Tasks

Tasks form a DAG. Each task has a unique name, optional dependencies, and one of three execution types:
**agent** (AI-powered), **script** (shell command), or **template** (forEach expansion). Tasks can also contain
nested sub-tasks.

### Common Task Fields

```yaml
tasks:
  - name: triage
    dependencies: []                          # optional
    when: "inputs.user_input contains 'test'" # optional
    on_failure:
      max_retries: 4
      escalate_to: human
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique name within the workflow. Used as a template variable path component. |
| `dependencies` | `string[]` | No | Names of tasks that must complete before this one. |
| `when` | `string` | No | CEL expression. If it evaluates to false, the task is skipped. |
| `on_failure` | `OnFailure` | No | Retry and escalation policy. |
| `agent` | `AgentTask` | Conditional* | Execute with an AI agent via Pi SDK. |
| `script` | `ScriptTask` | Conditional* | Execute a shell command. |
| `template` | `string` | Conditional* | Reuse another task's definition (for forEach loops). |
| `tasks` | `Task[]` | Conditional* | Nested sub-tasks for grouping. |

\* Exactly one of `agent`, `script`, `template`, or `tasks` must be present.

### Agent Tasks

Delegates execution to an AI agent via the Pi SDK.

```yaml
- name: triage
  dependencies: []
  agent:
    executorRef: triager
    prompt:
      content: |
        Triage the following bug report.
        {{task}}
    output:
      schema:
        file: schemas/triage.json
    timeout:
      fixed: "120s"
  on_failure:
    max_retries: 4
    escalate_to: human
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `executorRef` | `string` | Yes | Name of the agent in the registry (from `agent.yml` `metadata.name`). |
| `prompt` | `Prompt` | Yes | Task prompt with template variables. |
| `output` | `OutputConfig` | No | JSON schema for validating agent output. |
| `timeout` | `TimeoutConfig` | No | Per-task timeout override. |

#### Prompt

Exactly one of `content` or `file` must be present:

```yaml
prompt:
  content: |
    Fix this bug: {{task}}
    REPO: {{inputs.tasks.triage.outputs.repo}}

# Or external file (relative to workflow dir):
prompt:
  file: prompts/fix-prompt.md
```

When `file` is used, the loader reads the file relative to the workflow directory and inlines it
as `content`. If the file extension is not `.hbs` or `.md`, template expansion is skipped
(`skipTemplate: true`).

#### Output Schema

Define the expected JSON shape of agent output. Inline or external file:

```yaml
output:
  schema:
    content:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done, failed]

# Or external JSON file (relative to workflow dir):
output:
  schema:
    file: schemas/triage.json
```

The schema is validated against agent output using Ajv. If validation fails, the task is retried
(up to `max_retries`).

All bundled output schemas require at minimum a `status` field with values `"done"`, `"failed"`,
or `"retry"`.

#### Timeout

```yaml
timeout:
  fixed: "120s"
```

| Field | Type | Description |
|-------|------|-------------|
| `fixed` | `string` | Go-style duration string (`Ns`, `Nm`, `Nh`). |

### Script Tasks

Executes a shell command directly (zero LLM tokens). Useful for deterministic operations like
build, install, and test commands.

```yaml
- name: install-deps
  dependencies: []
  script:
    command: npm install
    workdir: /app
    timeout:
      fixed: "60s"
    on_failure:
      max_retries: 2
  output:
    schema:
      file: schemas/script-output.json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | `string` | Yes | Shell command to execute. |
| `workdir` | `string` | No | Working directory for the command. |
| `timeout` | `TimeoutConfig` | No | Per-script timeout override. |
| `on_failure` | `OnFailure` | No | Retry policy. Default: no retries. |

Script output is captured up to `script.maxOutputBytes` from settings.yaml (default 65536 = 64KB).

### Template Tasks (forEach Loops)

Expands a task definition N times, once per item in an array. The template task (`template` field)
references another task by name. The iteration task has `arguments.forEach`.

```yaml
- name: implement-stories
  dependencies: [setup]
  template: implement-story
  arguments:
    forEach:
      valueFrom:
        ref: inputs.tasks.plan.outputs.tasks
      as: current_task

- name: implement-story       # template -- never executed directly
  agent:
    executorRef: developer
    prompt:
      content: |
        CURRENT TASK:
        {{inputs.parameters.current_task}}
```

**How it works:**
1. The engine resolves `valueFrom.ref` from the workflow environment
2. The resolved value must be an array
3. For each item, a dynamic task instance is created: `implement-stories/0`, `implement-stories/1`, etc.
4. The iteration variable is available as `inputs.parameters.<as>` in template variables
5. The template task definition (`implement-story`) defines the agent, prompt, and output schema

#### forEach

```yaml
forEach:
  valueFrom:
    ref: inputs.tasks.prioritize.outputs.stories_json
  as: current_story
```

| Field | Type | Description |
|-------|------|-------------|
| `valueFrom.ref` | `string` | Dotted path to an array in the workflow environment. |
| `as` | `string` | Variable name available in template as `inputs.parameters.<as>`. |

#### Parameters (Explicit)

Additional parameters can be passed alongside forEach:

```yaml
arguments:
  forEach:
    valueFrom:
      ref: inputs.tasks.plan.outputs.tasks
    as: current_task
  parameters:
    - name: build_command
      valueFrom:
        ref: inputs.tasks.setup.outputs.build_cmd
```

Each parameter is available as `inputs.parameters.<name>`.

### Nested Tasks (Compound)

Group related tasks under a parent:

```yaml
- name: parent-group
  tasks:
    - name: sub-task-1
      agent:
        executorRef: worker
        prompt:
          content: Do thing 1
    - name: sub-task-2
      dependencies: [sub-task-1]
      agent:
        executorRef: worker
        prompt:
          content: Do thing 2
```

Nested tasks undergo the same topological sort as top-level tasks. The parent task is considered
completed when all nested tasks are done.

Subtasks support `when` conditions and template expansion, enabling recursion within a template
iteration. The `currentIteration` scope provides access to sibling subtask outputs:

```yaml
- name: implement-story
  tasks:
    - name: code
      agent:
        executorRef: developer
        prompt:
          content: |
            Implement {{inputs.parameters.current_task}}
            {{#if inputs.parameters.validation_feedback}}
            ## Retry
            {{inputs.parameters.validation_feedback}}
            {{/if}}

    - name: verify
      dependencies: [code]
      agent:
        executorRef: verifier
        prompt:
          content: Verify the implementation...

    - name: retry-if-needed
      dependencies: [verify]
      when: 'inputs.currentIteration.tasks.verify.outputs.feedback != ""'
      template: implement-story
      arguments:
        parameters:
          - name: current_task
            valueFrom:
              ref: inputs.parameters.current_task
          - name: validation_feedback
            valueFrom:
              ref: inputs.currentIteration.tasks.verify.outputs.feedback
```

The `retry-if-needed` subtask re-enters the same template when the verifier returns feedback.
`max_recursion_depth` in `spec.run` limits how many times the recursion can loop.

---

## Template Variables

Agent prompts support `{{path.to.key}}` template variables resolved at runtime from the
workflow environment. The engine uses Handlebars with custom escaping.

### Path Resolution

| Pattern | Source |
|---------|--------|
| `{{inputs.cwd}}` | Current working directory |
| `{{inputs.tasks.<name>.outputs.<field>}}` | Output of a completed task |
| `{{inputs.parameters.<name>}}` | forEach iteration variable |
| `{{inputs.currentIteration.tasks.<name>.outputs.<field>}}` | Output of a sibling subtask within the current template iteration |
| `{{inputs.progress}}` | Contents of the progress file |
| `{{inputs.progress_file}}` | Path to the progress file |
| `{{retry_feedback}}` | Feedback from a failed attempt (set on retry) |
| `{{verify_feedback}}` | Feedback from a verify step that requested retry |
| `{{timeout_retry}}` | Context when retrying after a timeout |
| `{{completed_stories}}` | Accumulated completed story outputs |
| `{{stories_remaining}}` | Count of remaining stories |
| `{{<short-name>}}` | Short form access to common variables |

### Short Names

Many workflow YAMLs use short names that resolve to dotted paths:

| Short Name | Resolves To |
|------------|-------------|
| `{{severity}}` | `{{inputs.tasks.triage.outputs.severity}}` |
| `{{affected_area}}` | `{{inputs.tasks.triage.outputs.affected_area}}` |
| `{{reproduction}}` | `{{inputs.tasks.triage.outputs.reproduction}}` |
| `{{problem_statement}}` | `{{inputs.tasks.triage.outputs.problem_statement}}` |
| `{{root_cause}}` | `{{inputs.tasks.investigate.outputs.root_cause}}` |
| `{{fix_approach}}` | `{{inputs.tasks.investigate.outputs.fix_approach}}` |
| `{{changes}}` | `{{inputs.tasks.fix.outputs.changes}}` |
| `{{regression_test}}` | `{{inputs.tasks.fix.outputs.regression_test}}` |

Unresolved references are left as-is (the `{{...}}` token remains in the prompt).

### Strict Mode

When `strict` mode is enabled (configurable per prompt), all template variable paths must exist
in the context. Missing paths cause an error rather than being left unresolved.

### Skip Template

When `prompt.file` has a non-`.hbs`/non-`.md` extension, `skipTemplate` is set to `true`.
Raw content is passed through without Handlebars processing.

---

## Context Flow

Context accumulates automatically. Every completed task's output becomes available to all
downstream tasks through template variables. The engine merges outputs into the workflow
environment keyed by task name.

```
triage outputs   →  { repo, branch, severity, affected_area, reproduction, problem_statement }
investigate adds →  { root_cause, fix_approach }
setup adds       →  { build_cmd, test_cmd, baseline }
fix adds         →  { changes, regression_test }
verify reads     →  all of the above
```

---

## On-Failure Configuration

```yaml
on_failure:
  max_retries: 4
  escalate_to: human
  retry_step: implement
  on_exhausted:
    escalate_to: human
```

| Field | Type | Description |
|-------|------|-------------|
| `max_retries` | `number` | Maximum retry attempts (0 = no retries). Common values: 2-6. |
| `escalate_to` | `string` | `"human"` stops the run and flags for human intervention. |
| `retry_step` | `string` | Name of a sibling task to re-execute instead of retrying this one. |
| `on_exhausted` | `OnExhausted` | Action when all retries are depleted. |

### Retry Behavior

When a task fails:
1. The engine increments `retry_count`
2. If `retry_count < max_retries`: re-executes the task with escalated context (the failure
   reason is injected as `retry_feedback` or `verify_feedback` template variables)
3. If `retry_count >= max_retries` and `retry_step` is set: re-executes the named sibling task
4. If all exhausted and `escalate_to: human`: sets run status to `failed` with error details

### On-Exhausted

```yaml
on_exhausted:
  escalate_to: human
```

Defines the action when all retries (and optional `retry_step`) are depleted. Currently supports
`escalate_to: human`.

`on_exhausted` can also be placed directly under `on_failure.max_retries` as a shorthand (the
engine normalizes both locations).

---

## When Conditions (CEL)

Tasks can have a `when` field with a CEL-like expression that gates execution:

```yaml
- name: optional-task
  dependencies: [setup]
  when: "inputs.user_input contains 'test'"
  agent:
    executorRef: tester
    prompt:
      content: Run tests...
```

If the expression evaluates to `false`, the task is skipped (marked as completed without
execution). Combined with `max_recursion_depth`, this enables recursion patterns where a task
can loop until a condition is met.

---

## DAG Execution Algorithm

1. **Collect reachable tasks** -- BFS from the entrypoint, traversing dependencies. Tasks not
   reachable from the entrypoint are discarded.
2. **Topological sort** -- Kahn's algorithm produces a linear execution order respecting
   all dependency edges. Throws `"circular dependency detected"` if cycles exist.
3. **Execute sequentially** -- Tasks execute in sorted order. Each task receives the accumulated
   context from all previously completed tasks.
4. **Dynamic expansion** -- forEach/template tasks create sub-instances at runtime. Completed
   sub-tasks feed their outputs into the context for subsequent tasks.

---

## Shared vs. Workflow-Local Agents

Agent `executorRef` values are resolved through the two-tier agent registry:

1. **Workflow-local**: `~/.hamilton/workflows/<slug>/agents/<name>/` -- takes priority
2. **Shared pool**: `~/.hamilton/agents/<name>/` -- fallback

This allows workflows to define specialized agents (e.g., `triager`, `planner`) while sharing
common agents (e.g., `setup`, `verifier`).

See [Agent System](./agents.md) for details on agent manifest structure and persona files.

---

## Complete Example

A minimal bug-fix workflow:

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Workflow
metadata:
  name: bug-fix
  version: 2
  description: |
    Triage, investigate, and fix bugs in a new branch with automated verification.
spec:
  run:
    entrypoint: triage
    timeout: 300s

  variants:
    supported: [branchout, merge, worktree, github_pr]

  tasks:
    - name: triage
      dependencies: []
      agent:
        executorRef: triager
        prompt:
          content: |
            Triage the following bug report: {{task}}
        output:
          schema:
            file: schemas/triage.json
      on_failure:
        max_retries: 4
        escalate_to: human

    - name: investigate
      dependencies: [triage]
      agent:
        executorRef: investigator
        prompt:
          content: |
            Investigate root cause.
            SEVERITY: {{severity}}
            AFFECTED_AREA: {{affected_area}}
        output:
          schema:
            file: schemas/investigate.json
      on_failure:
        max_retries: 4
        escalate_to: human

    - name: fix
      dependencies: [investigate]
      agent:
        executorRef: fixer
        prompt:
          content: |
            Implement the fix.
            BUILD_CMD: {{inputs.tasks.setup.outputs.build_cmd}}
            VERIFY FEEDBACK (if retrying): {{verify_feedback}}
        output:
          schema:
            file: schemas/fix.json
      on_failure:
        max_retries: 4
        escalate_to: human

    - name: verify
      dependencies: [fix]
      agent:
        executorRef: verifier
        prompt:
          content: |
            Verify the fix.
            TEST_CMD: {{inputs.tasks.setup.outputs.test_cmd}}
            CHANGES: {{changes}}
        output:
          schema:
            file: schemas/verify.json
      on_failure:
        max_retries: 6
        escalate_to: human
```

This workflow requires 4 agents in the registry: `triager`, `investigator`, `fixer`, `verifier`.
The `setup` agent is referenced from the fix task via `inputs.tasks.setup.outputs.build_cmd`,
meaning the workflow expects a `setup` task to exist in the DAG (typically injected by a variant
or defined as an additional task).

---

## Validation

Workflow YAMLs are validated at load time against a Zod schema (`WorkflowSpecSchema`). Validation
errors include:

- Missing required envelope fields (`apiVersion`, `kind`)
- Wrong `apiVersion` or `kind` values
- Missing required `metadata.name`, `spec.run.entrypoint`
- Invalid task types (must have exactly one of `agent`, `script`, `template`, `tasks`)
- `executorRef` does not match any registered agent
- Circular dependencies in the DAG
- Non-array `valueFrom.ref` for forEach tasks

The engine reports the first validation error with a descriptive message. The workflow directory
name must match `metadata.name`.
