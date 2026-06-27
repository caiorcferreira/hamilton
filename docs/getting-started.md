# Getting Started

Hamilton orchestrates multi-step AI agent pipelines from the command line. This guide walks through installation, initialization, and running your first workflow.

## Prerequisites

- **bun** >= 1.2.x -- JavaScript runtime, package manager, and test runner
- **rtk** >= 0.23.0 (optional) -- Rewriting Tool Kit for Pi SDK agent execution. Install with `npm install -g @rtk-ai/rtk`
- **An existing git repository** -- Hamilton workflows operate on git repos (no greenfield support yet, except for the `scaffold` workflow)

Optional LSP servers for enhanced agent diagnostics:

| Server | Package | File Types |
|--------|---------|------------|
| `typescript-language-server` | npm | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` |
| `pylsp` | pip | `.py`, `.pyi` |
| `gopls` | go install | `.go` |
| `biome` | npm | `.astro`, `.css`, `.json`, `.html`, `.vue` |
| `yaml-language-server` | npm | `.yaml`, `.yml` |
| `ruff` | pip | `.py`, `.pyi` |

See [LSP Autocheck](./features/lsp-autocheck.md) for how Hamilton uses LSP to provide inline diagnostics to agents.

## Installation

Clone the repository and install:

```bash
git clone https://github.com/your-org/hamilton.git
cd hamilton
bun install
bun run build
```

Install the CLI globally:

```bash
bun run install-local
```

This symlinks `dist/cli/main.js` to `~/.local/bin/hamilton`. Make sure `~/.local/bin` is in your `PATH`.

## Initialize Hamilton

Bootstrap the `~/.hamilton/` directory with all required resources:

```bash
hamilton init
```

This creates:

```
~/.hamilton/
  agents/              # Shared agent personas (setup, verifier, do, pr)
  workflows/           # Installed workflow specs (YAML) + per-workflow agents
  runs/                # Per-run output directories
  guidelines/          # Language-specific coding guidelines
  skills/              # RTK skill manifests
  executors/pi/agent/  # Pi SDK configuration
  hamilton.db          # SQLite state machine persistence
  settings.yaml        # Global configuration
```

Available flags:

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing files (agents, skills, guidelines) |
| `--copy-pi-configs` | Copy existing Pi SDK configs from `~/.pi/agent/` |
| `--model-alias <name>=<modelId>` | Register a model alias (repeatable). If no settings file exists, prompts interactively. |

If you already have Pi SDK configured (`~/.pi/agent/settings.json`), use `--copy-pi-configs` to preserve your model and authentication settings:

```bash
hamilton init --copy-pi-configs
```

To register model aliases for use in workflow YAMLs:

```bash
hamilton init --model-alias sonnet=anthropic.claude-sonnet-4 --model-alias flash=google.gemini-flash-2
```

## Verify Installation

Run the doctor command to check prerequisites:

```bash
hamilton doctor
```

Output:

```
 Checking prerequisites:
 ✓ rtk (version 0.23.0)
 ✓ typescript-language-server
 ✓ pylsp
 ✓ gopls
```

The doctor runs four checks in parallel:
- **rtk** -- binary exists and version >= 0.23.0
- **typescript-language-server** -- LSP for TypeScript/JavaScript
- **pylsp** -- LSP for Python
- **gopls** -- LSP for Go

Missing tools show as failures but don't block Hamilton. LSP servers are only needed for the LSP autocheck feature.

## List Available Workflows

See what workflows are installed:

```bash
hamilton workflow list
```

Output:

```
 NAME                    DESCRIPTION                                          VERSION  TASKS  AGENTS
 bug-fix                 Triage, investigate, and fix bugs...                 2        5      5
 bug-fix-github-pr       Same + GitHub PR                                     2        6      6
 bug-fix-merge           Same + squash-merge                                  2        6      6
 bug-fix-worktree        Worktree variant, local-only                         2        5      5
 bug-fix-merge-worktree  Worktree variant + merge                             2        6      6
 feature-dev             Plan, implement, test, and verify features           6        6      6
 feature-dev-github-pr   Same + GitHub PR + code review                       6        7      6
 ...
```

The `list` command reads installed workflows from `~/.hamilton/workflows/` and renders a color-coded table.

## Run Your First Workflow

Navigate to an existing git repository and run a bug-fix workflow:

```bash
cd /path/to/your/repo
hamilton workflow run bug-fix "The login page crashes when submitting an empty email"
```

What happens:
1. Hamilton loads the `bug-fix` workflow YAML spec
2. Resolves agent personas (triager, investigator, setup, fixer, verifier)
3. Builds the DAG: triage -> investigate -> setup -> fix -> verify
4. Executes each task, passing accumulated context forward
5. Writes events, logs, and task outputs to `~/.hamilton/runs/<run-id>/`

**Background mode (default):** The command returns immediately with a run ID. The workflow executes in a detached child process. Monitor with `hamilton workflow status <id>` and `hamilton workflow logs <id>`.

**Foreground mode:** Use `--foreground` (or `-f`) to see live progress in the terminal:

```bash
hamilton workflow run bug-fix "Fix the auth token expiry bug" -f
```

## Monitor a Running Workflow

Check status of any run:

```bash
hamilton workflow status bug-fix-abc12
```

Output:

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

View detailed logs:

```bash
# View all logs for a run
hamilton workflow logs bug-fix-abc12

# View logs for a specific task
hamilton workflow logs bug-fix-abc12 --task bug-fix-abc12-fix-x7k2m

# Follow mode -- tail logs in real time
hamilton workflow logs bug-fix-abc12 -f
```

List all recent runs:

```bash
hamilton workflow runs                    # all runs
hamilton workflow runs --status running   # only active
hamilton workflow runs --status failed    # only failures
hamilton workflow runs --limit 5          # last 5
```

## Pause and Resume

Pause a running workflow:

```bash
hamilton workflow pause bug-fix-abc12
```

The engine completes the current task, then stops. State is preserved in SQLite.

Resume later:

```bash
hamilton workflow resume bug-fix-abc12
```

Completed tasks are skipped. The engine restores context from the database and continues with the next pending task.

## Run Outputs

Every run produces structured output in `~/.hamilton/runs/<run-id>/`:

```
~/.hamilton/runs/bug-fix-abc12/
  input.json              # Original prompt + execution context
  events.jsonl            # Engine-level events (started, completed, failed, paused)
  summary.json            # Final summary (status, tokens, elapsed time)
  logs/
    bug-fix-abc12-triage-x3k9m.jsonl     # Per-task structured logs
    bug-fix-abc12-investigate-p7m2k.jsonl
    bug-fix-abc12-fix-x7k2m.jsonl
    bug-fix-abc12-verify-n1w5q.jsonl
  task-outputs/
    bug-fix-abc12-triage-x3k9m.json      # Task output payload
    bug-fix-abc12-fix-x7k2m.json
    bug-fix-abc12-verify-n1w5q.json
```

The `summary.json` includes:

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

- [Philosophy](./philosophy.md) -- design rationale and principles behind Hamilton
- [Workflow YAML Reference](./workflow-yaml.md) -- understand the workflow spec format
- [CLI Reference](./cli-reference.md) -- every command and flag
- [Agent System](./agents.md) -- how agents work and how to create them
- [Workflows Catalog](./workflows-catalog.md) -- all built-in workflows
- [Common Use Cases](./how-to/use-cases.md) -- practical patterns for software development
- [Settings Reference](./settings.md) -- global configuration
