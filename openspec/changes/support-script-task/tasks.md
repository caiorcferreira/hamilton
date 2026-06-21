## 1. Type definitions

- [ ] 1.1 Add `TaskScript` interface to `src/types.ts` with `command`, optional `workdir`, `timeout`, `on_failure`, and `output` fields
- [ ] 1.2 Add optional `script` field to `WorkflowTask` interface in `src/types.ts`

## 2. Schema validation

- [ ] 2.1 Add `TaskScriptSchema` to `src/schemas.ts` matching the `TaskScript` interface shape
- [ ] 2.2 Add `script` as an optional field on `WorkflowTaskSchema`
- [ ] 2.3 Update the `WorkflowSpecSchema` filter to accept `script` as a valid executable field (a task is valid if it has `agent`, `template`, `tasks`, OR `script`)
- [ ] 2.4 Enforce mutual exclusivity between `agent` and `script` at the schema level (a task must not have both)

## 3. Settings

- [ ] 3.1 Create `src/workflow/script-config.ts` with `loadScriptConfig` and `ScriptConfig` type (following the pattern of `src/telemetry/config.ts`: read `settings.yaml`, parse `script.maxOutputBytes`, default to 65536)
- [ ] 3.2 Add `script` section to default `settings.yaml` in `buildSettingsYaml` (`src/cli/commands/init.ts`) with `maxOutputBytes: 65536`

## 4. Runner execution

- [ ] 4.1 Import `child_process.execSync` in `src/workflow/runner.ts`
- [ ] 4.2 Load script config via `loadScriptConfig` at workflow start (alongside `loadTelemetryConfig`)
- [ ] 4.3 Add `executeScriptTask` function to `src/workflow/runner.ts` that runs the command with `execSync` using `maxBuffer` from config, captures stdout/stderr/exitCode, and returns the structured output object
- [ ] 4.4 Add dispatch logic in the main execution loop: if `task.script` is present, run the script branch instead of the agent branch
- [ ] 4.5 Integrate script execution with retry: reuse the existing `Schedule.recurs` pattern, retrying when `status !== "done"`
- [ ] 4.6 Render template variables in `command` before execution (same `resolveTemplate` as agent prompts)
- [ ] 4.7 Publish script output to `workflowEnv.tasks[<name>].outputs` in the same format as agent outputs
- [ ] 4.8 Publish `TaskStarted` and `TaskCompleted` / `TaskFailed` events for script tasks

## 5. Engine and state machine

- [ ] 5.1 Update `collectAllTaskNames` in `src/workflow/run-state-machine.ts` to include tasks that have a `script` field (not just `agent`)
- [ ] 5.2 Update `resolveTaskTimeout` in `src/workflow/engine.ts` to check `task.script?.timeout` in addition to `task.agent?.timeout`
- [ ] 5.3 Ensure `topologicalSort` and `collectReachableTasks` work unchanged (they don't inspect `agent` vs `script`)

## 6. Observability

- [ ] 6.1 Write script task output to the run directory via `writeTaskOutput` (same as agent tasks)
- [ ] 6.2 Include script task execution in engine log entries

## 7. CLI display

- [ ] 7.1 Show script tasks in `hamilton status` output with the same formatting as agent tasks
- [ ] 7.2 Show script tasks in `hamilton workflow list` / detail views

## 8. Tests

- [ ] 8.1 Add test for settings.yaml `script.maxOutputBytes` loading and default
- [ ] 8.2 Add test for schema validation: accept valid script task, reject task with both `agent` and `script`
- [ ] 8.3 Add test for script task execution: successful command, failed command, command with workdir
- [ ] 8.4 Add test for script output structure and downstream consumption
- [ ] 8.5 Add test for script task timeout
- [ ] 8.6 Add test for script task retry (max_retries)
- [ ] 8.7 Add test for template rendering in script commands
- [ ] 8.8 Add test for DAG integration: script task depends on agent task and vice versa
- [ ] 8.9 Add test for state machine: script task transitions through pending → running → completed/failed
- [ ] 8.10 Add test for output truncation at configured `maxOutputBytes`

## 9. Examples and documentation

- [ ] 9.1 Create an example workflow YAML in `bundle/workflows/` that demonstrates a script task (e.g., a `setup` task using a script instead of an agent for `npm install`)
