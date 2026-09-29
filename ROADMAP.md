# Kepler roadmap

Kepler is a simple CLI that installs the Assisted-mode artifact templates and
coding guidelines into `${XDG_CONFIG_HOME:-$HOME/.config}/.vialactea-works/kepler/`. Legacy
`~/.hamilton/` global data is copied to this canonical location when it is absent, without deleting
the source. The Autonomous workflow engine and Ambient memory layer were removed; the last
full-feature state is preserved on the `archive/full-feature-pre-cleanup` branch and the
`pre-cleanup-0.2.1` tag.

## Next steps

- Keep the [Assisted skills](docs/skills.md) and the [SDD framework](docs/sdd-framework.md) sharp:
  each `SKILL.md` should stay tool-agnostic and self-contained.
- Keep the artifact templates in `bundle/templates/` aligned with what the skills expect.
- Keep the guidelines in `bundle/guidelines/` current for the reference stacks (general, golang, typescript).
