# Hamilton Design

## Overview

Hamilton is a workflow-based agentic execution engine — a TypeScript CLI built on Effect-TS that orchestrates teams of specialized AI agents through deterministic, repeatable YAML-defined workflows. It is inspired by Tamandua and maintains full YAML compatibility with its workflow definitions.

### Key design decisions

- **YAML compatibility:** Workflows use Tamandua's exact YAML format. Users can share workflows between both tools. Zero Effect concepts exposed in configuration.
- **Push-based execution:** Agents are `@effect/workflows` activities — the engine pushes work, no polling. Timeouts, retries, and pause/resume are Effect-native.
- **JSON context:** Agents output structured JSON instead of parsing `KEY: value` lines. Schema-validated at each step boundary via `@effect/schema`. Incompatible with Tamandua's line-based output format but the YAML structure (`expects`, `{{key}}` templates) stays identical.
- **Persona in .md, config in YAML:** Agent instructions live in `AGENTS.md`/`IDENTITY.md`/`SOUL.md` files (Tamandua-compatible). Model, timeout, and retry config live in YAML.
- **Structured logs per run:** Each workflow run gets a directory under `~/.hamilton/runs/<run-id>/` with per-step JSONL conversation logs, step outputs, and a final summary.

---

## Architecture

Hamilton has four layers, all built on Effect-TS:

### CLI Layer

The entry point. Parses commands, validates inputs, loads YAML workflow definitions from `~/.hamilton/workflows/`, and triggers the workflow engine. Built with Effect for typed error handling and dependency injection at every command boundary.

**Commands:**

- `cli workflow run <slug> <prompt>` — Loads the YAML, resolves variants, creates a workflow execution, streams events to stdout
- `cli workflow status <id>` — Queries workflow state, prints step progress, token spend, elapsed time
- `cli workflow pause <id>` — Sends a pause signal to the running workflow
- `cli workflow resume <id>` — Resumes a paused workflow from its saved state
- `cli workflow list` — Lists all installed workflows with their descriptions
- `cli workflow logs <run-id> [--step <id>] [--follow]` — Queries structured logs from a run directory

### Workflow Engine Layer

The core orchestrator. Each workflow YAML is compiled into an `@effect/workflows` workflow where each step becomes an activity. The engine manages activity lifecycle (start, complete, fail), applies retry policies and timeouts per step, and handles pause/resume via workflow signals.

**Activity mapping:**

- Each YAML step → one `@effect/workflows` activity
- `retryPolicy` from step `max_retries`
- `startToCloseTimeout` from step/polling `timeoutSeconds`
- Loop steps (`type: loop`) compile into per-story sub-activities with `fresh_session: true` when configured
- Context passing: activity completion parses agent JSON, validates against `expects`, merges into workflow context for downstream steps

### Agent Layer

Each workflow activity wraps a call to `@earendil-works/pi-agent-core`. Agents are configured via YAML (model, timeout, retry policy) but their persona and instructions come from `.md` files — keeping full Tamandua compatibility.

**Per activity:**
1. Resolve `{{key}}` templates from accumulated workflow context
2. Construct prompt: step `input` + persona files + context
3. Spawn Pi agent session programmatically via `pi-agent-core`
4. Stream all messages (prompts, completions, tool calls, tool results) as structured events
5. Wait for agent to produce JSON completion or hit timeout

**Agent directory structure** (same as Tamandua):
```
agents/shared/<agent-name>/
  AGENTS.md    — step-by-step instructions, output format, error handling
  IDENTITY.md  — name and role
  SOUL.md      — personality and communication style
```

**Agent YAML config** (in workflow YAML or separate agents YAML):
```yaml
agents:
  - id: planner
    role: analysis
    model: claude-sonnet-4-20250514      # bigger model for planning
    timeoutSeconds: 300
    workspace:
      baseDir: agents/shared/planner
  - id: developer
    role: coding
    model: claude-haiku-4-5-20250514     # cheaper model for coding
    timeoutSeconds: 600
    workspace:
      baseDir: agents/shared/developer
```

### Observability Layer

