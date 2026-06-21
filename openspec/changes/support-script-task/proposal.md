## Why

Every executable task in Hamilton today must be an AI agent — even for deterministic operations like running `npm install`, creating a git worktree, or executing a build. This wastes tokens, adds latency, and introduces non-determinism where none is needed. Script tasks let workflows express shell-level operations directly in the YAML, running synchronously without an AI model.

## What Changes

- Add a `script` field to `WorkflowTask` as an alternative to `agent` — tasks can have **either** `script` or `agent` (or `template`)
- `script` tasks accept a `command: string` and optional `workdir: string`
- Script tasks run synchronously via `node:child_process`, capture stdout/stderr/exit code
- Script tasks participate in the same DAG, state machine, and failure handling (`on_failure`) as agent tasks
- Script task output is published into `workflowEnv.tasks[<name>].outputs` so downstream tasks can reference it via `{{inputs.tasks.<name>.outputs.*}}`
- Script output includes `stdout`, `stderr`, `exitCode`, and a required `status` field (`done` on exit code 0, `failed` on non-zero exit code)
- Script output is truncated at a configurable `maxOutputBytes` threshold (default 64KB), set via `script.maxOutputBytes` in `settings.yaml`
- Timeout support via the same `timeout.fixed` field used by agent tasks
- The `agentRegistry` is irrelevant for script tasks — no agent manifest lookup needed

## Capabilities

### New Capabilities

- `script-task`: A new kind of workflow task that runs shell commands synchronously instead of delegating to AI agents. Uses a `script` field in the workflow YAML with `command`, optional `workdir`, and standard `timeout` / `on_failure` fields.

### Modified Capabilities

_None._ Existing agent tasks, template tasks, and nested tasks are unaffected. The `script` field is additive — it coexists with `agent` and `template`.

## Impact

- **`src/types.ts`**: New `TaskScript` interface; `WorkflowTask` gains optional `script` field
- **`src/schemas.ts`**: New `TaskScriptSchema`; `WorkflowTaskSchema` gains `script`; schema filter updated to accept `script` as a valid executable field
- **`src/workflow/runner.ts`**: New execution branch for script tasks in the main loop; script dispatch in `executeSingleTask` or a separate `executeScriptTask` function
- **`src/workflow/engine.ts`**: `resolveTaskTimeout` already works on `task.agent?.timeout` — extend to also check `task.script?.timeout`
- **`src/workflow/run-state-machine.ts`**: `collectAllTaskNames` currently skips tasks without `agent`; must include script tasks
- **`src/workflow/script-config.ts`** (new): `loadScriptConfig` following the `loadTelemetryConfig` pattern — reads `script.maxOutputBytes` from `settings.yaml`
- **`src/cli/commands/init.ts`**: `buildSettingsYaml` gains a `script` section with `maxOutputBytes: 65536` default
- **Bundle workflow YAMLs**: No changes required — script tasks are opt-in per workflow
