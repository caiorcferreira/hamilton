# Hamilton Features Design

## Overview

This document describes five features to transform Hamilton from a procedural step executor into a durable, observable workflow engine:

1. **rtk Integration** — Inject rtk into Pi agent sessions programmatically
2. **Live Status** — Real-time workflow state tracking via SQLite
3. **Improved Observability** — Pi conversation streaming, `--follow`, structured logger
4. **Improved Configuration** — Per-agent `settings.yaml`, workflow install/uninstall
5. **@effect/workflow Integration** — Durable execution with Activities, DurableDeferred, DurableClock

### Key decisions

- **SQLite for all state:** A single `~/.hamilton/hamilton.db` backs both live status queries and @effect/workflow durability. No files for state tracking — only `summary.json` written at completion for offline reading.
- **Pi SDK for agent execution:** Real `createAgentSession` calls replace the placeholder `executeWithPi()`. Each workflow step gets a real Pi session with injected extensions and event streaming.
- **Per-agent directories:** No global `agents/config.yml`. Each agent has its own `~/.hamilton/agents/<agent-id>/` directory with `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, and `settings.yaml`.
- **rtk injected, not installed:** The rtk extension is passed via `extensionFactories` at session creation time. No files written to `~/.pi/`.

---

## Feature 1: rtk Integration

### Module: `src/agent/rtk-extension.ts`

Exports `createRtkExtension(): ExtensionFactory` — a factory function `(pi: ExtensionAPI) => void`.

At Pi session creation time, the factory:

1. Subscribes to `tool_call` events via `pi.addEventListener`
2. When a `bash` tool call is detected, shells out to `rtk rewrite <command>` via `pi.exec`
3. If `rtk rewrite` returns a different command (exit code 0 or 3), mutates the tool input
4. If `rtk` is not installed or too old, warns and registers a no-op

The rtk extension reads `--model` from the agent's `settings.yaml` and passes it to `pi.exec` if needed. An `RTK_DISABLED=1` environment variable causes the extension to pass through commands unchanged.

### CLI: `hamilton rtk verify`

New subcommand that checks whether `rtk >= 0.23.0` is in PATH and reports status. Does NOT install files to `~/.pi/` — that's Pi's concern, not Hamilton's.

```bash
$ hamilton rtk verify
rtk 0.24.1 found at /usr/local/bin/rtk
Status: OK

$ hamilton rtk verify
rtk not found in PATH
Status: MISSING — install with: npm install -g @rtk-ai/rtk
```

### Integration into agent sessions

When the workflow engine creates a Pi agent session (Feature 5), it includes `createRtkExtension()` in the `extensionFactories` array of `DefaultResourceLoader`.

### Token tracking

Each rewrite logs an `rtk_rewrite` event to the step's JSONL:

```json
{
  "ts": "2026-06-05T14:32:01.234Z",
  "event": "rtk_rewrite",
  "original_command": "cat src/main.ts",
  "rewritten_command": "rtk read src/main.ts",
  "step_id": "investigate"
}
```

These events are included in the step's JSONL log and contribute to the summary's `token_usage.rtk_savings_estimate` field.

---

## Feature 2: Live Status

### SQLite schema

File: `~/.hamilton/hamilton.db`

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  current_step TEXT,
  error_message TEXT,
  context_json TEXT DEFAULT '{}'
);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  output_json TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

### Runner changes

- At workflow start: `INSERT INTO runs` and `INSERT INTO steps` for all steps in `pending` state
- After each step starts: `UPDATE steps SET status = 'running', started_at = ...`
- After each step completes: `UPDATE steps SET status = 'completed', completed_at = ..., tokens_in = ..., tokens_out = ..., output_json = ...`
- After each step fails: `UPDATE steps SET status = 'failed', error_message = ...`
- After each Pi `turn_end` event: `INSERT INTO token_events` for live token tracking
- On workflow finish: `UPDATE runs SET status = ..., completed_at = ..., current_step = NULL`
- On workflow error: `UPDATE runs SET status = 'failed', error_message = ...`

### CLI: `hamilton workflow status <id>`

Reads from SQLite (not files). Formatted output:

```
Workflow:  bug-fix
Status:    running (2m 15s elapsed)
Step:      4/5 — fix (agent: fixer)
Steps:     triage ✓  investigate ✓  setup ✓  fix ⏳  verify ◯
Tokens:    25,000 in / 8,000 out
Errors:    none
DB:        ~/.hamilton/hamilton.db
```

If the workflow failed, shows the last error message and failed step. If paused, shows "paused" and which step was active. Completed runs show total elapsed time and final token totals.

### Final summary

`summary.json` is still written at completion for offline reading, but SQLite is the source of truth for live queries.

---

## Feature 3: Improved Observability

### Pi conversation streaming

When the workflow engine creates a Pi agent session, it subscribes to all events and writes them to the JSONL log in real-time:

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        appendStepLog(runId, stepId, {
          event: "llm_delta",
          delta: event.assistantMessageEvent.delta
        })
      }
      break
    case "tool_execution_start":
      appendStepLog(runId, stepId, {
        event: "tool_call",
        tool: event.toolName,
        input: event.toolCall.input
      })
      break
    case "tool_execution_end":
      appendStepLog(runId, stepId, {
        event: "tool_result",
        tool: event.toolName,
        isError: event.isError
      })
      break
    case "turn_end":
      appendStepLog(runId, stepId, {
        event: "turn_end",
        tokens_in: event.tokenUsage?.input,
        tokens_out: event.tokenUsage?.output
      })
      INSERT_TOKEN_EVENT(db, runId, stepId, event)
      break
  }
})
```

