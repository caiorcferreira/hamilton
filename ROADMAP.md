# Hamilton Roadmap

## Next Up

- [ ] Output token usage and time spent status after each step and at the end of the workflow
- [ ] Fix run command printing nothing at the start. No run id, status, nothing until a step end or the workflow end; also it didn't print plan task had started, just completed.
- [ ] Status command not showing indication of which current task is running
- [ ] Status command task order is still wrong; showing test/implement-story before plan.
- [ ] Add total time and token usage to workflow summary

- [ ] Change progress file location

## Completed

- [x] Fix status command — topological task ordering and newline display, tasks separated by new line, subtasks indented
- [x] Allow 'failed' in status enum on all task output schemas
- [x] Add output schema to all workflows based on the output defined in markdown prompts
- [x] Fix shared agent distribution — remove per-workflow agent duplication from ~/.hamilton/agents/, add shared/agents symlink per workflow dir, change YAML paths from ../../agents/shared/ to shared/agents/
- [x] Rename tamandua → hamilton branding in workflows and agent Co-Authored-By footers
- [x] Refactor event architecture to use Effect event bus — decouple onLog, onTokenEvent, onTokenUsage into single-responsibility subscribers (logger, DB writer, CLI renderer)
- [x] Refactor workflow engine from linear step-based to DAG task-based model — topological sort, reachable task collection, template/forEach expansion, auto-context from upstream outputs
- [x] Fix dynamic step generation: build a graph of tasks with DAG model, support forEach expansion for multi-instance tasks
- [x] Agent Co-Authored-By footer — hamilton@hamiltonai.dev in all agent commit messages
- [x] Add task prompt to prompt_built event
- [x] Implement retry feedback — on_failure.max_retries with event publishing on retry
- [x] Make write_step_output accept a JSON object with ajv schema validation
- [x] Task prompt template rendering — resolveTemplate handles {{...}} placeholders with dotted path resolution
- [x] Fix on_fail.max_retries dead config — remove step.max_retries, use on_fail.max_retries as single source of truth, migrate all YAMLs
- [x] Fix runId mismatch on error — move catchAll from run.ts to runner.ts where runId is in scope
- [x] Add write_step_output reminder injection — up to 2 reminder prompts before failing
- [x] Change workflow timeouts to 300 seconds
- [x] Fix token_in/token_out always 0: use session.getSessionStats() delta on turn_end instead of dead tokenUsage field
- [x] Make timeout configurable at the step level (step.timeoutSeconds → agent.timeoutSeconds → polling.timeoutSeconds → 300)
- [x] Print run ID at workflow start (in workflow_started event formatter), not only at the end
- [x] change what we call workflow id to workflow slug, for example `feature-dev` is the workflow slug
- [x] rename step id to step slug, for example `triage` is the step slug 
- [x] the workflow id must have the format `<workflow-slug>-<uuid>`
- [x] step id must have format `<workflow-id>-<step-slug>-<uuid>`
- [x] Add greenfield workflow — scaffold new projects from scratch with a bootstrapper agent that sets up project structure, dependencies, and initial files before the planner/developer loop
- [x] Create deterministic activities for workflows (e.g. activities to enter/exit worktree, setup/teardown steps)
- [x] Enrich `inputs.json` with workflow execution context (e.g. working directory where workflow was started, time when workflow was requested)
- [x] Add `do` workflow — single general-purpose agent that takes a prompt and executes it end-to-end without decomposition into steps (for quick tasks that don't need a full pipeline)
- [x] Improve visualization of `hamilton workflow list` — tabular output with columns, color, grouping by category
- [x] Add commands to list workflow runs
- [x] Use proper cli framework; we don't have support for help flag currently