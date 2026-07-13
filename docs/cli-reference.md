# CLI Reference

> ⚠️ **Autonomous mode (experimental).** This documents Hamilton's workflow engine, which is under active rework and can change without notice. See [The three modes](./modes.md). For the working path today, use [Assisted mode](./skills.md).

Complete command-line reference for Hamilton. All commands accept `--help` for inline documentation.

## Command Tree

```
hamilton
  setup [--force] [--copy-pi-configs] [--model-alias <alias>=<model>...]
  doctor
  workflow
    run <slug> <prompt...> [--variants <csv>] [--foreground|-f] [--run-id <id>]
    list
    runs [--status <running|completed|failed|paused>] [--limit <n>]
    status <id>
    logs <id> [--task <task-id>] [--follow|-f]
    pause <id>
    resume <id>
    install [<id> | --all] [--force]
    uninstall <id>
  mcp
  telemetry
    status
    enable [<store>]
    disable <store>
```

---

## `hamilton setup`

Bootstraps the `~/.hamilton/` directory, initializes the SQLite database, installs bundled workflows and shared agents, and creates default configuration.

```
hamilton setup [--force] [--copy-pi-configs] [--model-alias <alias>=<model>...]
```

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--force` | boolean | Overwrite existing agents, skills, and guidelines. Does not overwrite existing settings.yaml. |
| `--copy-pi-configs` | boolean | Copy existing Pi SDK configuration from `~/.pi/agent/` to `~/.hamilton/executors/pi/agent/`. |
| `--model-alias` | repeatable text (`name=modelId`) | Register a named model alias in settings.yaml. Can be specified multiple times. |

### What it creates

| Path | Contents |
|------|----------|
| `~/.hamilton/agents/` | 4 shared agent personas: setup, verifier, do, pr |
| `~/.hamilton/workflows/` | 7 bundled workflows with per-workflow agents |
| `~/.hamilton/guidelines/` | Language-specific coding guidelines |
| `~/.hamilton/skills/` | RTK skill manifests |
| `~/.hamilton/executors/pi/agent/` | Pi SDK config (settings.json, models.json, auth.json) |
| `~/.hamilton/hamilton.db` | SQLite database (WAL mode, schema v6) |
| `~/.hamilton/settings.yaml` | Global configuration |

### Examples

```bash
# Basic initialization
hamilton setup

# Force overwrite of agents and skills
hamilton setup --force

# Copy existing Pi configs and register model aliases
hamilton setup --copy-pi-configs --model-alias sonnet=anthropic.claude-sonnet-4

