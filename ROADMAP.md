# Hamilton Roadmap

## Next Up

- [ ] Use XDG_HOME for settings file
- [ ] Review events stored in events.jsonl; events like task start, task end should be included.
- [ ] Fix suggestion in run commands that is incorrect, it should be `hamilton workflow status <status-id>`.
- [ ] Duplication between cwd and project_dir in the initial parameters must be solved
- [ ] Improve error handling when call fails
- [ ] Improve settings.yaml structure
- [ ] Inject avaiable tools dynamically into system prompt

### Core Engine
- [ ] Change `init` command to `setup`
- [ ] Create a `init` command that onboards a project in Hamilton by creating a `.hamilton` folder, ingesting older spec files into memory, etc.
- [ ] Move shared agents schema to the agent folder and use in workflows
- [ ] Refactor runner.ts to improve code quality
- [ ] Trigger workflows from other workflows

### Agent Capabilities
- [ ] Add a todo/task tracking tool for the agent

### Extensions & Integrations
- [ ] Refactor repo into multiple packages to expose pi extensions
- [ ] Extensions: Implement fork of [nopeek](https://github.com/spences10/my-pi/blob/main/packages/pi-nopeek/README.md)
- [ ] Long term memory
  - [ ] Extensions: Implement fork of [pirecall](https://github.com/spences10/my-pi/tree/main/packages/pi-recall)
  - [ ] Consolidated memory
  - [ ] Expose memory via MCP to allow other agents to use it.
- [ ] Review if RAG from Emanuel can be used to improve guidelines
- [ ] Integrate ponytail skill
- [ ] Integrate talk normal skill

### Tooling & DX
- [ ] Create a spec authoring skill
  - [ ] Organize files in `.specs` folder with `changes/<change-id>/<prd|plan|progress>.md`, `archives`, `templates`, `shared` and `memory` (long term memory of the project)

## Completed

- [x] Add more details to events, like stop reason, cached tokens, tool call id, response id
- [x] Add model being used for agent in events
- [x] Check if agent system prompt template is being rendered
- [x] Add some id to connect turn_end event to another event
- [x] Create a way to nudge the agent to write the plan/progress when necessary
- [x] Search for skills like Superpower's `brainstorm`
- [x] Align plan.json schema with planner INSTRUCTIONS.md output format — change_id, artifacts, task name, step id
- [x] Resolve review issues 2-6 in feature-dev workflow — has_frontend_changes, input.parameters typo, max_recursion_depth, plan task title, branch reference
- [x] Add currentIteration scope to WorkflowEnv for template subtask when-expression support
- [x] Evaluate when conditions on template subtasks and support nested template expansion
- [x] Align verifier agent output format with feature-dev workflow schema — feedback string replaces issues array
- [x] Create documentation for the project
- [x] Implement a `script` field in tasks
- [x] Use LSPs during file edit/file read — autocheck extension runs diagnostics post-edit
- [x] Remove retry_step and implement recursion support with `when` (CEL), `depth` tracking, and `max_recursion_depth`
- [x] Refactor context/passing layer from forEach/context/vars/Context to arguments/inputs.*/WorkflowEnv with agent-level CONTEXT.md templates
- [x] Use proper cli framework; we don't have support for help flag currently
- [x] Add commands to list workflow runs
- [x] Improve visualization of `hamilton workflow list` — tabular output with columns, color, grouping by category
- [x] Add `do` workflow — single general-purpose agent that takes a prompt and executes it end-to-end without decomposition into steps
- [x] Enrich `inputs.json` with workflow execution context (working directory, time requested)
- [x] Create deterministic activities for workflows (enter/exit worktree, setup/teardown steps)
- [x] Add greenfield workflow — scaffold new projects from scratch with a bootstrapper agent
- [x] Refactor workflow engine from linear step-based to DAG task-based model — topological sort, template/forEach expansion, auto-context from upstream outputs
- [x] Fix dynamic step generation: build a graph of tasks with DAG model, support forEach expansion for multi-instance tasks
- [x] Refactor event architecture to use Effect event bus — decouple into single-responsibility subscribers
- [x] Rename tamandua → hamilton branding in workflows and agent Co-Authored-By footers
- [x] Fix shared agent distribution — shared/agents symlink per workflow dir
- [x] Add output schema to all workflows based on the output defined in markdown prompts
- [x] Allow 'failed' in status enum on all task output schemas
- [x] Fix status command — topological task ordering, newline display, subtasks indented
- [x] Add total time and token usage to workflow summary — summary.json includes totalTokensIn, totalTokensOut, elapsedSeconds
- [x] Add per-step token/time output — CliRenderer accumulates TokenUsage deltas per step
- [x] Fix run command printing nothing at start — subscriber race condition fixed with yieldNow()
- [x] Fix status command running task indicator — parse currentTask slug and highlight with ⏳
- [x] Fix status command task order for template/forEach tasks — resolveDagBase handles nested compound slugs
- [x] Load context files based on file type — scan project for extensions, inject matching instructions
- [x] Support `prompt.file` in workflow yaml — resolveWorkflowSpec reads prompt content from file
- [x] Support `output.schema.file` in workflow yaml — resolveWorkflowSpec reads JSON schema from file
- [x] Refactor `output.schema` to `output.schema.content` — nest schema under content, add SchemaConfig type
- [x] Create Pi configs on init — --copy-pi-configs flag, fallback to sensible defaults
- [x] Change progress file location — ./.hamilton/workflows/progress-<YYYY-MM-DD>.txt
- [x] Add LSP extension wrapper — `createLspExtension()` wrapping `@spences10/pi-lsp`
- [x] Remove RTK_DISABLED env var — settings.yaml replaces env vars entirely
- [x] Add extension registry with settings-driven loading — RTK and LSP factories, ExtensionRegistry service
- [x] Add LSP binary checks to doctor command — checkLspBun, checkLspNode, checkLspPyright
- [x] Create default settings.yaml on init — extensions: rtk + lsp enabled by default
- [x] Extract prompts package — unify executor on ResolvablePrompt, delete old activity/persona/instructions
- [x] Add settings, workflow-yaml, and agent-instructions documentation
- [x] Update workflow files to use external schema files and prompt files
- [x] Implement YAML Agent manifest
- [x] Add support for skills
- [x] Refactor instructions to guidelines with rule-based tool call interception
- [x] Refactor workflow tools (write step output) into extension
- [x] Extensions: Implement fork of [redact](https://github.com/spences10/my-pi/blob/main/packages/pi-redact/README.md)
- [x] Review telemetry improvements based on my-pi
- [x] Review system prompt construction — refactor buildAgentPrompt to use systemTemplate
- [x] Fix bundle path references (manifest/ → bundle/) in init and install-logic
- [x] Remove identity prompt from agents
- [x] Rename agents.md to INSTRUCTIONS.md
- [x] Format INSTRUCTIONS.md files with STAR (Situation, Task, Action, Result)
- [x] Command status is printing nothing, just frozen then terminal
- [x] Add list of guideline files loaded for the task
- [x] Replace all references of `step` for `task`
- [x] Fix inconsistency in logs: some entries have `event` other have `_tag`. Only `event`.
- [x] Use custom nanoid alphabet without `-` to make ID separator unambiguous
- [x] Add full fledge templating
- [x] Inject output schema in task context
- [x] Improve error messages (suggest nearest match when workflow name not found)
- [x] Add flag to run command to execute in background
- [x] Guideline files in prompt built event should be `<guideline-name>/<file-name>`
- [x] Review application: never depend on string parsing for run/task relationships, use SQLite
- [x] Implement a git diff tool
- [x] Task prompt template rendering — resolveTemplate handles {{...}} with dotted path resolution
- [x] Make write_step_output accept a JSON object with ajv schema validation
- [x] Implement retry feedback — on_failure.max_retries with event publishing on retry
- [x] Add task prompt to prompt_built event
- [x] Agent Co-Authored-By footer in all agent commit messages
- [x] Fix on_fail.max_retries dead config — single source of truth from on_fail, migrate all YAMLs
- [x] Fix runId mismatch on error — move catchAll from run.ts to runner.ts where runId is in scope
- [x] Add write_step_output reminder injection — up to 2 reminder prompts before failing
- [x] Change workflow timeouts to 300 seconds
- [x] Fix token_in/token_out always 0: use session.getSessionStats() delta on turn_end
- [x] Make timeout configurable at the step level (step → agent → polling → 300)
- [x] Print run ID at workflow start, not only at the end
- [x] Change workflow id to workflow slug (e.g. `feature-dev`)
- [x] Rename step id to step slug (e.g. `triage`)
- [x] Workflow id format: `<workflow-slug>-<uuid>`
- [x] Step id format: `<workflow-id>-<step-slug>-<uuid>`
