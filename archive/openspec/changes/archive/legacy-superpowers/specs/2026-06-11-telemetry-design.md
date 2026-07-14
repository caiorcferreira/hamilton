# Structured Telemetry for Hamilton

**Status:** Draft
**Date:** 2026-06-11
**Source:** `docs/superpowers/telemetry-gap-analysis.md`

## Overview

Add structured, queryable telemetry tables to Hamilton's SQLite database alongside the existing event-driven observability system (JSONL files, EventBus). The new tables capture turns, tool calls, and provider requests with privacy-safe payload summarization. A settings.yaml toggle controls which stores (file / db) are active. A CLI status command provides instant visibility into telemetry health. Schema changes are managed via a versioned migration system.

### Out of scope
- Query/export CLI (deferred — intentionally excluded)
- Interactive TUI for run inspection
- Eval metadata tagging
- Lazy initialization of run dirs / DB

---

## 1. Schema

### 1.1 New tables (migration v3)

#### `turns`

| column | type | constraints | notes |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `run_id` | TEXT | NOT NULL, FK → runs(id) | |
| `task_id` | TEXT | NOT NULL, FK → tasks(id) | |
| `turn_index` | INTEGER | NOT NULL | 0-based within task |
| `started_at` | TEXT | NOT NULL | ISO 8601 |
| `completed_at` | TEXT | | NULL while in-progress |
| `stop_reason` | TEXT | | `end_turn`, `max_tokens`, `tool_use`, `stop_sequence`, `refusal` |
| `tool_result_count` | INTEGER | DEFAULT 0 | |

#### `tool_calls`

| column | type | constraints | notes |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `run_id` | TEXT | NOT NULL, FK → runs(id) | denormalized for query convenience |
| `task_id` | TEXT | NOT NULL, FK → tasks(id) | |
| `turn_id` | TEXT | NOT NULL, FK → turns(id) | |
| `tool_name` | TEXT | NOT NULL | e.g. `bash`, `read`, `glob` |
| `args_summary` | TEXT | NOT NULL | JSON: `{type, bytes, keys}` |
| `result_summary` | TEXT | | NULL until completed; JSON: `{type, bytes, keys}` |
| `is_error` | INTEGER | DEFAULT 0 | 0 or 1 |
| `partial_update_count` | INTEGER | DEFAULT 0 | incremented on streaming updates |
| `started_at` | TEXT | NOT NULL | ISO 8601 |
| `completed_at` | TEXT | | NULL until completed |

#### `provider_requests`

| column | type | constraints | notes |
|---|---|---|---|
| `id` | TEXT | PK | nanoid |
| `run_id` | TEXT | NOT NULL, FK → runs(id) | denormalized |
| `task_id` | TEXT | NOT NULL, FK → tasks(id) | |
| `turn_id` | TEXT | NOT NULL, FK → turns(id) | |
| `provider` | TEXT | NOT NULL | `openai`, `anthropic`, `google`, etc. |
| `model` | TEXT | NOT NULL | `gpt-5.1`, `claude-4.0`, etc. |
| `status_code` | INTEGER | | NULL until response received |
| `payload_summary` | TEXT | NOT NULL | JSON: `{type, bytes, lines}` |
| `headers_summary` | TEXT | | JSON: `{type, bytes, keys}` |
| `tokens_in` | INTEGER | DEFAULT 0 | prompt tokens |
| `tokens_out` | INTEGER | DEFAULT 0 | completion tokens |
| `latency_ms` | INTEGER | | NULL until response; wall-clock ms |
| `started_at` | TEXT | NOT NULL | ISO 8601 |
| `completed_at` | TEXT | | NULL until response received |

### 1.2 Modified tables (migration v2)

#### `tasks` — add columns

| column | type | notes |
|---|---|---|
| `model_provider` | TEXT | populated at model selection, before task execution |
| `model_id` | TEXT | populated at model selection, before task execution |

### 1.3 Migration system

Versioned migrations stored in `src/db/migrations.ts`. Each migration runs inside a SQLite transaction with explicit rollback on error.

