# Hamilton

> *"How do you write like you're running out of time?"* — *Hamilton*

Hamilton is a coding toolbox focused on producing high-quality code and architecture. It brings
structure to AI-assisted coding — carrying a change from idea to merge through disciplined,
spec-driven steps that any coding agent can follow, or that Hamilton's own engine can run
autonomously.

> ⚠️ **ALPHA.** Hamilton is under active, early development. Interfaces, artifacts, workflow specs,
> and CLI commands can change at any time **without notice or backward-compatibility guarantees.**
> Only the Assisted mode (the skill bundle) is considered usable today.

## Three modes

Hamilton is organized around three modes of AI-assisted coding, spanning fully autonomous to
closely guided work. See [The three modes](docs/modes.md) for the full picture.

| Mode | What it is | Status |
|------|-----------|--------|
| **Autonomous** | A workflow engine runs a full multi-agent graph end-to-end from a single prompt | **Experimental** — runs today, being reworked to invoke the Assisted skills |
| **Assisted** | A portable, tool-agnostic bundle of spec-driven skills that guide any coding agent through a change | **Working** — the recommended way to use Hamilton today |
| **Ambient** | A memory layer that learns from your work and feeds your guidelines and past decisions into future changes | **Early** — phase-1 guideline ingestion exists; the learning loop is planned |

The modes are layers of one system, not competing products: the Assisted skills are the core, the
Autonomous engine's direction is to *run* those skills automatically, and the Ambient memory layer
feeds context into both.

## Assisted mode — start here

Assisted mode is a bundle of **[spec-driven development skills](docs/sdd-framework.md)** that carry a
change through a fixed sequence, one disciplined step at a time:

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

### Quick start

```bash
# 1. Install the CLI (used to install the shared artifact templates)
bun install
bun run install-local          # symlinks `hamilton` to ~/.local/bin/
hamilton setup                 # installs bundle/templates/ → ~/.hamilton/templates/

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

See the **[Skills reference](docs/skills.md)** for what each skill does, its inputs, and its outputs,
and the **[SDD framework](docs/sdd-framework.md)** for the design rationale.

### Artifacts

Assisted mode produces durable, per-project artifacts under `.hamilton/`:

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

## Autonomous mode — the workflow engine (experimental)

> ⚠️ **Experimental.** The engine runs today, but it predates the Assisted skills and is being
> reworked to *invoke* them. The workflow format, agent personas, and CLI surface can change without
> notice. For the working path, use Assisted mode above.

The engine takes a single prompt and runs a whole multi-agent pipeline with no human in the loop — it
loads a YAML workflow spec, resolves agent personas, builds a DAG of tasks, and executes them in
order, passing structured context forward. Runs are persisted in SQLite and can be paused and resumed
across processes.

```bash
hamilton setup                 # bootstrap ~/.hamilton/ (dirs, agents, DB, workflows, templates)
hamilton doctor                # check prerequisites
hamilton workflow list         # see what's installed

cd /path/to/your/git/repo
hamilton workflow run bug-fix "The login page crashes when the user submits an empty email"
```

See **[Getting started](docs/getting-started.md)** for the full engine walkthrough, and the engine
docs: [How workflows run](docs/how-workflows-run.md), [Workflow YAML](docs/workflow-yaml.md),
[CLI reference](docs/cli-reference.md), [Agent system](docs/agents-system.md),
[Workflows catalog](docs/workflows-catalog.md).

## Ambient mode — memory (early)

Project guidelines are ingested as canonical atoms into a dual-layer memory store (markdown +
SQLite) and retrieved via hybrid full-text/vector search, so relevant standards can be injected into
an agent's context. Failure is graceful — everything else runs without it. The broader learning loop
(store and recall historical decisions, with forgetting) is planned. See [ROADMAP](ROADMAP.md).

## Requirements

- **bun** >= 1.2.x — runtime, package manager, test runner.
- **A coding agent that loads `SKILL.md` files** (e.g. Claude Code) — for Assisted mode.
- **An existing git repo** — Hamilton operates on an existing repository (no greenfield support yet).
- **rtk** (optional) — `npm install -g @rtk-ai/rtk`; required for Autonomous-mode Pi SDK agent
  execution.

## Development

```bash
bun install
bun run build                  # tsc -p tsconfig.json
bun run test                   # bun --bun vitest run
bun run install-local          # build + symlink the CLI locally
bun run purge                  # remove the CLI symlink and ~/.hamilton/
```

**Do NOT use `bun test`** — use `bun --bun vitest run` (the native runner lacks `vi.mocked()`). See
[AGENTS.md](AGENTS.md) for conventions and [CONTRIBUTING.md](CONTRIBUTING.md) for the docs-sync rules.

### Pi SDK patch (Autonomous mode)

The Autonomous engine patches the Pi SDK to fix an upstream bug where `max_tokens` is not sent to the
GenPlat API gateway, truncating agent output at 2048 tokens. The full rationale, the exact edits, and
revert instructions live in [`patches/pi-ai-openai-maxTokens.md`](patches/pi-ai-openai-maxTokens.md).
