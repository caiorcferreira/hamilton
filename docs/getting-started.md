# Getting Started

> **Hamilton is in ALPHA.** Commands, flags, and workflow specs can change without notice. Only
> Assisted mode is considered usable today — see [The three modes](./modes.md).

Hamilton has three modes ([overview](./modes.md)). This guide starts with **Assisted mode** — the
working, recommended path — then walks through the **Autonomous** engine, which is experimental.

## Prerequisites

- **bun** >= 1.2.x — JavaScript runtime, package manager, and test runner.
- **A coding agent that loads `SKILL.md` files** (e.g. Claude Code) — for Assisted mode.
- **An existing git repository** — Hamilton operates on an existing repo (no greenfield support yet,
  except the engine's `scaffold` workflow).
- **rtk** >= 0.23.0 (optional) — for Autonomous-mode Pi SDK agent execution. Install with
  `npm install -g @rtk-ai/rtk`.

Optional LSP servers give the engine's agents inline diagnostics:

| Server | Package | File Types |
|--------|---------|------------|
| `typescript-language-server` | npm | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` |
| `pylsp` | pip | `.py`, `.pyi` |
| `gopls` | go install | `.go` |
| `biome` | npm | `.astro`, `.css`, `.json`, `.html`, `.vue` |
| `yaml-language-server` | npm | `.yaml`, `.yml` |
| `ruff` | pip | `.py`, `.pyi` |

See [LSP Autocheck](./features/lsp-autocheck.md) for how the engine uses LSP.

## Install the CLI

Clone and build:

```bash
git clone https://github.com/your-org/hamilton.git
cd hamilton
bun install
bun run build
bun run install-local
```

`install-local` symlinks `dist/cli/main.js` to `~/.local/bin/hamilton`. Make sure `~/.local/bin` is
on your `PATH`.

Then bootstrap `~/.hamilton/`:

```bash
hamilton setup
```

This creates the shared home directory and installs the artifact templates, shared agents,
guidelines, hooks, and bundled workflows:

```
~/.hamilton/
  agents/              # Shared agent personas (Autonomous mode)
  workflows/           # Installed workflow specs (Autonomous mode)
  templates/           # Artifact templates for the Assisted skills
  runs/                # Per-run output directories (Autonomous mode)
  guidelines/          # Language-specific coding guidelines (Ambient mode)
  memory/              # Guideline memory store (Ambient mode)
  skills/              # RTK skill manifests (Autonomous mode)
  executors/pi/agent/  # Pi SDK configuration (Autonomous mode)
  hamilton.db          # SQLite state machine persistence
  settings.yaml        # Global configuration
```

`hamilton setup` flags:

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing files (agents, skills, guidelines, templates) |
| `--copy-pi-configs` | Copy existing Pi SDK configs from `~/.pi/agent/` |
| `--model-alias <name>=<modelId>` | Register a model alias (repeatable). If no settings file exists, prompts interactively. |

If you already have the Pi SDK configured, preserve your model and auth settings:

```bash
hamilton setup --copy-pi-configs
```

Register model aliases for use in workflow YAMLs:

```bash
hamilton setup --model-alias sonnet=anthropic.claude-sonnet-4 --model-alias flash=google.gemini-flash-2
```

## Start here — Assisted mode

Assisted mode guides your coding agent through a change with a fixed sequence of skills:
`init → propose → plan → code → review → finish-work`. It needs two things beyond `hamilton setup`:

1. **Templates** — already installed by `hamilton setup` into `~/.hamilton/templates/`. The skills
   read them from there.
2. **The skills available to your coding agent.** The pipeline skills live in `skills/hamilton-*/`.
   Make them discoverable to your agent — for Claude Code, copy or symlink the `skills/hamilton-*`
   directories into a skills directory it loads (e.g. `~/.claude/skills/`), or point it at the
   `SKILL.md` paths. There is no CLI command that installs them into an agent; they are plain,
   portable Markdown.

Then, in your project, run the skills in order through your agent:

```
hamilton-init         → scaffold .hamilton/ and write AGENTS.md   (once per project)
hamilton-propose      → proposal + requirements + design          (optional front door)
hamilton-plan         → plan.md, the required task ledger
hamilton-code         → implement one task
hamilton-review       → judge the diff → verdict + feedback
hamilton-finish-work  → gate, sync specs, finish via merge / PR
```

The `code` and `review` steps loop until the review passes; `hamilton-orchestrate` can drive the
whole plan in one session. Artifacts land under your project's `.hamilton/` directory. See the
**[Skills reference](./skills.md)** for each skill's inputs and outputs and the
**[SDD framework](./sdd-framework.md)** for the design.

## Autonomous mode — the workflow engine (experimental)

> ⚠️ **Experimental.** The engine runs today, but it predates the Assisted skills and is being
> reworked to invoke them. Commands, workflow specs, and personas can change without notice.

The engine runs a whole multi-agent pipeline from a single prompt.

### Verify installation

```bash
hamilton doctor
```

```
 Checking prerequisites:
 ✓ rtk (version 0.23.0)
 ✓ typescript-language-server
 ✓ pylsp
 ✓ gopls
```

Missing tools show as failures but don't block Hamilton — LSP servers are only needed for the LSP
autocheck feature.

### List available workflows

```bash
hamilton workflow list
```

```
 NAME                    DESCRIPTION                                          VERSION  TASKS  AGENTS
 bug-fix                 Triage, investigate, and fix bugs...                 2        5      5
 bug-fix-github-pr       Same + GitHub PR                                     2        6      6
 bug-fix-merge           Same + squash-merge                                  2        6      6
 feature-dev             Plan, implement, test, and verify features           6        6      6
 ...
```

`list` reads installed workflows from `~/.hamilton/workflows/` and renders a color-coded table.

### Run your first workflow

```bash
cd /path/to/your/repo
hamilton workflow run bug-fix "The login page crashes when submitting an empty email"
```

What happens:
1. Hamilton loads the `bug-fix` workflow YAML spec.
2. Resolves agent personas (triager, investigator, setup, fixer, verifier).
3. Builds the DAG: triage → investigate → setup → fix → verify.
4. Executes each task, passing accumulated context forward.
5. Writes events, logs, and task outputs to `~/.hamilton/runs/<run-id>/`.

**Background mode (default):** returns immediately with a run ID; the workflow runs in a detached
child process. Monitor with `hamilton workflow status <id>` and `hamilton workflow logs <id>`.

**Foreground mode:** use `--foreground` (or `-f`) to see live progress:

```bash
hamilton workflow run bug-fix "Fix the auth token expiry bug" -f
```

### Monitor a running workflow

```bash
hamilton workflow status bug-fix-abc12
```

```
 Workflow: bug-fix
 Status: running (2/5 tasks)
 Started: 2025-06-15T10:30:00Z
 Elapsed: 45s
 Tokens: 1,200 in / 800 out

 Tasks:
 ✓ triage
 ⏳ investigate
 ○ setup
 ○ fix
 ○ verify
```

View logs:

```bash
hamilton workflow logs bug-fix-abc12                                   # all logs for a run
hamilton workflow logs bug-fix-abc12 --task bug-fix-abc12-fix-x7k2m   # a specific task
hamilton workflow logs bug-fix-abc12 -f                                # follow / tail
```

List recent runs:

```bash
hamilton workflow runs                    # all runs
hamilton workflow runs --status running   # only active
hamilton workflow runs --status failed    # only failures
hamilton workflow runs --limit 5          # last 5
```

### Pause and resume

```bash
hamilton workflow pause bug-fix-abc12     # completes the current task, then stops; state in SQLite
hamilton workflow resume bug-fix-abc12    # restores context, skips completed tasks, continues
```

### Run outputs

Every run produces structured output in `~/.hamilton/runs/<run-id>/`:

```
~/.hamilton/runs/bug-fix-abc12/
  input.json              # Original prompt + execution context
  events.jsonl            # Engine-level events (started, completed, failed, paused)
  summary.json            # Final summary (status, tokens, elapsed time)
  logs/
    bug-fix-abc12-triage-x3k9m.jsonl     # Per-task structured logs
    ...
  task-outputs/
    bug-fix-abc12-triage-x3k9m.json      # Task output payload
    ...
```

`summary.json`:

```json
{
  "runId": "bug-fix-abc12",
  "workflowId": "bug-fix",
  "status": "completed",
  "startedAt": "2025-06-15T10:30:00Z",
  "completedAt": "2025-06-15T10:32:15Z",
  "elapsedSeconds": 135,
  "totalTokensIn": 3200,
  "totalTokensOut": 1800,
  "taskResults": [...]
}
```

## Next Steps

**Understand Hamilton**
- [The three modes](./modes.md) — Autonomous / Assisted / Ambient, and what works today
- [Philosophy](./philosophy.md) — the rationale beneath all three modes

**Assisted mode (working)**
- [Skills reference](./skills.md) — every pipeline skill, its inputs and outputs
- [SDD framework](./sdd-framework.md) — the design of the spec-driven pipeline

**Autonomous mode (experimental)**
- [How Workflows Run](./how-workflows-run.md) — understand what just happened
- [Variants](./variants.md) — what variants are and how to combine them
- [Model Aliases](./model-aliases.md) — map short names to model IDs
- [Template Expansion](./template-expansion.md) — template variables and forEach
- [Workflow YAML Reference](./workflow-yaml.md) — the workflow spec format
- [CLI Reference](./cli-reference.md) — every command and flag
- [Agent System](./agents-system.md) — how agents work and how to create them
- [Workflows Catalog](./workflows-catalog.md) — all built-in workflows
- [Common Use Cases](./how-to/use-cases.md) — practical patterns
- [Troubleshooting](./how-to/troubleshooting.md) · [Debugging Runs](./how-to/debugging-runs.md)
- [Custom Workflows](./how-to/custom-workflows.md) · [Custom Guidelines](./tutorials/custom-guidelines.md)
- [CI/CD Integration](./how-to/ci-cd-integration.md) · [Telemetry](./telemetry.md) · [MCP Server](./mcp.md)
- [Operations](./how-to/operations.md) · [Settings Reference](./settings.md)