```typescript
const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => createSchema(db),  // existing DDL — runs, tasks, token_events, workflow_state, durable_deferred
  2: (db) => { /* ALTER TABLE tasks ADD COLUMN model_provider, model_id */ },
  3: (db) => { /* CREATE TABLE turns, tool_calls, provider_requests */ },
}
```

`migrate(db)` reads `PRAGMA user_version`, runs pending migrations in order, and updates `user_version` after each. Migration errors surface as `Data.TaggedError("MigrationError")`.

`createSchema()` remains as-is (migration v1). All future schema changes go into the `MIGRATIONS` map.

`openDb()` (`src/workflow/state.ts`) replaces its direct `createSchema(db)` call with `migrate(db)`, which runs `createSchema` as v1 if needed, then applies any pending migrations in version order.

---

## 2. Repository Layer

All repositories are Effect-TS services (tag + interface) in `src/telemetry/repositories/`. Each has one responsibility and knows nothing about other repositories. No joins in repository code — cross-table logic lives in consumers (subscriber, CLI).

### 2.1 Interfaces

```typescript
// TurnRepository
interface TurnRepository {
  readonly insert: (turn: {
    id: string; runId: string; taskId: string; turnIndex: number; startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly finish: (id: string, data: {
    stopReason: string; toolResultCount: number; completedAt: string
  }) => Effect.Effect<void, RepositoryError>
}

// ToolCallRepository
interface ToolCallRepository {
  readonly insert: (call: {
    id: string; runId: string; taskId: string; turnId: string;
    toolName: string; argsSummary: string; startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly finish: (id: string, data: {
    resultSummary: string; isError: boolean; completedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly incrementPartialUpdates: (id: string) => Effect.Effect<void, RepositoryError>
}

// ProviderRequestRepository
interface ProviderRequestRepository {
  readonly insert: (req: {
    id: string; runId: string; taskId: string; turnId: string;
    provider: string; model: string; payloadSummary: string; startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly complete: (id: string, data: {
    statusCode: number; headersSummary: string;
    tokensIn: number; tokensOut: number; latencyMs: number; completedAt: string
  }) => Effect.Effect<void, RepositoryError>
}

// TelemetryStatusRepository
type TelemetryStatus = {
  enabled: boolean
  disabledStores: Array<"file" | "db">
  dbPath: string
  dbSizeBytes: number
  runCount: number
  turnCount: number
  toolCallCount: number
  providerRequestCount: number
}

interface TelemetryStatusRepository {
  readonly getStatus: () => Effect.Effect<TelemetryStatus, RepositoryError>
}
```

### 2.2 Layers

Each repository requires `Database`. Layers are constructed from a `Database` value:

```typescript
const makeTurnRepository = (db: Database): TurnRepository => ({...})
const TurnRepositoryLive = Layer.succeed(TurnRepository, makeTurnRepository(db))

const TelemetryRepositoryLayer = Layer.mergeAll(
  TurnRepositoryLive,
  ToolCallRepositoryLive,
  ProviderRequestRepositoryLive,
  TelemetryStatusRepositoryLive,
)
```

---

## 3. Events

### 3.1 New events

| event | fields | purpose |
|---|---|---|
| `TurnStarted` | `_tag`, `runId`, `taskId`, `turnId`, `turnIndex`, `timestamp` | Signal new turn in agent loop |
| `ProviderRequestStarted` | `_tag`, `runId`, `taskId`, `turnId`, `requestId`, `provider`, `model`, `payloadSummary`, `timestamp` | Signal LLM API call start |
| `ModelSelected` | `_tag`, `runId`, `taskId`, `provider`, `model`, `timestamp` | Model chosen for a task |

### 3.2 Modified events

| event | change |
|---|---|
| `ToolCall` | Add optional `isPartialUpdate: boolean` field, default `false` |

### 3.3 Event emission responsibility

Events are emitted by the agent executor (Pi SDK integration) at the appropriate lifecycle points:

