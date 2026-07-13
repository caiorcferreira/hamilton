# Hamilton roadmap

Brainstorms, ideas, and proposals for the project's next steps, grouped by the
[mode](docs/modes.md) each advances.

## Ambient mode (memory)

### Implement long-term memory

Create a learning pipeline that stores historical decisions, changes, preferences, and facts about
each project. Must support forgetting.

Use a database (SQLite/PGLite) instead of markdown files.

### Improve guidelines

Implement a real RAG pipeline for guidelines. Maybe merge with long-term memory.

## Autonomous mode (engine)

### Invoke the Assisted skills from workflows

Refactor the engine's `feature-dev` agents and the merge / PR / worktree variants to *invoke* the
spec-driven skills instead of embedding their own copies of the instructions — the integration that
makes Autonomous mode run the Assisted pipeline automatically.

## Cross-cutting

### Package infrastructure

Design an extension system based on packages. Each package may bundle agents, workflows, variants,
skills, hooks, and extensions. A development package, for example, would ship workflows like
`feature-dev` plus a hook that nudges the agent to record its progress if it failed to do so.
