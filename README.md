# Hamilton

> *"How do you write like you're running out of time?"* — *Hamilton*

Hamilton is a coding toolbox focused on producing high-quality code and architecture. It brings
structure to AI-assisted coding — carrying a change from idea to merge through disciplined,
spec-driven steps that any coding agent can follow.

Hamilton is now a **simple CLI that sets up templates**: `hamilton setup` installs the
spec-driven-development artifact templates and coding guidelines into `~/.hamilton/`, which the
Assisted skills read. The Autonomous workflow engine and Ambient memory layer were removed in
0.3.0; the last full-feature state is preserved on the `archive/full-feature-pre-cleanup` branch
and the `pre-cleanup-0.2.1` tag.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/caiorcferreira/hamilton/main/install.sh | bash

npx skills add https://github.com/caiorcferreira/hamilton
```

The first command installs the Hamilton CLI binary and sets up artifacts in `~/.hamilton`. The
second installs the skills in your preferred coding agent.

**Environment variables** (optional):
- `HAMILTON_VERSION` — install a specific release version (default: latest)
- `HAMILTON_REPO_SLUG` — GitHub repo slug to download from (default: `caiorcferreira/hamilton`)
- `HAMILTON_BUNDLE_DIR` — override where `hamilton setup` reads `bundle/` from (for development)

See the **[Skills reference](docs/skills.md)** for what each skill does, its inputs, and its outputs,
and the **[SDD framework](docs/sdd-framework.md)** for the design rationale.

## What the CLI does

`hamilton setup` bootstraps `~/.hamilton/`:

```
~/.hamilton/
  templates/     # SDD artifact templates (plan.md, design.md, proposal.md, ...)
  guidelines/    # coding guidelines (general, golang, typescript)
  settings.yaml  # default settings
```

```bash
hamilton setup        # bootstrap ~/.hamilton/ (idempotent)
hamilton setup --force  # re-copy templates and guidelines, reset settings
hamilton --help
```

## Assisted skills — start here

The **[spec-driven development skills](docs/sdd-framework.md)** carry a change through a fixed
sequence, one disciplined step at a time:

```
init ──▶ [ propose ] ──▶ plan ──▶ code ──▶ review ──▶ finish-work
 (once)   optional                  ▲         │
                                    └─────────┘
                          review requests changes → code
```

Each step is a self-contained `SKILL.md` that names no tool and depends on no engine internals — only
on the project's standards (`AGENTS.md`), the shared artifact templates Hamilton installs at
`~/.hamilton/` (via `hamilton setup`), and the per-change artifacts under the project's own
`.hamilton/` directory. The same skill guides a person in an editor or an agent like Claude Code. The
heavyweight front door (`propose`) is optional; the only required step is `plan`.

### Artifacts

The skills produce durable, per-project artifacts under `.hamilton/`:

```
.hamilton/
  specs/                              # canonical capability truth (living)
    <capability>.md
  changes/
    <YYYY-MM-DD-title>/
      proposal.md                     # optional — why
      design.md                       # optional — how
      requirements/<capability>.md    # optional — what (delta form)
      plan.md                         # required — the handoff contract
      progress.md                     # execution ledger — what happened
      review.md                       # review verdict + feedback
```

Changes are ephemeral; specs are durable. When a change finishes, its requirement deltas fold into
`specs/`, the project's always-current requirements truth.

## Requirements

- **A coding agent that loads `SKILL.md` files** (e.g. Claude Code).
- **An existing git repo** — Hamilton operates on an existing repository (no greenfield support yet).

## Development

### Quick start

```bash
# 1. Install the CLI

# For end users, use the install.sh script:
curl -fsSL https://raw.githubusercontent.com/caiorcferreira/hamilton/main/install.sh | bash

# For contributors building from source:
bun install
bun run build                  # compile TypeScript
bun run install-local          # symlink to ~/.local/bin/
hamilton setup                 # install bundle/templates/ + bundle/guidelines/ → ~/.hamilton/

# 2. Make the pipeline skills available to your coding agent.
#    The skills live in skills/hamilton-*/ — copy or symlink them into a
#    skills directory your agent loads (e.g. ~/.claude/skills/), or point
#    the agent at the SKILL.md paths.

# 3. In your project, run the skills through your agent, in order:
#    hamilton-init         → scaffold .hamilton/ and write AGENTS.md (once)
#    hamilton-propose      → proposal + requirements + design (optional)
#    hamilton-plan         → plan.md (the required task ledger)
#    hamilton-code         → implement one task
#    hamilton-review       → judge the diff
#    hamilton-finish-work  → gate, sync specs, merge / PR
```

**Build and test commands** (for contributors):

```bash
bun install                    # install dependencies
bun run build                  # compile TypeScript (tsc -p tsconfig.json)
bun run test                   # run tests (bun --bun vitest run)
bun run install-local          # build + symlink the CLI locally
bun run purge                  # remove the CLI symlink and ~/.hamilton/
```

**Do NOT use `bun test`** — use `bun run test` which uses the native runner (the fallback lacks `vi.mocked()`). See
[AGENTS.md](AGENTS.md) for conventions and [CONTRIBUTING.md](CONTRIBUTING.md) for the docs-sync rules.

## License

Hamilton is licensed under the [Apache License 2.0](LICENSE). Some skills in this repository are adapted from other projects; their original licences are reproduced in [NOTICE](NOTICE) and in a `NOTICE` file beside each forked skill directory.
