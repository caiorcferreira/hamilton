# Hamilton

Workflow-based agentic execution engine. Runs multi-step agent pipelines (bug fixes, feature development, security audits, test quarantine) driven by YAML workflow specs, with Pi SDK integration, SQLite persistence, and a state machine that supports pause/resume.

## Quick start

```bash
# Install
bun install
bun run install-local          # symlinks to ~/.local/bin/hamilton

# Bootstrap ~/.hamilton/ (dirs, agents, DB, bundled workflows)
hamilton init

# Check prerequisites
hamilton doctor

# See what's available
hamilton workflow list

# Run something
cd /path/to/your/existing/git/repo
hamilton workflow run bug-fix "The login page crashes when the user submits an empty email"
```

## Requirements

- **bun** >= 1.2.x — runtime, package manager, test runner
- **rtk** (optional) — `npm install -g @rtk-ai/rtk`; required for Pi SDK agent execution
- An **existing git repo** — Hamilton workflows operate on a repo (no greenfield support yet)

## Architecture

### Directory layout

```
~/.hamilton/
  agents/           # Shared agent personas (two-tier: workflow-local then shared)
  workflows/        # Installed workflow specs (YAML) + per-workflow agent dirs
  runs/<run-id>/    # Per-run directory: input.json, events.jsonl, logs/, step-outputs/
  executors/pi/agent/  # Pi SDK agent config (rtk injected via extensionFactories)
  hamilton.db       # SQLite state machine persistence
```

### How it works

1. **`hamilton workflow run <slug> <prompt>`** loads a YAML workflow spec, resolves agent personas (two-tier: workflow-local first, then shared pool), creates a `WorkflowRuntime` state machine backed by SQLite, and executes steps sequentially.
2. Each step passes **JSON context** from previous steps (no KEY:value line parsing). Prompt is split into `systemPrompt` (persona + context) and `taskPrompt` (step input) for the Pi SDK.
3. Steps can be **loops** (loop over stories), **retried** on failure (with escalation), and **verified** by a follow-up step. The state machine enforces valid transitions.
4. **Pause/resume** works across processes — state is loaded from `~/.hamilton/hamilton.db` on resume, completed steps are skipped.

### Two-tier persona resolution

Agent personas live in two places:
- **Workflow-local**: `~/.hamilton/workflows/<workflow-id>/agents/<agent-name>/` (overrides)
- **Shared pool**: `~/.hamilton/agents/<agent-name>/` (fallback)

Each agent dir contains `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, and `settings.yaml`.

## Commands

| Command | Description |
|---|---|
| `hamilton init [--force]` | Bootstrap `~/.hamilton/`, create SQLite DB, install bundled workflows and agents |
| `hamilton workflow run <slug> <prompt>` | Run a workflow in the current directory |
| `hamilton workflow list` | List installed workflows (id, version, steps, agents) |
| `hamilton workflow status <id>` | Show run status and step results |
| `hamilton workflow pause <id>` | Pause a running workflow |
| `hamilton workflow resume <id>` | Resume a paused workflow |
| `hamilton workflow logs <id> [--step <id>] [--follow]` | View JSONL step logs |
| `hamilton workflow install <id> [--force]` | Install one workflow from bundled set |
| `hamilton workflow install --all [--force]` | Install all bundled workflows |
| `hamilton workflow uninstall <id>` | Remove a workflow |
| `hamilton doctor` | Check prerequisites (rtk installed, etc.) |

## Available workflows

| Workflow | Steps | Agents | Description |
|---|---|---|---|
| `bug-fix` | 5 | 5 | Triage, investigate, fix, verify — local-only |
| `bug-fix-github-pr` | 6 | 6 | Same + GitHub PR |
| `bug-fix-merge` | 6 | 6 | Same + squash-merge |
| `bug-fix-worktree` | 5 | 5 | Worktree variant, local-only |
| `bug-fix-merge-worktree` | 6 | 6 | Worktree variant + merge |
| `feature-dev` | 5 | 5 | Plan, implement, test, verify — story-by-story, local-only |
| `feature-dev-github-pr` | 7 | 6 | Same + GitHub PR + code review |
| `feature-dev-merge` | 6 | 6 | Same + squash-merge |
| `feature-dev-worktree` | 5 | 5 | Worktree variant, local-only |
| `feature-dev-merge-worktree` | 6 | 6 | Worktree variant + merge |
| `quarantine-broken-tests` | 3 | 3 | Detect and disable failing tests, iterate until green |
| `quarantine-broken-tests-merge` | 4 | 4 | Same + squash-merge |
| `quarantine-broken-tests-merge-worktree` | 4 | 4 | Worktree variant + merge |
| `security-audit` | 6 | 6 | Scan, prioritize, fix vulnerabilities — local-only |
| `security-audit-github-pr` | 7 | 7 | Same + GitHub PR |
| `security-audit-merge` | 7 | 7 | Same + squash-merge |
| `security-audit-worktree` | 6 | 6 | Worktree variant, local-only |
| `security-audit-merge-worktree` | 7 | 7 | Worktree variant + merge |

## Run output

```bash
$ hamilton workflow run bug-fix "The /api/auth endpoint returns 500 when token is expired"

Run ID: bug-fix-abc123
Status: running
Step results:
  triage: done
  investigate: done
  setup: done
  fix: done
  verify: done
```

Logs are written to `~/.hamilton/runs/<run-id>/`:
- `events.jsonl` — engine-level events (step start, complete, fail, pause)
- `logs/<step-id>.jsonl` — structured step logs
- `step-outputs/<step-id>.json` — step output payloads
- `input.json` — the original prompt
- `summary.json` — final run summary

## Workflow YAML format

```yaml
id: my-workflow
name: My Workflow
version: 1
description: What it does

polling:
  model: default
  timeoutSeconds: 120

agents:
  - id: analyzer
    name: Analyzer
    role: analysis
    description: Analyzes the problem
    model: null                    # optional model override
    timeoutSeconds: null           # optional per-agent timeout
    workspace:
      baseDir: agents/analyzer     # relative to workflow dir
      skills:                      # rtk skills to load
        - tamandua-agents
      files:                       # persona files
        AGENTS.md: agents/analyzer/AGENTS.md
        SOUL.md: agents/analyzer/SOUL.md
        IDENTITY.md: agents/analyzer/IDENTITY.md

steps:
  - id: analyze
    agent: analyzer                # must reference a defined agent
    type: default                  # or "loop"
    input: |
      Analyze this problem:
      {{task}}
    expects: "STATUS: done"        # optional output assertion
    max_retries: 4
    on_fail:
      escalate_to: human
```

Agent ids referenced in `shared/` use paths like `../../agents/shared/setup/AGENTS.md` and get installed to `~/.hamilton/agents/setup/` on `hamilton init`.

## Tech stack

- **Runtime**: bun (ESM, `"type": "module"`)
- **Language**: TypeScript (target ES2022)
- **Framework**: Effect-TS 3.21.3 (`Effect.gen`, `Data.TaggedError`, `Schema`)
- **AI SDK**: Pi SDK (`@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`)
- **Persistence**: SQLite via `bun:sqlite` (`~/.hamilton/hamilton.db`)
- **State machine**: `@effect/workflow` 0.18.2
- **Schema validation**: `@effect/schema` 0.75.5
- **YAML parsing**: `yaml` 2.4.5
- **Test runner**: vitest 4.1.8 via `bun --bun vitest run`

## Development

```bash
# Install + build
bun install
bun run build

# Run tests (133 passing)
bun run test

# Install CLI locally
bun run install-local

# Purge everything
bun run purge
```