# Multiple aliases
hamilton setup --model-alias fast=google.gemini-flash-2 --model-alias big=anthropic.claude-opus-4
```

---

## `hamilton doctor`

Checks required and optional prerequisites.

```
hamilton doctor
```

### Checks performed

| Check | Requirement | Purpose |
|-------|-------------|---------|
| `rtk` | Binary >= 0.23.0 | Shell command rewriting for Pi SDK agent execution |
| `typescript-language-server` | Binary in PATH | LSP diagnostics for TypeScript/JavaScript |
| `pylsp` | Binary in PATH | LSP diagnostics for Python |
| `gopls` | Binary in PATH | LSP diagnostics for Go |

All checks run in parallel. Missing prerequisites show as failures but don't block Hamilton.

---

## `hamilton workflow run`

Executes a workflow in the current working directory.

```
hamilton workflow run <slug> <prompt...> [--variants <csv>] [--foreground|-f] [--run-id <id>]
```

### Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `slug` | text | Workflow slug (e.g., `bug-fix`, `feature-dev`, `do`). Must match an installed workflow. |
| `prompt` | repeated text | The task prompt. Multiple words are joined with spaces. |

### Options

| Option | Type | Description |
|--------|------|-------------|
| `--variants` | optional text (CSV) | Comma-separated variant names to activate (e.g., `branchout,merge`). |
| `--foreground`, `-f` | optional boolean | Run in foreground with live terminal output. Default: background (detached child process). |
| `--run-id` | optional text | Explicit run ID. Auto-generated if omitted. Format: `<slug>-<5 chars>`. |

### How it works

1. Loads the workflow YAML from `~/.hamilton/workflows/<slug>/workflow.yml`
2. Resolves agent personas (two-tier: workflow-local, then shared pool)
3. Builds the DAG: BFS reachability from entrypoint, Kahn topological sort
4. Creates a SQLite-backed run state machine
5. Executes tasks in dependency order, passing accumulated context forward
6. Writes events, logs, and task outputs to `~/.hamilton/runs/<run-id>/`

### Background mode (default)

The command spawns a detached child Bun process and returns immediately with the run ID. Use `status`, `logs`, `pause`, and `resume` to interact with the running workflow.

```bash
$ hamilton workflow run bug-fix "Fix the login crash"
Run ID: bug-fix-xk93m
Monitor with: hamilton workflow status bug-fix-xk93m
```

### Foreground mode

Use `--foreground` (or `-f`) to see live progress with per-task status, token counts, and elapsed time:

```bash
hamilton workflow run bug-fix "Fix the login crash" -f
```

### Variants

Activate workflow variants by name:

```bash
# Run bug-fix with branch creation and squash-merge at the end
hamilton workflow run bug-fix "Fix the login crash" --variants branchout,merge
```

Available variants:

| Variant | Effect |
|---------|--------|
| `branchout` | Creates a feature branch at the start |
| `worktree` | Creates a git worktree (isolated workspace) |
| `merge` | Squash-merges the branch at the end |
| `github_pr` | Creates a GitHub pull request at the end |

Without `--variants`, the base workflow runs (local-only, no merge or PR). Variants compose: use `--variants branchout,merge` or `--variants worktree,github_pr`.

### Unknown workflow slugs

If the slug doesn't match an installed workflow, Hamilton suggests the nearest match using Levenshtein distance:

```bash
$ hamilton workflow run bug-fx "Fix the login crash"
Error: workflow 'bug-fx' not found. Did you mean 'bug-fix'?
```

### Examples

```bash
# Run a bug fix (background)
hamilton workflow run bug-fix "The /api/auth endpoint returns 500 when token is expired"

# Run feature development with live output
hamilton workflow run feature-dev "Add user profile picture upload" -f

# Run with worktree + PR variant
hamilton workflow run feature-dev "Add dark mode toggle" --variants worktree,github_pr

# General-purpose single task
hamilton workflow run do "Refactor the authentication middleware to use async/await"
```

---

## `hamilton workflow status`

Displays the current state of a workflow run.

```
hamilton workflow status <id>
```

### Output

```
 Workflow: bug-fix
 Status: running
 Started: 2025-06-15T10:30:00Z
 Elapsed: 45s
 Current: investigate (2/5)
 Tokens: 1,200 in / 800 out

 Tasks:
 ✓ triage
 ⏳ investigate
 ○ setup
 ○ fix
 ○ verify
```

### Task indicators

| Symbol | Status |
|--------|--------|
| ✓ | Completed |
| ⏳ | Running (current task) |
| ✗ | Failed |
| ○ | Pending |

Subtasks from forEach/template expansion are indented under their parent compound task. Token counts and elapsed time are aggregated from the SQLite `token_events` table.

---

## `hamilton workflow logs`

Views structured JSONL log files for a run.

```
hamilton workflow logs <id> [--task <task-id>] [--follow|-f]
```

### Options

| Option | Description |
|--------|-------------|
| `--task <task-id>` | Filter to a specific task's log file |
| `--follow`, `-f` | Tail mode: polls every 500ms for new lines |

### Examples

```bash
# All task logs for a run
hamilton workflow logs bug-fix-abc12

# Only the fix task's logs
hamilton workflow logs bug-fix-abc12 --task bug-fix-abc12-fix-x7k2m

# Follow (tail) a running workflow
hamilton workflow logs bug-fix-abc12 -f
```

---

## `hamilton workflow runs`

Lists recent workflow runs from the SQLite database.

```
hamilton workflow runs [--status <status>] [--limit <n>]
```

### Options

| Option | Description |
|--------|-------------|
| `--status` | Filter by status: `running`, `completed`, `failed`, `paused` |
| `--limit` | Maximum runs to show (default: 20) |

### Output

```
 RUN ID               WORKFLOW       STATUS      STARTED             DURATION  TASK
 bug-fix-xk93m        bug-fix        completed   2025-06-15 10:30   2m 15s    5/5
 feature-dev-p7k2m    feature-dev    running     2025-06-15 10:32   45s       2/6
 security-audit-n9w1q security-audit failed      2025-06-15 09:45   3m 10s    3/7