- `ModelSelected` — when model provider + id are resolved for a task
- `TurnStarted` — when the agent begins a new turn in the conversation loop
- `ProviderRequestStarted` — immediately before the HTTP call to the LLM provider
- `LlmMessage` (existing) — when the provider response arrives (now carries `requestId`, `statusCode`, `headersSummary`, `latencyMs`)
- `ToolCall` with `isPartialUpdate: true` — on each streaming partial from a tool

---

## 4. Telemetry Subscriber

Lives at `src/telemetry/subscriber.ts`. Subscribes to all events on the EventBus and delegates to repositories. Does zero business logic — pure event-to-repository mapping.

### 4.1 Event → repository mapping

| event | repository call |
|---|---|
| `TurnStarted` | `TurnRepo.insert(...)` |
| `TurnEnd` | `TurnRepo.finish(...)` |
| `ToolCall` (new call) | `ToolCallRepo.insert(...)` |
| `ToolCall` (partial update) | `ToolCallRepo.incrementPartialUpdates(...)` |
| `ToolResult` | `ToolCallRepo.finish(...)` |
| `ProviderRequestStarted` | `ProviderRequestRepo.insert(...)` |
| `LlmMessage` (response) | `ProviderRequestRepo.complete(...)` |
| `ModelSelected` | `DbWriter` updates `tasks` table with `model_provider` and `model_id` via `UPDATE tasks SET model_provider = ?, model_id = ? WHERE id = ?` |

### 4.2 Disabled behavior

When `"db"` is in `telemetry.disableStores`, the subscriber is created but all handlers short-circuit to `Effect.void`. The subscriber always exists as a forked fiber — enabling/disabling happens per-event based on config read at subscription time.

---

## 5. Payload Summarization

Module: `src/telemetry/summaries.ts`. Three pure functions — no Effect, no I/O.

```typescript
type Summary = { type: string; bytes: number; lines?: number; keys?: string[] }

summarizeToolArgs(args: unknown): Summary
summarizeToolResult(result: unknown): Summary
summarizePayload(payload: unknown): Summary
```

### 5.1 Rules

| input type | `type` | `bytes` | extra |
|---|---|---|---|
| string | `"string"` | `Buffer.byteLength(s, "utf8")` | `lines` count |
| object (non-array) | `"object"` | `JSON.stringify(o).length` | `keys` (top-level) |
| array | `"array"` | `JSON.stringify(a).length` | |
| number, boolean | `"number"` / `"boolean"` | `JSON.stringify(v).length` | |
| null, undefined | `"null"` | 0 | |
| Buffer, Uint8Array | `"binary"` | `.length` | |

Summarization is called at the **emission site** (the code that publishes events). Events carry summaries as stringified JSON. The subscriber stores them as-is. Raw content never enters the telemetry tables.

---

## 6. Configuration & Toggle

### 6.1 settings.yaml

```yaml
telemetry:
  disableStores: []  # empty = both stores enabled; valid values: "file", "db"
```

`disableStores` accepts any subset of `["file", "db"]`. Missing `telemetry` key or missing `disableStores` defaults to empty array (both enabled).

### 6.2 Config module (`src/telemetry/config.ts`)

```typescript
interface TelemetryConfig {
  disableStores: Set<"file" | "db">
}

const loadTelemetryConfig: () => Effect.Effect<TelemetryConfig, ConfigError>
const saveTelemetryConfig: (config: TelemetryConfig) => Effect.Effect<void, ConfigError>
```

Reads/writes the `telemetry` key from `settings.yaml` using the existing YAML library. `ConfigError` is a `Data.TaggedError`.

### 6.3 Toggle behavior

| store | disabled behavior |
|---|---|
| `file` | `runner.ts` skips `createRunDir()`, `FileLogger` subscriber, `createHamiltonLogger` (events.jsonl), `writeInput()`, `writeStepOutput()`, `writeSummary()`, `appendEngineLog()`. No run directory created. Zero filesystem I/O for observability. |
| `db` | `TelemetrySubscriber` handlers short-circuit to `Effect.void`. No rows written to `turns`, `tool_calls`, `provider_requests` tables. |

