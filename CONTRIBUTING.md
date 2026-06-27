# Contributing to Hamilton

## Documentation Conventions

When making changes to Hamilton's own codebase, keep the documentation in `docs/`
synchronized. Every code change that affects user-facing behavior, APIs, configuration,
or CLI commands must include corresponding documentation updates.

### Mapping Code to Docs

| Code change area | Doc to update |
|------------------|---------------|
| New/changed CLI command, flag, or argument | `docs/cli-reference.md` |
| New/changed YAML fields, task types, or validation rules | `docs/workflow-yaml.md` |
| New/changed settings.yaml keys | `docs/settings.md` |
| New/changed agent manifest fields or persona conventions | `docs/agents.md` |
| New/changed agent INSTRUCTIONS.md or SOUL.md in `bundle/agents/` | `docs/agents.md` (Bundled Agents Reference) |
| New/changed workflow in `bundle/workflows/` | `docs/workflows-catalog.md` |
| New workflow YAML, variant, or task type | `docs/workflows-catalog.md` |
| New features or capabilities that change how users work | `docs/how-to/use-cases.md` or `docs/how-to/custom-workflows.md` |
| Changes to execution model, state machine, or engine behavior | `docs/philosophy.md` or `docs/how-to/operations.md` |

### Rules

1. **Documentation is not optional.** A code change is incomplete until the relevant docs are updated.
2. **Match the real behavior.** Documentation must reflect the actual code, not aspirations.
3. **Use the existing format.** Tables, code blocks, and section structures in each doc file are consistent -- follow them.
4. **Update the README.** If a change affects the quick-start flow, available workflows, commands table, or architecture section, update `README.md`.
5. **Inline examples are live.** YAML examples in docs should be valid workflow specs that the current engine can load. If the YAML format changes, update every example.
6. **No stale content.** When deprecating or removing a feature, remove its documentation in the same changeset. Do not leave `(deprecated)` notes -- cut cleanly.