```

---

## `hamilton workflow pause`

Pauses a running workflow.

```
hamilton workflow pause <id>
```

The engine completes the current task, then stops. State is preserved in SQLite. The run status is set to `paused`.

```bash
hamilton workflow pause bug-fix-abc12
```

---

## `hamilton workflow resume`

Resumes a paused workflow.

```
hamilton workflow resume <id>
```

Restores the full execution context from SQLite, resets deferred tasks to `pending`, and continues execution from the next pending task. Already-completed tasks are skipped.

```bash
hamilton workflow resume bug-fix-abc12
```

If the workflow YAML was removed or modified since the run was paused, resume will report an appropriate error.

---

## `hamilton workflow list`

Lists all installed workflows.

```
hamilton workflow list
```

Reads workflow directories from `~/.hamilton/workflows/`, loads each `workflow.yml`, and renders a formatted table:

```
 NAME                    DESCRIPTION                                   VERSION  TASKS  AGENTS
 bug-fix                 Triage, investigate, and fix bugs...          2        5      5
 bug-fix-github-pr       Same + GitHub PR                              2        6      6
 feature-dev             Plan, implement, test, and verify features    6        6      6
 do                      Single general-purpose agent                  2        1      1
 security-audit          Scan, prioritize, and fix vulnerabilities     2        7      6
 quarantine-broken-tests Detect and disable failing tests              2        3      3
 scaffold                Scaffolds a new project from scratch          2        2      2
```

Workflow names are color-coded by category.

---

## `hamilton workflow install`

Installs one or all bundled workflows.

```
hamilton workflow install [<id> | --all] [--force]
```

### Options

| Option | Description |
|--------|-------------|
| `<id>` | Install a specific workflow by slug |
| `--all` | Install all 7 bundled workflows |
| `--force` | Overwrite existing workflow directories |

### Examples

```bash
# Install a single workflow
hamilton workflow install bug-fix

# Install all workflows, overwriting existing ones
hamilton workflow install --all --force
```

---

## `hamilton workflow uninstall`

Removes an installed workflow.

```
hamilton workflow uninstall <id>
```

Removes `~/.hamilton/workflows/<id>/` recursively.

```bash
hamilton workflow uninstall bug-fix
```

---

## `hamilton mcp`

Starts a Model Context Protocol (MCP) server that exposes Hamilton's capabilities to external tools and agents.

```
hamilton mcp
```

The MCP server provides tool access for workflow execution, status queries, and log retrieval. This allows other MCP-compatible tools (like Claude Desktop or other AI assistants) to orchestrate Hamilton workflows.

---

## `hamilton telemetry`

Manages Hamilton's telemetry system which records LLM interactions, tool calls, and API requests.

### `hamilton telemetry status`

Displays current telemetry state:

```
 Telemetry Status:
   Enabled: true
   File store: enabled (127 runs, 340 turns)
   DB store: enabled
```

### `hamilton telemetry enable [<store>]`

Enables telemetry or a specific store. If no store is specified, enables all.

```bash
hamilton telemetry enable          # enable all
hamilton telemetry enable file     # enable file store only
hamilton telemetry enable db       # enable DB store only
```

### `hamilton telemetry disable <store>`

Disables a specific telemetry store.

```bash
hamilton telemetry disable file    # disable file-based telemetry
hamilton telemetry disable db      # disable database telemetry
```

Telemetry configuration is persisted in `~/.hamilton/settings.yaml` under the `telemetry.disableStores` key.

---

## Environment

Hamilton uses `$HOME` to locate `~/.hamilton/`. Override for testing or isolated environments:

```bash
HOME=/tmp/hamilton-test hamilton workflow run bug-fix "Test bug"
```

The working directory (where `hamilton workflow run` is invoked) becomes the workflow execution directory. Agents operate on this repository.