Unaffected by toggle (always active):
- `CliRenderer` (console UX, not telemetry)
- `DbWriter` (writes to `runs`/`tasks`/`token_events` — runtime state machine, not observability)
- `hamilton.db` creation and `runs`/`tasks` tables (runtime state)

---

## 7. CLI

### 7.1 `hamilton telemetry status`

New command `src/cli/commands/telemetry.ts` wired into `main.ts` as a top-level subcommand.

```
Telemetry: enabled
  Stores: file ✓ enabled | db ✓ enabled
  DB: ~/.hamilton/hamilton.db (1.4 MB)
  Runs: 47 | Turns: 312 | Tool calls: 1,891 | Provider requests: 312
```

When all stores disabled:
```
Telemetry: disabled (all stores)
  DB: ~/.hamilton/hamilton.db (1.4 MB)
  Runs: 47
```

Reads `TelemetryConfig` + `TelemetryStatusRepository.getStatus()`. Uses existing `src/cli/formatting/` colors and table helpers.

### 7.2 `hamilton telemetry enable/disable`

```bash
hamilton telemetry enable               # clears disableStores (both enabled)
hamilton telemetry disable file         # adds "file" to disableStores
hamilton telemetry disable db           # adds "db" to disableStores
hamilton telemetry enable file          # removes "file" from disableStores
hamilton telemetry enable db            # removes "db" from disableStores
```

`enable` with no args enables all. `enable file` and `enable db` enable individual stores. `disable file` and `disable db` disable individual stores.

These commands read the current config, mutate the set, save, and report the new state.

---

## 8. File Structure

```
src/
  telemetry/
    config.ts                   # load/save TelemetryConfig from settings.yaml
    subscriber.ts               # TelemetrySubscriber (event → repository mapping)
    summaries.ts                # summarizeToolArgs, summarizeToolResult, summarizePayload
    repositories/
      turn-repository.ts         # TurnRepository tag + live layer
      tool-call-repository.ts    # ToolCallRepository tag + live layer
      provider-request-repository.ts  # ProviderRequestRepository tag + live layer
      telemetry-status-repository.ts  # TelemetryStatusRepository tag + live layer
  db/
    migrations.ts               # MIGRATIONS map + migrate() function
    schema.ts                   # unchanged (migration v1)
    queries.ts                  # unchanged (repos own their queries)
    subscribers.ts              # unchanged (DbWriter)
  cli/
    commands/
      telemetry.ts              # hamilton telemetry status | enable | disable
    main.ts                     # add telemetry as top-level subcommand
  events/
    bus.ts                      # add TurnStarted, ProviderRequestStarted, ModelSelected events
  workflow/
    runner.ts                   # load TelemetryConfig, conditionally skip FileLogger + run dir
```

---

## 9. Testing Strategy

- **Repository tests**: In-memory SQLite, run schema migrations, exercise each method, verify row counts and column values. Pattern: `bun --bun vitest run tests/telemetry/repositories/`.
- **Summaries tests**: Pure function tests — no DB needed. Input/output pairs for each input type (string, object, array, binary, null).
- **Subscriber tests**: In-memory SQLite + repositories + EventBus. Publish events, assert correct rows exist in tables.
- **Config tests**: Temp `settings.yaml`, read, mutate, save, verify round-trip.
- **Migration tests**: Create v1 DB, run migrate to v2, verify new columns exist. Then to v3, verify new tables exist. Error state tests for invalid versions.
- **CLI tests**: Real temp home dir, create settings.yaml, run `hamilton telemetry status` / `enable` / `disable`, check output. Pattern: `bun --bun vitest run tests/cli/telemetry.test.ts`.
- **Toggle integration tests**: Run workflow with `disableStores: [file]` — assert no run dir. With `disableStores: [db]` — assert no rows in telemetry tables.
- **Existing tests**: Must continue passing. `runs`, `tasks`, `token_events` tables unchanged. No breaking schema changes to existing tables (only additive `ALTER TABLE` via migration v2).