Token usage from `turn_end` is written to both the JSONL log AND the SQLite `token_events` table for live status queries.

### `--follow` flag

New option on `hamilton workflow logs`:

```bash
hamilton workflow logs <id> --follow
```

Uses `fs.watchFile` to monitor the run's `logs/` directory. New JSONL lines are printed to stdout as they're written. Exits on `SIGINT` (Ctrl+C) or when the workflow completes.

### Structured Logger

Effect's `Logger` is configured with two sinks:

- **Console sink:** `Logger.pretty` at Info level for interactive CLI output
- **File sink:** `Logger.json` writing to `~/.hamilton/runs/<run-id>/events.jsonl`, at Debug level, with annotations `{ service: "hamilton", run_id, step_id }`

The file sink captures all Effect log statements (workflow lifecycle, agent session boundaries, errors) alongside Pi conversation events in a separate file from the step logs. Step logs go to `logs/<step-id>.jsonl`, engine events go to `events.jsonl`.

---

## Feature 4: Improved Configuration

### Per-agent directory structure

```
~/.hamilton/agents/<agent-id>/
  AGENTS.md       — step-by-step instructions
  IDENTITY.md     — name and role
  SOUL.md         — personality and communication style
  settings.yaml   — runtime configuration
```

### `settings.yaml` format

```yaml
model: anthropic/claude-sonnet-4-20250514
thinking: medium           # off, minimal, low, medium, high, xhigh
tools:                     # default: [read, bash, edit, write]
  - read
  - bash
  - edit
  - write
  - grep
timeoutSeconds: 300
skills:
  - tamandua-agents
```

All fields are optional. Missing fields fall back to defaults:

| Field | Default |
|-------|---------|
| `model` | `anthropic/claude-sonnet-4-20250514` |
| `thinking` | `off` |
| `tools` | `[read, bash, edit, write]` |
| `timeoutSeconds` | `300` |
| `skills` | `[]` |

### Loading logic: `src/agent/config.ts`

```typescript
export interface AgentSettings {
  model?: string
  thinking?: string
  tools?: string[]
  timeoutSeconds?: number
  skills?: string[]
}

export function loadAgentSettings(
  agentDir: string  // ~/.hamilton/agents/<agent-id>/
): Effect.Effect<AgentSettings, ConfigLoadError>
```

Reads `settings.yaml` if it exists, validates with Schema, returns defaults for missing fields.

### Resolution order

When the runner creates a Pi session for an agent:

1. **Workflow YAML** — agent definition's `model`, `timeoutSeconds` (highest priority)
2. **Agent's `settings.yaml`** — `~/.hamilton/agents/<agent-id>/settings.yaml`
3. **Defaults** — `anthropic/claude-sonnet-4-20250514`, timeout 300

### Workflow install/uninstall

New CLI commands that copy workflow YAMLs from bundled `workflows/` to `~/.hamilton/workflows/`:

```bash
hamilton workflow install bug-fix        # install one
hamilton workflow install --all          # install all 18 bundled workflows
hamilton workflow uninstall bug-fix      # remove from ~/.hamilton
```

Install checks if the file already exists and prompts for overwrite. Uninstall removes the YAML file from `~/.hamilton/workflows/`.

---

## Feature 5: @effect/workflow Integration

### Activity per step

Each workflow step becomes an `Activity.make()`:

```typescript
const stepActivity = Activity.make({
  name: stepId,
  error: StepExecutionError,
  execute: Effect.gen(function* () {
    const session = yield* createAgentSession(agent, extensions)
    const prompt = yield* buildAgentPrompt(step, context)
    const result = yield* session(prompt)
    return parseAgentOutput(result)
  })
})
```

Activities use `Activity.retry({ times: step.max_retries ?? 1 })` for retry logic. The current manual `Effect.retry` + `Schedule.recurs` loops in `runner.ts` are replaced entirely.

