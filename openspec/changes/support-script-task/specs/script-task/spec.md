## ADDED Requirements

### Requirement: Script task declaration

A workflow task MAY declare a `script` field instead of an `agent` field. The `script` field SHALL contain a `command` string and an optional `workdir` string.

#### Scenario: Task with script field is valid

- **WHEN** a workflow YAML contains a task with `name`, `dependencies`, and a `script` field containing `command: "echo hello"`
- **THEN** the schema validation accepts the task without error

#### Scenario: Task with both script and agent is rejected

- **WHEN** a workflow YAML contains a task with both `script` and `agent` fields
- **THEN** the schema validation rejects the task with an error indicating mutual exclusivity

#### Scenario: Task with script and template fields

- **WHEN** a task has `template`, `arguments.forEach`, and the referenced template task has `script`
- **THEN** the schema validation accepts both tasks and the template expansion creates script task instances

### Requirement: Script execution

When the workflow runner encounters a task with a `script` field, it SHALL execute the `command` as a shell command using `/bin/sh -c` and capture the output.

#### Scenario: Successful command execution

- **WHEN** a script task has `command: "echo hello"`
- **THEN** the command executes, stdout is `"hello"`, exit code is `0`, and the task transitions to `completed`

#### Scenario: Failed command execution

- **WHEN** a script task has `command: "exit 1"`
- **THEN** the command executes, exit code is `1`, stderr captures any output, and the task transitions to `failed`

#### Scenario: Command with working directory

- **WHEN** a script task has `command: "pwd"` and `workdir: "/tmp"`
- **THEN** the command runs in `/tmp` and stdout reflects that directory

#### Scenario: Command inherits workflow working directory

- **WHEN** a script task has `command: "pwd"` and no explicit `workdir`
- **THEN** the command runs in the workflow environment's `cwd` (defaulting to `process.cwd()`)

### Requirement: Script output capture

Script task output SHALL be published to `workflowEnv.tasks[<taskName>].outputs` as a structured object containing `stdout`, `stderr`, `exitCode`, and `status`.

#### Scenario: Output object shape on success

- **WHEN** a script task with `command: "echo hello"` completes successfully
- **THEN** the output object has `{ stdout: "hello", stderr: "", exitCode: 0, status: "done" }`

#### Scenario: Output object shape on failure

- **WHEN** a script task with `command: "cat /nonexistent"` fails (non-zero exit code)
- **THEN** the output object has `exitCode: 1` (or non-zero) and `status: "failed"`

#### Scenario: Downstream task references script output

- **WHEN** a downstream agent task references `{{inputs.tasks.my-script.outputs.stdout}}`
- **THEN** the template renders the captured stdout value from the script task

### Requirement: Script timeout

Script tasks SHALL respect the same `timeout.fixed` field as agent tasks. If the command exceeds the timeout, it SHALL be killed and the task SHALL fail.

#### Scenario: Task-level timeout honored

- **WHEN** a script task has `script.timeout.fixed: "2s"` and the command takes longer
- **THEN** the command is terminated after 2 seconds and the task transitions to `failed`

#### Scenario: Falls back to workflow-level timeout

- **WHEN** a script task has no explicit `timeout` but the workflow has `run.timeout: "300s"`
- **THEN** the script task uses the workflow-level timeout

### Requirement: Script retry on failure

Script tasks SHALL support `on_failure.max_retries` identically to agent tasks. On failure, the command SHALL be re-executed up to the configured retry count.

#### Scenario: Successful retry after transient failure

- **WHEN** a script task with `on_failure.max_retries: 3` fails once then succeeds on retry
- **THEN** the task transitions to `completed` after the successful retry

#### Scenario: Retry exhaustion

- **WHEN** a script task with `on_failure.max_retries: 2` fails on all attempts
- **THEN** the task transitions to `failed` after exhausting retries

### Requirement: Script tasks in the DAG

Script tasks SHALL participate in the same DAG topology as agent tasks. They SHALL have `dependencies`, respect topological sort order, and produce output consumable by downstream tasks.

#### Scenario: Script task executes after upstream agent

- **WHEN** a script task has `dependencies: [triage]` and triage is an agent task
- **THEN** the script task executes only after triage completes successfully

#### Scenario: Agent task consumes script task output

- **WHEN** an agent task has `dependencies: [my-script]` and the script task produces output
- **THEN** the agent task receives `{{inputs.tasks.my-script.outputs}}` in its prompt template context

### Requirement: Template rendering in script commands

Script command strings SHALL be rendered through the template engine before execution, allowing references to `{{inputs.*}}` from upstream tasks.

#### Scenario: Template variable in command

- **WHEN** a script task has `command: "echo {{inputs.tasks.setup.outputs.build_cmd}}"` and setup produced `build_cmd: "npm run build"`
- **THEN** the rendered command is `"echo npm run build"` and stdout is `"npm run build"`

### Requirement: Script task state machine participation

Script tasks SHALL register in the runtime state machine identically to agent tasks. They SHALL have rows in the `tasks` table, transition through `pending → running → completed/failed`, and be visible in the `status` command output.

#### Scenario: Script task appears in status output

- **WHEN** a workflow with a script task named `check-deps` is running
- **THEN** `hamilton status` shows `check-deps` with its current state (pending/running/completed/failed)

#### Scenario: Paused workflow resumes script tasks

- **WHEN** a workflow is paused before a script task executes and later resumed
- **THEN** the script task executes on resume, transitioning from `pending` to `running` to `completed`
