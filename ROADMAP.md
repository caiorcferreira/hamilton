# Hamilton roadmap

Hamilton is now a simple CLI that installs the Assisted-mode artifact templates and
guidelines into `~/.hamilton/`. The Autonomous workflow engine and Ambient memory layer
were removed; the last full-feature state is preserved on the
`archive/full-feature-pre-cleanup` branch and the `pre-cleanup-0.2.1` tag.

## Next steps

- Keep the [Assisted skills](docs/skills.md) and the [SDD framework](docs/sdd-framework.md) sharp:
  each `SKILL.md` should stay tool-agnostic and self-contained.
- Keep the artifact templates in `bundle/templates/` aligned with what the skills expect.
- Keep the guidelines in `bundle/guidelines/` current for the reference stacks (general, golang, typescript).
