# Gap Analysis: pi-telemetry features missing from Hamilton observability

## Current State Comparison

| Capability | pi-telemetry | Hamilton |
|---|---|---|
| Telemetry store | SQLite (4 tables: runs, turns, tool_calls, provider_requests) | Filesystem JSONL + partial SQLite (runs, tasks, token_events only) |
| Query interface | `query_runs()` with multi-filter (eval_id, success, limit) | None |
| Export | `telemetry export` → timestamped JSON dump | None |
| Enable/disable | `telemetry on|off` + programmatic override; disabled by default | Always on |
| Status command | `telemetry status|stats` | None |
| TUI | Home screen modal (status, stats, runs, export, enable, disable) | CliRenderer (live terminal) only |
| Payload privacy | Summarize to metadata (type shapes, byte counts); raw content never stored | Raw step outputs and inputs stored as-is |
| Config persistence | `~/.pi/agent/telemetry.json` | No telemetry config |
| DB schema migration | Versioned migrations in transactions | Static schema; no migration path |
| Provider requests | Structured table (status_code, payload_summary, headers_summary) | Not tracked (only token counts) |
| Run model attribution | `model_provider`, `model_id` per run | Not stored |
| Eval metadata | `eval_run_id`, `eval_case_id`, `eval_attempt`, `eval_suite` via env vars | No eval tagging |
| Turn tracking | Structured table (turn_index, stop_reason, tool_result_count) | Events in JSONL only |
| Tool call tracking | Structured table (tool_name, args_summary, result_summary, is_error, partial_update_count) | Events in JSONL only |
| Session shutdown | Graceful finalization of in-progress runs | Handled implicitly via Effect-TS scope teardown |

---

## MUST HAVE

### 1. Structured telemetry database

**Source:** `schema.sql` — `turns`, `tool_calls`, `provider_requests` tables in pi-telemetry.

**Gap:** Hamilton tracks turns, tool calls, and provider requests only as unstructured JSONL events. There is no relational schema to join runs ↔ turns ↔ tool_calls ↔ provider_requests.

**Why critical:** Without structured tables, you cannot answer basic questions like:

- "How many tool calls per turn on failed runs?"
- "What tool has the highest error rate?"
- "What's the p95 latency per provider?"
- "Which stop reasons are most associated with failed runs?"

All analytics require parsing gigabytes of JSONL. Every query is a full-table scan over flat files.

---

### 2. Provider/LLM request tracking

**Source:** `src/db.ts` lines 185–240: `insert_provider_request()`, `update_provider_request_response()`.

**Gap:** Hamilton has a `DbWriter` subscriber (`src/db/subscribers.ts`) that only handles `TokenUsage` events (aggregate token counts). There is no tracking of individual LLM API calls — no status codes, no payload sizes, no headers, no per-request latency.

**Why critical:** Critical for debugging API errors, cost analysis (tokens × model pricing), latency optimization, and detecting provider degradation. `TokenUsage` alone is insufficient — it aggregates across an entire step, masking per-request behavior.

---

### 3. Query and export CLI commands

**Source:** `src/index.ts` lines 209–408: `telemetry query` and `telemetry export` with filter support (`eval_run_id`, `eval_case_id`, `eval_suite`, `success`, `limit`).

**Gap:** Hamilton has no CLI command to query or export telemetry data. Data exists on disk (JSONL files + SQLite tables) but there is no way to extract structured insights without manual scripting.

**Why critical:** Data without a query path is useless. The current state requires users to `grep` JSONL files or write SQL by hand. An export command would allow feeding data into analytics pipelines (cost dashboards, eval frameworks, observability platforms).

---

### 4. Observability enable/disable toggle

**Source:** `src/config.ts` — `enabled` persisted to `~/.pi/agent/telemetry.json`; `src/index.ts` lines 79–86: all handlers become no-ops when disabled.

**Gap:** Hamilton always creates run directories, writes JSONL logs, and publishes events regardless of context. There is no way to suppress observability during development, testing, or CI.

**Why critical:** Wastes disk space and I/O during local iteration. Run directories and JSONL files accumulate rapidly. In CI/eval contexts, you may want only structured DB writes without filesystem noise.

---

## NICE TO HAVE

### 5. Telemetry status/stats CLI

**Source:** `src/commands.ts`: `format_telemetry_status()`, `format_telemetry_stats()` — human-readable overview of enabled state, run/turn/tool/provider counts, DB file sizes.

**Value:** Provides instant visibility into telemetry health without querying the DB directly.

**Effort:** Low — add a `telemetry` subcommand to the CLI.

---

### 6. Turn-level structured tracking

**Source:** `src/db.ts` lines 143–183: `insert_turn()`, `finish_turn()` with `stop_reason` and `tool_result_count`.

**Value:** Enables per-turn analytics: turn success rate, avg turns/run, stop_reason distribution. Currently gated behind feature 1 (structured DB).

**Effort:** Medium — requires schema extension.

---

### 7. Privacy-by-design payload summarization