A structured logging pipeline (Effect's Logger + file sink) captures all events. An event bus allows real-time subscribers (CLI output, future dashboard).

---

## Data Flow

### Happy path: `cli workflow run bug-fix "login is broken"`

1. CLI loads `~/.hamilton/workflows/bug-fix/workflow.yml`, validates with Schema
2. Resolves variant suffix (e.g. `-merge-worktree` appends merge + worktree config)
3. Creates `~/.hamilton/runs/<run-id>/` directory, writes `input.json` with resolved prompt
4. Engine starts `@effect/workflows` workflow, begins first activity (e.g. `triage`)
5. Triage activity: resolves `{{task}}` template, constructs Pi prompt, spawns agent session
6. Agent messages stream to `logs/triage.jsonl` in real-time as the agent works
7. Agent completes with JSON `{"status": "done", "repo": "frontend-app", "root_cause": "session expiry race condition"}`
8. Output validated against `expects` schema, written to `step-outputs/triage.json`, merged into context
9. Pipeline advances to `investigate` — its `{{root_cause}}` template resolves from context
10. Steps continue through `setup` → `fix` → `verify`, each receiving accumulated context
11. Verifier completes → `summary.json` written with total time, token usage, status → workflow marked done

### Loop steps

Steps with `loop` config iterate over parsed stories (from `STORIES_JSON` context). Each story runs as a sub-activity:

- `fresh_session: true` — each story gets a fresh Pi session
- `verify_each: true` — verifier runs after each story implementation
- Story completion/failure tracked independently; all must pass for step completion

### Pause/Resume

- `cli workflow pause <id>` sends a signal to the running workflow
- Current state (completed steps, accumulated context, in-flight activity) persists to the run directory
- On resume, the workflow reloads state from disk and continues from the saved point
- `@effect/workflows` durability handles in-flight activity recovery

### Error handling

- Activity failures trigger retry with configurable backoff (from `max_retries`)
- After exhausting retries, the step escalates (marked for human intervention)
- Full failure context including the Pi conversation history is available in the run directory
- Since logs stream in real-time, failures can be debugged without reproduction

---

## Observability

### Per-run directory structure

```
~/.hamilton/runs/<run-id>/
  input.json              — original user prompt + resolved template context
  step-outputs/
    <step-id>.json        — agent JSON output per step
  logs/
    <step-id>.jsonl       — per-step conversation history (streamed in real-time)
  summary.json            — final: total wall-clock time, token usage, status
```

### Conversation streaming

Each agent message is written as a structured JSONL line with:

```json
{
  "timestamp": "2026-06-05T14:32:01.123Z",
  "event": "tool_call",
  "step_id": "triage",
  "agent_id": "triager",
  "message_index": 7,
  "payload": {
    "tool": "bash",
    "input": "git log --oneline -10"
  }
}
```

Event types: `prompt`, `completion`, `tool_call`, `tool_result`, `token_usage`.

### Structured logging

All system-level events use Effect's Logger and go to console + file:

| Level | Events |
|-------|--------|
| Debug | Tool calls, context resolution |
| Info  | Workflow started, step claimed, step completed, retry, pause, resume |
| Warn  | Retry attempts, timeout approaching |
| Error | Step failures, escalation |

### CLI querying

- `cli workflow logs <run-id>` — displays full run timeline with per-step status, tokens, and timing
- `cli workflow logs <run-id> --step triage` — filters to a specific step
- `cli workflow logs <run-id> --follow` — tails the JSONL log in real-time

### Metrics (`summary.json`)

```json
{
  "run_id": "abc123",
  "workflow": "bug-fix",
  "status": "completed",
  "started_at": "2026-06-05T14:30:00.000Z",
  "completed_at": "2026-06-05T14:45:00.000Z",
  "total_duration_seconds": 900,
  "token_usage": {
    "total_input": 45000,
    "total_output": 12000,
    "by_step": {
      "triage": {"input": 8000, "output": 2000, "model": "claude-sonnet-4-20250514"},
      "investigate": {"input": 12000, "output": 3000, "model": "claude-sonnet-4-20250514"},
      "setup": {"input": 5000, "output": 1000, "model": "claude-haiku-4-5-20250514"},
      "fix": {"input": 15000, "output": 4000, "model": "claude-haiku-4-5-20250514"},
      "verify": {"input": 5000, "output": 2000, "model": "claude-sonnet-4-20250514"}
    }
  },
  "retries": {"fix": 1},
  "step_results": {
    "triage": "completed",
    "investigate": "completed",
    "setup": "completed",
    "fix": "completed",
    "verify": "completed"
  }
}
```

---

## Testing Strategy

### Unit tests (per layer)

- **YAML/Schema:** Validate correct parsing of all Tamandua-compatible workflow YAMLs. Reject malformed fields with typed errors. Test all variant suffixes resolve correctly.
- **Context & templates:** Test `{{key}}` interpolation with nested paths. Test `expects` validation against agent JSON output. Test STORIES_JSON parsing for loop steps.
- **Activity policies:** Test retry exhaustion, timeout behavior, backoff strategy.
- **CLI:** Test argument parsing, error messages for invalid commands, help text output.

### Integration tests

- **Full workflow execution:** Run each of the 18 workflows end-to-end with a mock Pi agent (returns predefined JSON). Verify correct step ordering, context propagation, loop iteration counts, and summary generation.
- **Pause/resume:** Start a workflow, pause mid-execution, verify run directory state, resume and confirm completion.
- **Error handling:** Simulate agent failures at each step. Verify retry count, escalation, and that partial context/logs persist.

### Tooling

- `vitest` for test runner
- `@effect/vitest` for Effect-native testing — ensures fibers, resources, and layers are properly managed in test scope
- Mock `pi-agent-core` via Effect's dependency injection (Layer system)

---

## Technology Stack

| Component | Choice | Version |
|-----------|--------|---------|
| Language | TypeScript | 5.x |
| Runtime | Node.js | >= 22 |
| Effect core | `effect` | latest (pinned) |
| Workflows | `@effect/workflows` | latest (pinned) |
| Schema validation | `@effect/schema` | latest (pinned) |
| Agent harness | `@earendil-works/pi-agent-core` | 0.78.1 (pinned) |
| YAML parsing | `yaml` | latest (pinned) |
| Testing | `vitest` + `@effect/vitest` | latest (pinned) |
| Worktree management | `worktrunk` | via CLI |
| Token optimization | `rtk` | hook configured |
| Package manager | npm | — |
| Module system | ESM (`"type": "module"`) | — |

All dependency versions pinned (no `~` or `^` in package.json).

---

## Workflows Included

18 workflows across 5 families:

| Family | Variants |
|--------|----------|
| feature-dev | `feature-dev`, `feature-dev-merge`, `feature-dev-worktree`, `feature-dev-merge-worktree`, `feature-dev-github-pr` |
| bug-fix | `bug-fix`, `bug-fix-merge`, `bug-fix-worktree`, `bug-fix-merge-worktree`, `bug-fix-github-pr` |
| security-audit | `security-audit`, `security-audit-merge`, `security-audit-worktree`, `security-audit-merge-worktree`, `security-audit-github-pr` |
| quarantine-broken-tests | `quarantine-broken-tests`, `quarantine-broken-tests-merge`, `quarantine-broken-tests-merge-worktree` |
