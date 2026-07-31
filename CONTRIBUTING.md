# Contributing to Hamilton

## Documentation Conventions

When making changes to Hamilton's own codebase, keep the documentation in `docs/`
synchronized. Every code change that affects user-facing behavior, APIs, configuration,
or CLI commands must include corresponding documentation updates.

### Mapping Code to Docs

| Code change area | Doc to update |
|------------------|---------------|
| New/changed CLI command, flag, or argument | `docs/skills.md` (setup reference) |
| New/changed artifact template in `bundle/templates/` | `docs/sdd-framework.md` |
| New/changed guideline in `bundle/guidelines/` | `docs/tutorials/custom-guidelines.md` |
| Changes to what `hamilton setup` installs | `docs/modes.md` or `README.md` |

### Rules

1. **Documentation is not optional.** A code change is incomplete until the relevant docs are updated.
2. **Match the real behavior.** Documentation must reflect the actual code, not aspirations.
3. **Use the existing format.** Tables, code blocks, and section structures in each doc file are consistent -- follow them.
4. **Update the README.** If a change affects the quick-start flow or what the CLI does, update `README.md`.
5. **No stale content.** When deprecating or removing a feature, remove its documentation in the same changeset. Do not leave `(deprecated)` notes -- cut cleanly.