**Source:** `src/summaries.ts` — `summarize_tool_args()`, `summarize_tool_result()`, `summarize_provider_payload()` convert raw content to `{type, bytes, lines}` metadata.

**Value:** Hamilton stores raw step outputs as JSON files. If runs are shared for debugging or evaluation, raw content may leak sensitive data (tokens, PII in prompts, internal system info). Summarization ensures analytics data is shareable.

**Effort:** Medium — adapter layer between event data and storage.

---

### 8. Telemetry configuration persistence

**Source:** `src/config.ts` — `load_telemetry_config()` / `save_telemetry_config()` to `~/.pi/agent/telemetry.json`.

**Value:** Allows default-on for production, default-off for development, persisted across sessions.

**Effort:** Low — depends on feature 4.

---

### 9. Model attribution per run

**Source:** `src/index.ts` lines 446–451: `model_select` event captures `model_provider` + `model_id` into closure; written to runs table on `agent_start`.

**Value:** Hamilton's `runs` table has no model/provider columns. Token costs cannot be attributed to specific models.

**Effort:** Low — add columns to `runs` table + capture from executor context.

---

### 10. Schema migration system

**Source:** `src/db.ts` lines 336–369: versioned `MIGRATIONS` map, `PRAGMA user_version`, each migration in a transaction with rollback.

**Value:** Hamilton's `createSchema()` (`src/db/schema.ts`) uses `CREATE TABLE IF NOT EXISTS` — no migration path for schema evolution. Adding columns or tables to an existing DB requires manual intervention.

**Effort:** Medium — needs version tracking and migration runner.

---

### 11. Lazy initialization

**Source:** `src/index.ts` lines 87–93: `ensure_store()` only opens SQLite on first write; `node:sqlite` dynamically imported.

**Value:** Hamilton eagerly creates run directories and opens the DB. On cheap runs (fast, single-turn), this is unnecessary overhead.

**Effort:** Low — defer `createRunDir()` and DB open.

---

### 12. Interactive TUI for run inspection

**Source:** `src/ui.ts` — home screen modal via `@spences10/pi-tui-modal` with 6 actions.

**Value:** Hamilton's `CliRenderer` provides live terminal output, but there is no interactive TUI to browse past runs.

**Effort:** High — requires TUI framework or inline rendering.

---

### 13. Eval metadata tagging

**Source:** `src/context.ts` lines 14–21: `MY_PI_EVAL_RUN_ID`, `_CASE_ID`, `_ATTEMPT`, `_SUITE` env vars → runs table.

**Value:** If Hamilton is used for benchmarking or evaluation, tagging runs with eval metadata enables filtering and comparison.

**Effort:** Low — read env vars and store in runs table.

---

### 14. Tool call partial update tracking

**Source:** `src/index.ts` lines 522–533: `tool_execution_update` increments `partial_update_count` on tool_calls table.

**Value:** For long-running or streaming tools (e.g., bash), tracking update count helps identify slow/chatty tool executions.

**Effort:** Low — add column to tool_calls table if feature 1 is implemented.

---

## NOT COMPATIBLE

### 15. Dynamic import of `node:sqlite`

Hamilton runs on **bun** with `bun:sqlite` natively available at all times. The lazy import pattern is unnecessary and impossible on bun. The motivation (avoid loading native module when disabled) is achieved via features 4/11 instead.

---

### 16. `pi-settings` integration

Hamilton has its own config system (`~/.hamilton/`). Wiring into `pi-settings` would create unwanted coupling to the Pi agent ecosystem. Feature 8 should use Hamilton's native config instead.

---

### 17. `pi-tui-modal` integration

Hamilton uses `@effect/cli` + `CliRenderer` (Effect-TS subscribers) for terminal UX. Integrating pi-tui-modal would require importing a Pi-specific package unrelated to Hamilton's execution model. If a TUI is desired (feature 12), it should be built on Effect-TS primitives or a framework-agnostic TUI library.

---

### 18. `/telemetry path` command (custom DB path)

pi-telemetry's `path` subcommand lets users change the DB file location at runtime. Hamilton's DB path is derived from `~/.hamilton/` (via `src/paths.ts`). Supporting runtime path changes would conflict with Hamilton's static path resolution.

---

## Summary

```
MUST HAVE (4):     Structured DB tables, provider request tracking, query/export CLI, enable/disable toggle
NICE TO HAVE (10): Turn tracking, status CLI, privacy summarization, config persistence, model attribution,
                   schema migrations, lazy init, TUI, eval tags, partial update tracking
NOT COMPATIBLE (4): node:sqlite dynamic import, pi-settings, pi-tui-modal, runtime DB path change
```

### Architectural diagnosis

The central gap is that pi-telemetry treats telemetry as a **structured, queryable, privacy-aware relational data store**, while Hamilton treats observability as a **best-effort filesystem log dump**.

Unstructured JSONL works for human debugging today but blocks any analytics, cost tracking, or automated evaluation pipeline tomorrow. The four MUST HAVE items constitute the minimum viable bridge between the two models.
