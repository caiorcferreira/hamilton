# Hamilton Roadmap

## Next Up

- [ ] change what we call workflow id to workflow slug, for example `feature-dev` is the workflow slug
- [ ] rename step id to step slug, for example `triage` is the step slug
- [ ] the workflow id must have the format `<workflow-slug>-<uuid>`
- [ ] step id must have format `<workflow-id>-<step-slug>-<uuid>`

## Completed

- [x] Add greenfield workflow — scaffold new projects from scratch with a bootstrapper agent that sets up project structure, dependencies, and initial files before the planner/developer loop
- [x] Create deterministic activities for workflows (e.g. activities to enter/exit worktree, setup/teardown steps)
- [x] Enrich `inputs.json` with workflow execution context (e.g. working directory where workflow was started, time when workflow was requested)
- [x] Add `do` workflow — single general-purpose agent that takes a prompt and executes it end-to-end without decomposition into steps (for quick tasks that don't need a full pipeline)
- [x] Improve visualization of `hamilton workflow list` — tabular output with columns, color, grouping by category
- [x] Add commands to list workflow runs
- [x] Use proper cli framework; we don't have support for help flag currently