### Pause/Resume via DurableDeferred

At workflow start, create a `DurableDeferred("pause-<runId>")`. The activity loop checks `DurableDeferred.isDone()` before each step. If a pause signal arrives:

- `hamilton workflow pause <id>` calls `DurableDeferred.fail()` — the workflow yields and persists state to SQLite
- `hamilton workflow resume <id>` creates a new `DurableDeferred` for the next pause cycle

The workflow engine resumes from the last completed step, skipping already-completed activities.

### Timeout via DurableClock

Replace `Effect.timeout` with `DurableClock.sleep()`:

```typescript
const timeout = step.timeout ?? resolveStepTimeout(step, agentSettings)
const result = yield* Effect.race(
  stepActivity(payload),
  DurableClock.sleep({ name: `step-timeout-${stepId}`, duration: timeout })
)
```

If the clock wins, the activity is interrupted and marked as timed out.

### Workflow definition

```typescript
const HamiltonWorkflow = Workflow.make({
  name: spec.id,
  success: Schema.Record({ key: Schema.String, value: Schema.String }),
  error: WorkflowExecutionError,
  payload: {
    spec: Schema.Unknown,
    context: Schema.Record({ key: Schema.String, value: Schema.String })
  },
  idempotencyKey: ({ runId }) => runId
})
```

The `toLayer()` implementation creates Pi sessions, streams events, writes to SQLite, and returns structured output. Each step's Activity is registered and executed in computed order.

### SQLite engine: `src/workflow/workflow-engine.ts`

```typescript
import { Workflow, Activity, DurableDeferred, DurableClock } from "@effect/workflow"
import Database from "better-sqlite3"

export function createWorkflowEngine(db: Database.Database) {
  // Provides durable execution backed by SQLite
  // Checkpoints:
  //   - Activity completion state
  //   - DurableDeferred signal state
  //   - DurableClock sleep state
  // On crash/restart, reads checkpointed state and resumes from last completed step
}
```

The engine uses the same `~/.hamilton/hamilton.db` database as the live status feature. Activity completion is stored in the `steps` table (with `status` field). DurableDeferred and DurableClock state are stored in additional tables:

```sql
CREATE TABLE workflow_state (
  run_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (run_id, key)
);

CREATE TABLE durable_deferred (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  value TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

### Runner refactor

The current `runWorkflow()` function in `src/workflow/runner.ts` is replaced by the `HamiltonWorkflow` definition. The manual `for` loop, `Effect.retry`, and `Effect.timeout` calls are all removed in favor of @effect/workflow primitives. The function becomes:

```typescript
export function runWorkflow(
  spec: WorkflowSpec,
  context: Record<string, string>,
  options?: { runId?: string }
): Effect.Effect<WorkflowResult, WorkflowExecutionError, ...> {
  return HamiltonWorkflow({
    spec,
    context,
    runId: options?.runId ?? buildRunId(spec.id)
  })
}
```

---

## Implementation Order

Features are implemented sequentially: F1 → F2 → F3 → F4 → F5.

| Feature | Depends On | New Modules | New CLI Commands |
|---------|-----------|-------------|-----------------|
| F1: rtk Integration | Pi SDK | `src/agent/rtk-extension.ts` | `hamilton rtk verify` |
| F2: Live Status | better-sqlite3 | `src/db/schema.ts`, `src/db/queries.ts`, `src/workflow/state.ts` (rewrite) | — |
| F3: Improved Observability | Pi SDK, F2 | `src/observability/logger.ts`, `src/observability/streaming.ts` | `hamilton workflow logs <id> --follow` |
| F4: Configuration | — | `src/agent/config.ts` | `hamilton workflow install`, `hamilton workflow uninstall` |
| F5: @effect/workflow | F1, F2, F3, F4 | `src/workflow/workflow-engine.ts`, `src/workflow/runner.ts` (rewrite) | — |

---

## Dependencies to Add

| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | pinned | SQLite driver for state persistence |
| `@earendil-works/pi-coding-agent` | pinned | Pi SDK for agent session creation |
| `@effect/workflow` | 0.18.2 (already in package.json) | Durable workflow primitives |
| `@effect/sql` | pinned | Effect-friendly SQL layer |
| `@effect/sqlite-node` | pinned | SQLite adapter for @effect/sql |

---

## Out of Scope

- **Pi installation management:** Hamilton does not install or configure Pi. That's the user's responsibility.
- **rtk installation:** `hamilton rtk verify` checks status only. Installation is manual.
- **Multi-node clustering:** SQLite is single-writer. No distributed coordination needed for a CLI tool.
- **Web UI:** Status display is CLI-only. No web dashboard.
- **Agent sandboxing:** Pi handles sandboxing. Hamilton delegates to Pi's security model.