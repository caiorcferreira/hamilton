# Kepler To Do

## Next Up

- [ ] Review XDG_CONFIG_HOME settings-path behavior
- [ ] Improve settings.yaml structure
- [ ] Keep improving the Assisted skills (`skills/kepler-*`)
- [ ] Keep artifact templates in `bundle/templates/` aligned with what the skills expect

## Completed

- [x] Strip Kepler to a template-setup CLI: removed the Autonomous engine and Ambient memory code (0.3.0). Full-feature state preserved on `archive/full-feature-pre-cleanup` and tag `pre-cleanup-0.2.1`
- [x] `kepler setup` copies `bundle/templates/` into `${XDG_CONFIG_HOME:-$HOME/.config}/.vialactea-works/kepler/templates/` (SDD framework artifact templates)
- [x] `kepler setup` copies `bundle/guidelines/` into `${XDG_CONFIG_HOME:-$HOME/.config}/.vialactea-works/kepler/guidelines/`
