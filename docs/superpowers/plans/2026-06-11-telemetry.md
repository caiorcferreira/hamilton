# Structured Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured telemetry tables (turns, tool_calls, provider_requests), provider request tracking, enable/disable toggle, status CLI, turn-level tracking, payload summarization, model attribution, schema migrations, and tool call partial update tracking.

**Architecture:** Repository-pattern Effect-TS services in `src/telemetry/repositories/` backed by `bun:sqlite`. A `TelemetrySubscriber` maps EventBus events to repository calls. Schema managed by versioned `MIGRATIONS` map in `src/db/migrations.ts`. Toggle stored in `settings.yaml` under `telemetry.disableStores`. CLI uses `@effect/cli` Command pattern.

**Tech Stack:** TypeScript, bun, Effect-TS (`Data.TaggedError`, `Context.Tag`, `Layer`, `Effect`), `bun:sqlite`, `yaml`, vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/events/bus.ts` | Modify | Add `TurnStarted`, `ProviderRequestStarted`, `ModelSelected` events; add `isPartialUpdate` to `ToolCall` |
| `src/db/migrations.ts` | Create | `MIGRATIONS` map (v1→v2→v3) + `migrate()` function |
| `src/db/subscribers.ts` | Modify | Handle `ModelSelected` → update tasks table |
| `src/workflow/state.ts` | Modify | Replace `createSchema(db)` with `migrate(db)` |
| `src/telemetry/summaries.ts` | Create | `summarizeToolArgs`, `summarizeToolResult`, `summarizePayload` |
| `src/telemetry/config.ts` | Create | `loadTelemetryConfig`, `saveTelemetryConfig` |
| `src/telemetry/repositories/turn-repository.ts` | Create | `TurnRepository` tag + live layer |
| `src/telemetry/repositories/tool-call-repository.ts` | Create | `ToolCallRepository` tag + live layer |
| `src/telemetry/repositories/provider-request-repository.ts` | Create | `ProviderRequestRepository` tag + live layer |
| `src/telemetry/repositories/telemetry-status-repository.ts` | Create | `TelemetryStatusRepository` tag + live layer |
| `src/telemetry/subscriber.ts` | Create | `TelemetrySubscriber` — EventBus → repository mapping |
| `src/cli/commands/telemetry.ts` | Create | `hamilton telemetry status | enable | disable` |
| `src/cli/main.ts` | Modify | Add `telemetryCommand` as top-level subcommand |
| `src/workflow/runner.ts` | Modify | Load `TelemetryConfig`, conditionally skip file ops |
| `src/cli/commands/run.ts` | Modify | Wire `TelemetrySubscriber` |
| `src/cli/commands/init.ts` | Modify | Add `telemetry.disableStores: []` to default settings |
| `tests/telemetry/summaries.test.ts` | Create | Pure function tests |
| `tests/telemetry/config.test.ts` | Create | Config round-trip tests |
| `tests/telemetry/repositories/turn-repository.test.ts` | Create | DB-backed tests |
| `tests/telemetry/repositories/tool-call-repository.test.ts` | Create | DB-backed tests |
| `tests/telemetry/repositories/provider-request-repository.test.ts` | Create | DB-backed tests |
| `tests/telemetry/repositories/telemetry-status-repository.test.ts` | Create | DB-backed tests |
| `tests/telemetry/subscriber.test.ts` | Create | EventBus + repo integration tests |
| `tests/db/migrations.test.ts` | Create | Migration lifecycle tests |
| `tests/cli/telemetry.test.ts` | Create | CLI output tests |

---

### Task 1: Add new events to EventBus and update DbWriter for ModelSelected

**Files:**
- Modify: `src/events/bus.ts`
- Modify: `src/db/subscribers.ts`

- [ ] **Step 1: Modify `src/events/bus.ts` — add new events and modify ToolCall**

Replace the `Event` type union in `src/events/bus.ts` (lines 11-25) with:

```typescript
export type Event =
  | { readonly _tag: "WorkflowStarted"; readonly runId: string }
  | { readonly _tag: "StepStarted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepCompleted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepFailed"; readonly runId: string; readonly stepId: string; readonly message: string }
  | { readonly _tag: "StepTimedOut"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepRetrying"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepPaused"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string }
  | { readonly _tag: "LlmMessage"; readonly runId: string; readonly stepId: string; readonly text: string }
  | { readonly _tag: "ToolCall"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly input: unknown; readonly isPartialUpdate?: boolean }
  | { readonly _tag: "ToolResult"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly isError: boolean }
  | { readonly _tag: "TurnEnd"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "TokenUsage"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "PromptBuilt"; readonly runId: string; readonly stepId: string; readonly systemPrompt: string; readonly taskPrompt: string }
  | { readonly _tag: "TurnStarted"; readonly runId: string; readonly stepId: string; readonly turnId: string; readonly turnIndex: number; readonly timestamp: string }
  | { readonly _tag: "ProviderRequestStarted"; readonly runId: string; readonly stepId: string; readonly turnId: string; readonly requestId: string; readonly provider: string; readonly model: string; readonly payloadSummary: string; readonly timestamp: string }
  | { readonly _tag: "ModelSelected"; readonly runId: string; readonly stepId: string; readonly provider: string; readonly model: string; readonly timestamp: string }
```

- [ ] **Step 2: Update `src/db/subscribers.ts` — add `ModelSelected` handling**

Replace the contents of `src/db/subscribers.ts`:

```typescript
import { Effect, Scope } from "effect"
import { Database } from "bun:sqlite"
import { Event, createSubscriber, EventBus } from "../events/bus.js"
import { insertTokenEvent } from "./queries.js"

export const DbWriter = (db: Database): Effect.Effect<void, never, Scope.Scope | EventBus> =>
  createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      if (event._tag === "TokenUsage") {
        return Effect.sync(() =>
          insertTokenEvent(db, event.runId, event.stepId, "completion", event.tokensIn, event.tokensOut)
        )
      }
      if (event._tag === "ModelSelected") {
        return Effect.sync(() =>
          db.prepare(
            `UPDATE tasks SET model_provider = ?, model_id = ? WHERE id = ?`
          ).run(event.provider, event.model, event.stepId)
        )
      }
      return Effect.void
    }
  )
```

- [ ] **Step 3: Run build to verify** no type errors

```bash
bun run build
```

Expected: PASS. Existing subscribers use `default:`/catch-all patterns that handle new events.

- [ ] **Step 4: Run existing tests to confirm no regressions**

```bash
bun --bun vitest run
```

Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/events/bus.ts src/db/subscribers.ts
git commit -m "feat: add telemetry events and ModelSelected handling"
```

---

### Task 2: Create schema migration system

**Files:**
- Create: `src/db/migrations.ts`
- Create: `tests/db/migrations.test.ts`
- Modify: `src/workflow/state.ts`

- [ ] **Step 1: Write failing tests for migration system**

Create `tests/db/migrations.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-mig-test-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("migrations", () => {
  let db: Database

  afterEach(() => {
    if (db) cleanupDb(db)
  })

  it("migrate creates all tables from scratch (v1 -> v3)", () => {
    db = tempDb()
    const v = db.prepare("PRAGMA user_version").get() as { user_version: number }
    expect(v.user_version).toBe(0)

    migrate(db)

    const v2 = db.prepare("PRAGMA user_version").get() as { user_version: number }
    expect(v2.user_version).toBe(3)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
    const names = tables.map(t => t.name)
    expect(names).toContain("runs")
    expect(names).toContain("tasks")
    expect(names).toContain("token_events")
    expect(names).toContain("workflow_state")
    expect(names).toContain("durable_deferred")
    expect(names).toContain("turns")
    expect(names).toContain("tool_calls")
    expect(names).toContain("provider_requests")
  })

  it("v1 -> v2 adds model_provider and model_id to tasks", () => {
    db = tempDb()
    db.prepare("PRAGMA user_version = 1").run()
    db.exec("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT, current_task TEXT, error_message TEXT, context_json TEXT DEFAULT '{}')")
    db.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', started_at TEXT, completed_at TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, retry_count INTEGER DEFAULT 0, error_message TEXT, output_json TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")

    migrate(db)

    const info = db.prepare("PRAGMA table_info('tasks')").all() as Array<{ name: string }>
    const colNames = info.map(c => c.name)
    expect(colNames).toContain("model_provider")
    expect(colNames).toContain("model_id")
  })

  it("v2 -> v3 creates turns, tool_calls, provider_requests tables", () => {
    db = tempDb()
    db.prepare("PRAGMA user_version = 2").run()
    db.exec("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT, current_task TEXT, error_message TEXT, context_json TEXT DEFAULT '{}')")
    db.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', started_at TEXT, completed_at TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, retry_count INTEGER DEFAULT 0, error_message TEXT, output_json TEXT, model_provider TEXT, model_id TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")

    migrate(db)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
    const names = tables.map(t => t.name)
    expect(names).toContain("turns")
    expect(names).toContain("tool_calls")
    expect(names).toContain("provider_requests")
  })

  it("migrate is idempotent", () => {
    db = tempDb()
    migrate(db)
    const v1 = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    expect(v1).toBe(3)

    migrate(db)
    const v2 = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    expect(v2).toBe(3)
  })

  it("migrate error rolls back without changing version", () => {
    db = tempDb()
    db.prepare("PRAGMA user_version = 1").run()
    db.exec("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT, current_task TEXT, error_message TEXT, context_json TEXT DEFAULT '{}')")
    db.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', started_at TEXT, completed_at TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, retry_count INTEGER DEFAULT 0, error_message TEXT, output_json TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")
    db.exec("CREATE TABLE IF NOT EXISTS token_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT NOT NULL, event_type TEXT NOT NULL, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, timestamp TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (run_id) REFERENCES runs(id))")
    db.exec("CREATE TABLE IF NOT EXISTS workflow_state (run_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (run_id, key))")
    db.exec("CREATE TABLE IF NOT EXISTS durable_deferred (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', value TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")

    db.prepare("CREATE TABLE IF NOT EXISTS tasks (invalid)").run()

    try {
      migrate(db)
    } catch {
      // expected
    }

    const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    expect(v).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/db/migrations.test.ts
```

Expected: FAIL — module `../../src/db/migrations.js` not found.

- [ ] **Step 3: Implement `src/db/migrations.ts`**

```typescript
import { Database } from "bun:sqlite"
import { Data } from "effect"
import { createSchema } from "./schema.js"

export class MigrationError extends Data.TaggedError("MigrationError")<{
  version: number
  message: string
}> {}

const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => createSchema(db),
  2: (db) => {
    db.exec("ALTER TABLE tasks ADD COLUMN model_provider TEXT")
    db.exec("ALTER TABLE tasks ADD COLUMN model_id TEXT")
  },
  3: (db) => {
    db.exec("CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_index INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, stop_reason TEXT, tool_result_count INTEGER DEFAULT 0, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id))")
    db.exec("CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, tool_name TEXT NOT NULL, args_summary TEXT NOT NULL, result_summary TEXT, is_error INTEGER DEFAULT 0, partial_update_count INTEGER DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
    db.exec("CREATE TABLE IF NOT EXISTS provider_requests (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status_code INTEGER, payload_summary TEXT NOT NULL, headers_summary TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, latency_ms INTEGER, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
  }
}

const LATEST_VERSION = 3

export function migrate(db: Database): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number }
  const currentVersion: number = row.user_version

  const versions = Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b)

  for (const version of versions) {
    if (version <= currentVersion) continue

    try {
      db.transaction(() => {
        MIGRATIONS[version](db)
        db.prepare("PRAGMA user_version = " + version).run()
      })()
    } catch (e) {
      if (e instanceof MigrationError) throw e
      throw new MigrationError({ version, message: String(e) })
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/db/migrations.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Update `src/workflow/state.ts` — replace `createSchema(db)` with `migrate(db)`**

In `src/workflow/state.ts` line 4, change the import:
```typescript
import { createSchema } from "../db/schema.js"
```
to:
```typescript
import { migrate } from "../db/migrations.js"
```

On line 40, change `createSchema(db)` to `migrate(db)`.

- [ ] **Step 6: Run build and full test suite**

```bash
bun run build
bun --bun vitest run
```

Expected: Build passes. All tests pass (existing + 5 new migration tests).

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations.ts tests/db/migrations.test.ts src/workflow/state.ts
git commit -m "feat: add versioned schema migration system with v1-v3"
```

---

### Task 3: Create payload summarization module

**Files:**
- Create: `src/telemetry/summaries.ts`
- Create: `tests/telemetry/summaries.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/telemetry/summaries.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  summarizeToolArgs,
  summarizeToolResult,
  summarizePayload
} from "../../src/telemetry/summaries.js"

describe("summaries", () => {
  describe("summarizeToolArgs", () => {
    it("summarizes an object with keys", () => {
      const result = summarizeToolArgs({ command: "ls", cwd: "/tmp" })
      expect(result.type).toBe("object")
      expect(result.keys).toEqual(["command", "cwd"])
    })

    it("summarizes a string", () => {
      const result = summarizeToolArgs("hello world")
      expect(result.type).toBe("string")
      expect(result.bytes).toBe(Buffer.byteLength("hello world", "utf8"))
    })

    it("summarizes null / undefined", () => {
      const result = summarizeToolArgs(null)
      expect(result.type).toBe("null")
      expect(result.bytes).toBe(0)
    })

    it("summarizes an array", () => {
      const result = summarizeToolArgs([1, 2, 3])
      expect(result.type).toBe("array")
    })

    it("summarizes a number", () => {
      const result = summarizeToolArgs(42)
      expect(result.type).toBe("number")
      expect(result.bytes).toBe(2)
    })

    it("summarizes a boolean", () => {
      const result = summarizeToolArgs(true)
      expect(result.type).toBe("boolean")
      expect(result.bytes).toBe(4)
    })
  })

  describe("summarizeToolResult", () => {
    it("summarizes string result", () => {
      const result = summarizeToolResult("file contents here")
      expect(result.type).toBe("string")
      expect(result.lines).toBe(1)
    })

    it("summarizes multiline string result", () => {
      const result = summarizeToolResult("line1\nline2\nline3")
      expect(result.lines).toBe(3)
    })

    it("summarizes object result with keys", () => {
      const result = summarizeToolResult({ output: "done", count: 5 })
      expect(result.type).toBe("object")
      expect(result.keys).toEqual(["output", "count"])
    })

    it("summarizes Buffer / Uint8Array", () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04])
      const result = summarizeToolResult(buf)
      expect(result.type).toBe("binary")
      expect(result.bytes).toBe(4)
    })
  })

  describe("summarizePayload", () => {
    it("summarizes array payload", () => {
      const payload = [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]
      const result = summarizePayload(payload)
      expect(result.type).toBe("array")
    })

    it("summarizes object payload", () => {
      const payload = { model: "gpt-5.1", messages: [] }
      const result = summarizePayload(payload)
      expect(result.type).toBe("object")
      expect(result.keys).toEqual(["model", "messages"])
    })

    it("summarizes string payload", () => {
      const result = summarizePayload("a\nb\nc\nd")
      expect(result.type).toBe("string")
      expect(result.lines).toBe(4)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/telemetry/summaries.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/telemetry/summaries.ts`**

```typescript
export interface Summary {
  type: string
  bytes: number
  lines?: number
  keys?: string[]
}

function classify(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return "string"
  if (typeof value === "number") return "number"
  if (typeof value === "boolean") return "boolean"
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return "binary"
  if (Array.isArray(value)) return "array"
  return "object"
}

function measure(value: unknown, t: string): { bytes: number; lines?: number; keys?: string[] } {
  if (t === "null") return { bytes: 0 }
  if (t === "string") {
    const s = value as string
    return { bytes: Buffer.byteLength(s, "utf8"), lines: s.split("\n").length }
  }
  if (t === "binary") return { bytes: (value as Uint8Array).length }
  if (t === "object" && !Array.isArray(value)) {
    const s = JSON.stringify(value)
    const keys = Object.keys(value as Record<string, unknown>)
    return { bytes: s.length, keys }
  }
  const s = JSON.stringify(value)
  return { bytes: s.length }
}

export function summarizeToolArgs(args: unknown): Summary {
  const type = classify(args)
  const m = measure(args, type)
  return { type, bytes: m.bytes, keys: m.keys }
}

export function summarizeToolResult(result: unknown): Summary {
  const type = classify(result)
  const m = measure(result, type)
  return { type, bytes: m.bytes, lines: m.lines, keys: m.keys }
}

export function summarizePayload(payload: unknown): Summary {
  const type = classify(payload)
  const m = measure(payload, type)
  return { type, bytes: m.bytes, lines: m.lines, keys: m.keys }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/summaries.test.ts
```

Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/summaries.ts tests/telemetry/summaries.test.ts
git commit -m "feat: add payload summarization functions"
```

---

### Task 4: Create telemetry config module

**Files:**
- Create: `src/telemetry/config.ts`
- Create: `tests/telemetry/config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/telemetry/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { loadTelemetryConfig, saveTelemetryConfig } from "../../src/telemetry/config.js"

describe("telemetry config", () => {
  let origHome: string | undefined
  let tmpDir: string

  beforeEach(() => {
    origHome = process.env.HOME
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-tcfg-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loads default config when settings.yaml does not exist", async () => {
    const exit = await Effect.runPromiseExit(loadTelemetryConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.disableStores.has("file")).toBe(false)
      expect(exit.value.disableStores.has("db")).toBe(false)
      expect(exit.value.disableStores.size).toBe(0)
    }
  })

  it("loads config from settings.yaml", async () => {
    const yaml = "telemetry:\n  disableStores:\n    - file\n    - db\n"
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), yaml)

    const exit = await Effect.runPromiseExit(loadTelemetryConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.disableStores.has("file")).toBe(true)
      expect(exit.value.disableStores.has("db")).toBe(true)
    }
  })

  it("saveTelemetryConfig writes and loadTelemetryConfig reads back", async () => {
    const config = { disableStores: new Set(["file"] as const) }
    const saveExit = await Effect.runPromiseExit(saveTelemetryConfig(config))
    expect(Exit.isSuccess(saveExit)).toBe(true)

    const loadExit = await Effect.runPromiseExit(loadTelemetryConfig)
    expect(Exit.isSuccess(loadExit)).toBe(true)
    if (Exit.isSuccess(loadExit)) {
      expect(loadExit.value.disableStores.has("file")).toBe(true)
      expect(loadExit.value.disableStores.has("db")).toBe(false)
    }
  })

  it("persists enable all (empty disableStores)", async () => {
    const yaml = "telemetry:\n  disableStores:\n    - file\n"
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), yaml)

    const config = { disableStores: new Set<"file" | "db">() }
    await Effect.runPromiseExit(saveTelemetryConfig(config))

    const content = Fs.readFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), "utf-8")
    expect(content).toContain("disableStores: []")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/telemetry/config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/telemetry/config.ts`**

```typescript
import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../paths.js"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  message: string
}> {}

export interface TelemetryConfig {
  disableStores: Set<"file" | "db">
}

function defaultConfig(): TelemetryConfig {
  return { disableStores: new Set() }
}

export const loadTelemetryConfig: () => Effect.Effect<TelemetryConfig, ConfigError> = () =>
  Effect.try({
    try: () => {
      const path = settingsPath()
      if (!Fs.existsSync(path)) return defaultConfig()

      const content = Fs.readFileSync(path, "utf-8")
      const doc = Yaml.parse(content) as Record<string, unknown> | null
      if (!doc || typeof doc !== "object") return defaultConfig()

      const telemetry = doc["telemetry"]
      if (!telemetry || typeof telemetry !== "object") return defaultConfig()

      const stores = (telemetry as Record<string, unknown>)["disableStores"]
      if (!Array.isArray(stores)) return defaultConfig()

      const set = new Set<"file" | "db">()
      for (const s of stores) {
        if (s === "file" || s === "db") set.add(s)
      }
      return { disableStores: set }
    },
    catch: (e) => new ConfigError({ message: "Failed to load telemetry config: " + String(e) })
  })

export const saveTelemetryConfig: (config: TelemetryConfig) => Effect.Effect<void, ConfigError> = (config) =>
  Effect.try({
    try: () => {
      const path = settingsPath()
      const content = Fs.existsSync(path) ? Fs.readFileSync(path, "utf-8") : ""
      let doc = (Yaml.parse(content) as Record<string, unknown> | null) ?? {}

      if (typeof doc !== "object" || Array.isArray(doc)) doc = {}

      const stores = Array.from(config.disableStores)
      ;(doc as Record<string, unknown>)["telemetry"] = { disableStores: stores }

      Fs.writeFileSync(path, Yaml.stringify(doc), "utf-8")
    },
    catch: (e) => new ConfigError({ message: "Failed to save telemetry config: " + String(e) })
  })
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/config.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/config.ts tests/telemetry/config.test.ts
git commit -m "feat: add telemetry config load/save from settings.yaml"
```

---

### Task 5: Create TurnRepository

**Files:**
- Create: `src/telemetry/repositories/turn-repository.ts`
- Create: `tests/telemetry/repositories/turn-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/telemetry/repositories/turn-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit, Context, Layer } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../../src/db/migrations.js"
import { TurnRepository, makeTurnRepository } from "../../../../src/telemetry/repositories/turn-repository.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-turn-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  migrate(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("TurnRepository", () => {
  let db: Database
  let repo: TurnRepository

  beforeEach(() => {
    db = tempDb()
    repo = makeTurnRepository(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("insert creates a row in turns table", async () => {
    const exit = await Effect.runPromiseExit(
      repo.insert({
        id: "turn-1",
        runId: "run-1",
        taskId: "task-1",
        turnIndex: 0,
        startedAt: "2026-01-01T00:00:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM turns WHERE id = ?").get("turn-1") as any
    expect(row).not.toBeNull()
    expect(row.run_id).toBe("run-1")
    expect(row.task_id).toBe("task-1")
    expect(row.turn_index).toBe(0)
    expect(row.started_at).toBe("2026-01-01T00:00:00Z")
    expect(row.completed_at).toBeNull()
    expect(row.stop_reason).toBeNull()
    expect(row.tool_result_count).toBe(0)
  })

  it("finish updates stop_reason, tool_result_count, completed_at", async () => {
    await Effect.runPromiseExit(
      repo.insert({
        id: "turn-2",
        runId: "run-1",
        taskId: "task-1",
        turnIndex: 1,
        startedAt: "2026-01-01T00:00:00Z"
      })
    )

    const exit = await Effect.runPromiseExit(
      repo.finish("turn-2", {
        stopReason: "end_turn",
        toolResultCount: 3,
        completedAt: "2026-01-01T00:01:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM turns WHERE id = ?").get("turn-2") as any
    expect(row.stop_reason).toBe("end_turn")
    expect(row.tool_result_count).toBe(3)
    expect(row.completed_at).toBe("2026-01-01T00:01:00Z")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/telemetry/repositories/turn-repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/telemetry/repositories/turn-repository.ts`**

```typescript
import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export interface TurnRepository {
  readonly insert: (turn: {
    id: string
    runId: string
    taskId: string
    turnIndex: number
    startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly finish: (id: string, data: {
    stopReason: string
    toolResultCount: number
    completedAt: string
  }) => Effect.Effect<void, RepositoryError>
}

export const TurnRepository = Context.GenericTag<TurnRepository>("TurnRepository")

export const makeTurnRepository = (db: Database): TurnRepository => ({
  insert: (turn) =>
    Effect.try({
      try: () => {
        db.prepare(
          "INSERT INTO turns (id, run_id, task_id, turn_index, started_at) VALUES (?, ?, ?, ?, ?)"
        ).run(turn.id, turn.runId, turn.taskId, turn.turnIndex, turn.startedAt)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  finish: (id, data) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE turns SET stop_reason = ?, tool_result_count = ?, completed_at = ? WHERE id = ?"
        ).run(data.stopReason, data.toolResultCount, data.completedAt, id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const TurnRepositoryLive = (db: Database) =>
  Layer.succeed(TurnRepository, makeTurnRepository(db))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/repositories/turn-repository.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/repositories/turn-repository.ts tests/telemetry/repositories/turn-repository.test.ts
git commit -m "feat: add TurnRepository"
```

---

### Task 6: Create ToolCallRepository

**Files:**
- Create: `src/telemetry/repositories/tool-call-repository.ts`
- Create: `tests/telemetry/repositories/tool-call-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/telemetry/repositories/tool-call-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../../src/db/migrations.js"
import { makeToolCallRepository, ToolCallRepository } from "../../../../src/telemetry/repositories/tool-call-repository.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-tc-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  migrate(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("ToolCallRepository", () => {
  let db: Database
  let repo: ToolCallRepository

  beforeEach(() => {
    db = tempDb()
    repo = makeToolCallRepository(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("insert creates a row in tool_calls table", async () => {
    const exit = await Effect.runPromiseExit(
      repo.insert({
        id: "tc-1",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        toolName: "bash",
        argsSummary: JSON.stringify({ type: "object", bytes: 30, keys: ["command"] }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM tool_calls WHERE id = ?").get("tc-1") as any
    expect(row.tool_name).toBe("bash")
    expect(row.args_summary).toContain("command")
    expect(row.partial_update_count).toBe(0)
    expect(row.is_error).toBe(0)
    expect(row.result_summary).toBeNull()
  })

  it("finish updates result_summary, is_error, completed_at", async () => {
    await Effect.runPromiseExit(
      repo.insert({
        id: "tc-2",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        toolName: "read",
        argsSummary: JSON.stringify({ type: "string", bytes: 10 }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )

    const exit = await Effect.runPromiseExit(
      repo.finish("tc-2", {
        resultSummary: JSON.stringify({ type: "string", bytes: 500 }),
        isError: false,
        completedAt: "2026-01-01T00:01:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM tool_calls WHERE id = ?").get("tc-2") as any
    expect(row.result_summary).toContain("500")
    expect(row.is_error).toBe(0)
    expect(row.completed_at).toBe("2026-01-01T00:01:00Z")
  })

  it("finish marks is_error when tool failed", async () => {
    await Effect.runPromiseExit(
      repo.insert({
        id: "tc-3",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        toolName: "bash",
        argsSummary: JSON.stringify({ type: "string", bytes: 5 }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )

    await Effect.runPromiseExit(
      repo.finish("tc-3", {
        resultSummary: JSON.stringify({ type: "string", bytes: 100 }),
        isError: true,
        completedAt: "2026-01-01T00:01:00Z"
      })
    )

    const row = db.prepare("SELECT * FROM tool_calls WHERE id = ?").get("tc-3") as any
    expect(row.is_error).toBe(1)
  })

  it("incrementPartialUpdates increments the counter", async () => {
    await Effect.runPromiseExit(
      repo.insert({
        id: "tc-4",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        toolName: "bash",
        argsSummary: JSON.stringify({ type: "string", bytes: 5 }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )

    await Effect.runPromiseExit(repo.incrementPartialUpdates("tc-4"))
    await Effect.runPromiseExit(repo.incrementPartialUpdates("tc-4"))
    await Effect.runPromiseExit(repo.incrementPartialUpdates("tc-4"))

    const row = db.prepare("SELECT * FROM tool_calls WHERE id = ?").get("tc-4") as any
    expect(row.partial_update_count).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/telemetry/repositories/tool-call-repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/telemetry/repositories/tool-call-repository.ts`**

```typescript
import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export interface ToolCallRepository {
  readonly insert: (call: {
    id: string
    runId: string
    taskId: string
    turnId: string
    toolName: string
    argsSummary: string
    startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly finish: (id: string, data: {
    resultSummary: string
    isError: boolean
    completedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly incrementPartialUpdates: (id: string) => Effect.Effect<void, RepositoryError>
}

export const ToolCallRepository = Context.GenericTag<ToolCallRepository>("ToolCallRepository")

export const makeToolCallRepository = (db: Database): ToolCallRepository => ({
  insert: (call) =>
    Effect.try({
      try: () => {
        db.prepare(
          "INSERT INTO tool_calls (id, run_id, task_id, turn_id, tool_name, args_summary, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(call.id, call.runId, call.taskId, call.turnId, call.toolName, call.argsSummary, call.startedAt)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  finish: (id, data) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE tool_calls SET result_summary = ?, is_error = ?, completed_at = ? WHERE id = ?"
        ).run(data.resultSummary, data.isError ? 1 : 0, data.completedAt, id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  incrementPartialUpdates: (id) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE tool_calls SET partial_update_count = partial_update_count + 1 WHERE id = ?"
        ).run(id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const ToolCallRepositoryLive = (db: Database) =>
  Layer.succeed(ToolCallRepository, makeToolCallRepository(db))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/repositories/tool-call-repository.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/repositories/tool-call-repository.ts tests/telemetry/repositories/tool-call-repository.test.ts
git commit -m "feat: add ToolCallRepository"
```

---

### Task 7: Create ProviderRequestRepository

**Files:**
- Create: `src/telemetry/repositories/provider-request-repository.ts`
- Create: `tests/telemetry/repositories/provider-request-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/telemetry/repositories/provider-request-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../../src/db/migrations.js"
import { makeProviderRequestRepository, ProviderRequestRepository } from "../../../../src/telemetry/repositories/provider-request-repository.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-pr-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  migrate(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("ProviderRequestRepository", () => {
  let db: Database
  let repo: ProviderRequestRepository

  beforeEach(() => {
    db = tempDb()
    repo = makeProviderRequestRepository(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("insert creates a row in provider_requests table", async () => {
    const exit = await Effect.runPromiseExit(
      repo.insert({
        id: "pr-1",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        provider: "openai",
        model: "gpt-5.1",
        payloadSummary: JSON.stringify({ type: "array", bytes: 500, lines: 10 }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM provider_requests WHERE id = ?").get("pr-1") as any
    expect(row.provider).toBe("openai")
    expect(row.model).toBe("gpt-5.1")
    expect(row.payload_summary).toContain("500")
    expect(row.status_code).toBeNull()
    expect(row.tokens_in).toBe(0)
    expect(row.completed_at).toBeNull()
  })

  it("complete updates status_code, headers, tokens, latency", async () => {
    await Effect.runPromiseExit(
      repo.insert({
        id: "pr-2",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        provider: "anthropic",
        model: "claude-4",
        payloadSummary: JSON.stringify({ type: "object", bytes: 800, keys: ["messages"] }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )

    const exit = await Effect.runPromiseExit(
      repo.complete("pr-2", {
        statusCode: 200,
        headersSummary: JSON.stringify({ type: "object", bytes: 200, keys: ["content-type"] }),
        tokensIn: 150,
        tokensOut: 300,
        latencyMs: 1200,
        completedAt: "2026-01-01T00:00:01Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM provider_requests WHERE id = ?").get("pr-2") as any
    expect(row.status_code).toBe(200)
    expect(row.headers_summary).toContain("content-type")
    expect(row.tokens_in).toBe(150)
    expect(row.tokens_out).toBe(300)
    expect(row.latency_ms).toBe(1200)
    expect(row.completed_at).toBe("2026-01-01T00:00:01Z")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/telemetry/repositories/provider-request-repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/telemetry/repositories/provider-request-repository.ts`**

```typescript
import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export interface ProviderRequestRepository {
  readonly insert: (req: {
    id: string
    runId: string
    taskId: string
    turnId: string
    provider: string
    model: string
    payloadSummary: string
    startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly complete: (id: string, data: {
    statusCode: number
    headersSummary: string
    tokensIn: number
    tokensOut: number
    latencyMs: number
    completedAt: string
  }) => Effect.Effect<void, RepositoryError>
}

export const ProviderRequestRepository = Context.GenericTag<ProviderRequestRepository>("ProviderRequestRepository")

export const makeProviderRequestRepository = (db: Database): ProviderRequestRepository => ({
  insert: (req) =>
    Effect.try({
      try: () => {
        db.prepare(
          "INSERT INTO provider_requests (id, run_id, task_id, turn_id, provider, model, payload_summary, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(req.id, req.runId, req.taskId, req.turnId, req.provider, req.model, req.payloadSummary, req.startedAt)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  complete: (id, data) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE provider_requests SET status_code = ?, headers_summary = ?, tokens_in = ?, tokens_out = ?, latency_ms = ?, completed_at = ? WHERE id = ?"
        ).run(data.statusCode, data.headersSummary, data.tokensIn, data.tokensOut, data.latencyMs, data.completedAt, id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const ProviderRequestRepositoryLive = (db: Database) =>
  Layer.succeed(ProviderRequestRepository, makeProviderRequestRepository(db))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/repositories/provider-request-repository.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/repositories/provider-request-repository.ts tests/telemetry/repositories/provider-request-repository.test.ts
git commit -m "feat: add ProviderRequestRepository"
```

---

### Task 8: Create TelemetryStatusRepository

**Files:**
- Create: `src/telemetry/repositories/telemetry-status-repository.ts`
- Create: `tests/telemetry/repositories/telemetry-status-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/telemetry/repositories/telemetry-status-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../../src/db/migrations.js"
import { makeTelemetryStatusRepository, TelemetryStatusRepository } from "../../../../src/telemetry/repositories/telemetry-status-repository.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-ts-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  migrate(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("TelemetryStatusRepository", () => {
  let db: Database
  let repo: TelemetryStatusRepository

  beforeEach(() => {
    db = tempDb()
    repo = makeTelemetryStatusRepository(db, () => ({ disableStores: new Set() }))
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("returns zero counts for empty DB", async () => {
    const exit = await Effect.runPromiseExit(repo.getStatus())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.runCount).toBe(0)
      expect(exit.value.turnCount).toBe(0)
      expect(exit.value.toolCallCount).toBe(0)
      expect(exit.value.providerRequestCount).toBe(0)
      expect(exit.value.disabledStores).toEqual([])
      expect(exit.value.enabled).toBe(true)
    }
  })

  it("returns correct counts after inserting rows", async () => {
    db.prepare("INSERT INTO runs (id, workflow_id, started_at) VALUES ('r1', 'wf1', 'now')").run()
    db.prepare("INSERT INTO turns (id, run_id, task_id, turn_index, started_at) VALUES ('t1', 'r1', 'tsk1', 0, 'now')").run()
    db.prepare("INSERT INTO turns (id, run_id, task_id, turn_index, started_at) VALUES ('t2', 'r1', 'tsk1', 1, 'now')").run()
    db.prepare("INSERT INTO tool_calls (id, run_id, task_id, turn_id, tool_name, args_summary, started_at) VALUES ('tc1', 'r1', 'tsk1', 't1', 'bash', '{}', 'now')").run()
    db.prepare("INSERT INTO provider_requests (id, run_id, task_id, turn_id, provider, model, payload_summary, started_at) VALUES ('pr1', 'r1', 'tsk1', 't1', 'openai', 'gpt-5', '{}', 'now')").run()

    const exit = await Effect.runPromiseExit(repo.getStatus())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.runCount).toBe(1)
      expect(exit.value.turnCount).toBe(2)
      expect(exit.value.toolCallCount).toBe(1)
      expect(exit.value.providerRequestCount).toBe(1)
    }
  })

  it("reports disabledStores from config", async () => {
    const disabledRepo = makeTelemetryStatusRepository(db, () => ({
      disableStores: new Set(["file", "db"] as const)
    }))
    const exit = await Effect.runPromiseExit(disabledRepo.getStatus())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.disabledStores).toEqual(["file", "db"])
      expect(exit.value.enabled).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/telemetry/repositories/telemetry-status-repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/telemetry/repositories/telemetry-status-repository.ts`**

```typescript
import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"
import type { TelemetryConfig } from "../config.js"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export type TelemetryStatus = {
  enabled: boolean
  disabledStores: Array<"file" | "db">
  dbPath: string
  dbSizeBytes: number
  runCount: number
  turnCount: number
  toolCallCount: number
  providerRequestCount: number
}

export interface TelemetryStatusRepository {
  readonly getStatus: () => Effect.Effect<TelemetryStatus, RepositoryError>
}

export const TelemetryStatusRepository = Context.GenericTag<TelemetryStatusRepository>("TelemetryStatusRepository")

export const makeTelemetryStatusRepository = (
  db: Database,
  getConfig: () => TelemetryConfig
): TelemetryStatusRepository => ({
  getStatus: () =>
    Effect.try({
      try: () => {
        const config = getConfig()
        const disabled = Array.from(config.disableStores)

        const runCount = (db.prepare("SELECT COUNT(*) as c FROM runs").get() as { c: number }).c
        const turnCount = (db.prepare("SELECT COUNT(*) as c FROM turns").get() as { c: number }).c
        const toolCallCount = (db.prepare("SELECT COUNT(*) as c FROM tool_calls").get() as { c: number }).c
        const providerRequestCount = (db.prepare("SELECT COUNT(*) as c FROM provider_requests").get() as { c: number }).c

        return {
          enabled: disabled.length < 2,
          disabledStores: disabled,
          dbPath: (db as any)._dbPath ?? "unknown",
          dbSizeBytes: 0,
          runCount,
          turnCount,
          toolCallCount,
          providerRequestCount
        }
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const TelemetryStatusRepositoryLive = (db: Database, getConfig: () => TelemetryConfig) =>
  Layer.succeed(TelemetryStatusRepository, makeTelemetryStatusRepository(db, getConfig))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/repositories/telemetry-status-repository.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/repositories/telemetry-status-repository.ts tests/telemetry/repositories/telemetry-status-repository.test.ts
git commit -m "feat: add TelemetryStatusRepository"
```

---

### Task 9: Create TelemetrySubscriber

**Files:**
- Create: `src/telemetry/subscriber.ts`
- Create: `tests/telemetry/subscriber.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/telemetry/subscriber.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit, Scope } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import { makeTurnRepository } from "../../src/telemetry/repositories/turn-repository.js"
import { makeToolCallRepository } from "../../src/telemetry/repositories/tool-call-repository.js"
import { makeProviderRequestRepository } from "../../src/telemetry/repositories/provider-request-repository.js"
import { TelemetrySubscriber } from "../../src/telemetry/subscriber.js"
import { EventBus, EventBusLive } from "../../src/events/bus.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-sub-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  migrate(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("TelemetrySubscriber", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("writes turn rows on TurnStarted + TurnEnd events", async () => {
    const turnRepo = makeTurnRepository(db)
    const tcRepo = makeToolCallRepository(db)
    const prRepo = makeProviderRequestRepository(db)
    const shouldWrite = () => true

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(TelemetrySubscriber({
            turn: turnRepo,
            toolCall: tcRepo,
            providerRequest: prRepo,
            shouldWrite
          }))
          yield* _(Effect.sleep("5 millis"))
          yield* _(bus.publish({
            _tag: "TurnStarted",
            runId: "run-1",
            stepId: "task-1",
            turnId: "turn-1",
            turnIndex: 0,
            timestamp: "2026-01-01T00:00:00Z"
          }))
          yield* _(bus.publish({
            _tag: "TurnEnd",
            runId: "run-1",
            stepId: "task-1",
            tokensIn: 100,
            tokensOut: 200
          }))
          yield* _(Effect.sleep("5 millis"))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    const row = db.prepare("SELECT * FROM turns WHERE id = ?").get("turn-1") as any
    expect(row).not.toBeNull()
    expect(row.turn_index).toBe(0)
    expect(row.stop_reason).toBe("end_turn")
    expect(row.tool_result_count).toBe(0)
  })

  it("writes tool_call row on ToolCall + ToolResult events", async () => {
    const turnRepo = makeTurnRepository(db)
    const tcRepo = makeToolCallRepository(db)
    const prRepo = makeProviderRequestRepository(db)
    const shouldWrite = () => true

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(TelemetrySubscriber({
            turn: turnRepo,
            toolCall: tcRepo,
            providerRequest: prRepo,
            shouldWrite
          }))
          yield* _(Effect.sleep("5 millis"))
          yield* _(bus.publish({
            _tag: "ToolCall",
            runId: "run-1",
            stepId: "task-1",
            tool: "bash",
            input: { command: "ls" }
          }))
          yield* _(bus.publish({
            _tag: "ToolResult",
            runId: "run-1",
            stepId: "task-1",
            tool: "bash",
            isError: false
          }))
          yield* _(Effect.sleep("5 millis"))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    const rows = db.prepare("SELECT * FROM tool_calls").all() as any[]
    expect(rows.length).toBe(1)
    expect(rows[0].tool_name).toBe("bash")
    expect(rows[0].completed_at).not.toBeNull()
  })

  it("honors shouldWrite = false (db disabled)", async () => {
    const turnRepo = makeTurnRepository(db)
    const tcRepo = makeToolCallRepository(db)
    const prRepo = makeProviderRequestRepository(db)
    const shouldWrite = () => false

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(TelemetrySubscriber({
            turn: turnRepo,
            toolCall: tcRepo,
            providerRequest: prRepo,
            shouldWrite
          }))
          yield* _(Effect.sleep("5 millis"))
          yield* _(bus.publish({
            _tag: "TurnStarted",
            runId: "run-1",
            stepId: "task-1",
            turnId: "turn-1",
            turnIndex: 0,
            timestamp: "now"
          }))
          yield* _(Effect.sleep("5 millis"))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    const rows = db.prepare("SELECT * FROM turns").all() as any[]
    expect(rows.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/telemetry/subscriber.test.ts
```

Expected: FAIL — module not found (needs TelemetrySubscriber).

- [ ] **Step 3: Implement `src/telemetry/subscriber.ts`**

```typescript
import { Effect, Scope } from "effect"
import { createSubscriber, EventBus } from "../events/bus.js"
import type { Event } from "../events/bus.js"
import type { TurnRepository } from "./repositories/turn-repository.js"
import type { ToolCallRepository } from "./repositories/tool-call-repository.js"
import type { ProviderRequestRepository } from "./repositories/provider-request-repository.js"
import { summarizeToolArgs, summarizeToolResult, summarizePayload } from "./summaries.js"

export interface TelemetryRepos {
  turn: TurnRepository
  toolCall: ToolCallRepository
  providerRequest: ProviderRequestRepository
  shouldWrite: () => boolean
}

export const TelemetrySubscriber = (repos: TelemetryRepos): Effect.Effect<void, never, Scope.Scope | EventBus> => {
  const currentTurns = new Map<string, string>()

  const turnKey = (runId: string, stepId: string) => runId + ":" + stepId

  const buildCallId = (runId: string, stepId: string, tool: string) =>
    runId + "-" + stepId + "-" + tool

  return createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      if (!repos.shouldWrite()) return Effect.void

      if (event._tag === "TurnStarted") {
        currentTurns.set(turnKey(event.runId, event.stepId), event.turnId)
        return repos.turn.insert({
          id: event.turnId,
          runId: event.runId,
          taskId: event.stepId,
          turnIndex: event.turnIndex,
          startedAt: event.timestamp
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "TurnEnd") {
        const turnId = currentTurns.get(turnKey(event.runId, event.stepId))
        if (!turnId) return Effect.void
        return repos.turn.finish(turnId, {
          stopReason: "end_turn",
          toolResultCount: 0,
          completedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "ToolCall" && event.isPartialUpdate) {
        const callId = buildCallId(event.runId, event.stepId, event.tool)
        return repos.toolCall.incrementPartialUpdates(callId).pipe(
          Effect.catchAll(() => Effect.void)
        )
      }

      if (event._tag === "ToolCall" && !event.isPartialUpdate) {
        const turnId = currentTurns.get(turnKey(event.runId, event.stepId))
        if (!turnId) return Effect.void
        const callId = buildCallId(event.runId, event.stepId, event.tool)
        const argsSummary = JSON.stringify(summarizeToolArgs(event.input))
        return repos.toolCall.insert({
          id: callId,
          runId: event.runId,
          taskId: event.stepId,
          turnId,
          toolName: event.tool,
          argsSummary,
          startedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "ToolResult") {
        const callId = buildCallId(event.runId, event.stepId, event.tool)
        const resultSummary = "{}"
        return repos.toolCall.finish(callId, {
          resultSummary,
          isError: event.isError,
          completedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      return Effect.void
    }
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/subscriber.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/subscriber.ts tests/telemetry/subscriber.test.ts
git commit -m "feat: add TelemetrySubscriber"
```

---

### Task 10: Create telemetry CLI command

**Files:**
- Create: `src/cli/commands/telemetry.ts`
- Create: `tests/cli/telemetry.test.ts`

- [ ] **Step 1: Write failing CLI test**

Create `tests/cli/telemetry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit, Console } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

describe("telemetry CLI", () => {
  let origHome: string | undefined
  let tmpDir: string

  beforeEach(() => {
    origHome = process.env.HOME
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-tcli-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton"), { recursive: true })
    import("../../src/db/migrations.js").then((m) => {
      const { Database } = require("bun:sqlite")
      const db = new Database(Path.join(tmpDir, ".hamilton", "hamilton.db"))
      m.migrate(db)
      db.close()
    })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("telemetry status command succeeds", async () => {
    const { telemetryStatus } = await import("../../src/cli/commands/telemetry.js")
    const exit = await Effect.runPromiseExit(telemetryStatus)
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("telemetry enable command succeeds", async () => {
    const { telemetryEnable } = await import("../../src/cli/commands/telemetry.js")
    const exit = await Effect.runPromiseExit(telemetryEnable)
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("disable file then enable file round-trips", async () => {
    const { telemetryDisable, telemetryEnable } = await import("../../src/cli/commands/telemetry.js")
    const { loadTelemetryConfig } = await import("../../src/telemetry/config.js")

    await Effect.runPromiseExit(telemetryDisable("file"))
    let cfg = await Effect.runPromise(loadTelemetryConfig)
    expect(cfg.disableStores.has("file")).toBe(true)

    await Effect.runPromiseExit(telemetryEnable("file"))
    cfg = await Effect.runPromise(loadTelemetryConfig)
    expect(cfg.disableStores.has("file")).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/cli/telemetry.test.ts
```

Expected: FAIL — module not found or test failures (implementation missing).

- [ ] **Step 3: Implement `src/cli/commands/telemetry.ts`**

```typescript
import { Command, Args, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { Database } from "bun:sqlite"
import { dbPath } from "../../paths.js"
import { migrate } from "../../db/migrations.js"
import { loadTelemetryConfig, saveTelemetryConfig } from "../../telemetry/config.js"
import { makeTelemetryStatusRepository } from "../../telemetry/repositories/telemetry-status-repository.js"
import { green, red, dim, bold } from "../formatting/colors.js"

function openTelemetryDb(): Effect.Effect<Database, Error> {
  return Effect.try({
    try: () => {
      const dp = dbPath()
      const db = new Database(dp)
      db.run("PRAGMA journal_mode = WAL")
      migrate(db)
      return db
    },
    catch: (e) => new Error("Failed to open telemetry DB: " + String(e))
  })
}

export const telemetryStatus: Effect.Effect<void, Error> = Effect.gen(function* (_) {
  const config = yield* _(loadTelemetryConfig)
  const db = yield* _(openTelemetryDb())
  const repo = makeTelemetryStatusRepository(db, () => config)
  const status = yield* _(repo.getStatus())

  db.close()

  if (status.enabled) {
    yield* Console.log(green("Telemetry: enabled"))
  } else {
    yield* Console.log(red("Telemetry: disabled (all stores)"))
  }

  const fileLabel = config.disableStores.has("file") ? red("file disabled") : green("file enabled")
  const dbLabel = config.disableStores.has("db") ? red("db disabled") : green("db enabled")
  yield* Console.log("  Stores: " + fileLabel + " | " + dbLabel)

  yield* Console.log("  DB: " + dim(dbPath()))

  yield* Console.log(
    "  Runs: " + bold(String(status.runCount)) +
    " | Turns: " + bold(String(status.turnCount)) +
    " | Tool calls: " + bold(String(status.toolCallCount)) +
    " | Provider requests: " + bold(String(status.providerRequestCount))
  )
})

export const telemetryEnable: (store?: string) => Effect.Effect<void, Error> = (store) =>
  Effect.gen(function* (_) {
    const config = yield* _(loadTelemetryConfig)
    if (!store) {
      config.disableStores.clear()
    } else if (store === "file" || store === "db") {
      config.disableStores.delete(store)
    }
    yield* _(saveTelemetryConfig(config))
    yield* Console.log(green("Telemetry store(s) enabled"))
  })

export const telemetryDisable: (store: "file" | "db") => Effect.Effect<void, Error> = (store) =>
  Effect.gen(function* (_) {
    const config = yield* _(loadTelemetryConfig)
    config.disableStores.add(store)
    yield* _(saveTelemetryConfig(config))
    yield* Console.log("Telemetry store " + red(store) + " disabled")
  })

const storeArg = Args.text({ name: "store" }).pipe(Args.optional)

const statusCommand = Command.make("status", {}, () => telemetryStatus)

const enableCommand = Command.make("enable", { store: storeArg }, ({ store }) =>
  telemetryEnable(store)
)

const disableCommand = Command.make("disable", { store: Args.text({ name: "store" }) }, ({ store }) =>
  telemetryDisable(store as "file" | "db")
)

export const telemetryCommand = Command.make("telemetry", {}, () =>
  Console.log("Hamilton telemetry — use a subcommand or --help")
).pipe(
  Command.withSubcommands([statusCommand, enableCommand, disableCommand])
)
```

- [ ] **Step 4: Run CLI tests to verify they pass**

```bash
bun --bun vitest run tests/cli/telemetry.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Run build to verify typings**

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/telemetry.ts tests/cli/telemetry.test.ts
git commit -m "feat: add hamilton telemetry status/enable/disable CLI"
```

---

### Task 11: Wire telemetry into runner, run command, init, and main.ts

**Files:**
- Modify: `src/workflow/runner.ts`
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Modify `src/workflow/runner.ts` — conditionally skip file ops**

In `src/workflow/runner.ts`, add the import at top (after line 26):
```typescript
import { loadTelemetryConfig } from "../telemetry/config.js"
```

In the `runWorkflow` function body, after `const runId = ctx.runId` (line 59), replace this block (lines 61-69):
```typescript
yield* _(createRunDir(runId))
yield* _(writeInput(runId, { ... }))
yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))
yield* _(appendEngineLog(runId, { ... }))
```

With:
```typescript
const telemetryConfig = yield* _(loadTelemetryConfig)
const fileEnabled = !telemetryConfig.disableStores.has("file")

if (fileEnabled) {
  yield* _(createRunDir(runId))
  yield* _(writeInput(runId, {
    spec,
    initialContext,
    executionContext: { cwd: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
  }))
}

yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))

if (fileEnabled) {
  yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.metadata.name }))
}
```

Then, in `executeSingleTask`, after `yield* _(ctx.transitionTask(instanceName, "complete"))` (line 189), change:
```typescript
yield* _(writeStepOutput(runId, taskId, output))
yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId: taskId }))
```
To:
```typescript
if (fileEnabled) {
  yield* _(writeStepOutput(runId, taskId, output))
}
yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId: taskId }))
```

Then, in the `body` function, after `yield* _(ctx.complete()...` (lines 259-261), change:
```typescript
const elapsedSeconds = ...
const summary = ...
yield* _(writeSummary(runId, summary))
yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
yield* _(appendEngineLog(runId, { ... }))
```
To:
```typescript
const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
const summary = { runId, status: workflowStatus, taskResults, context: runningContext, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }
if (fileEnabled) {
  yield* _(writeSummary(runId, summary))
}
yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
if (fileEnabled) {
  yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))
}
```

Also update the error handler (lines 276-283) to guard `writeSummary` and `appendEngineLog` with `fileEnabled`:
```typescript
Effect.catchAll((error) =>
  Effect.gen(function* () {
    yield* _(bus.publish({ _tag: "WorkflowCompleted", runId, message: String(error) }))
    if (fileEnabled) {
      yield* _(appendEngineLog(runId, { event: "workflow_failed", error: String(error) }))
    }
    yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
    if (fileEnabled) {
      yield* _(writeSummary(runId, { runId, status: "failed", taskResults, context: runningContext, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) }))
    }
    return { runId, status: "failed" as const, taskResults, context: runningContext, startedAt, completedAt }
  })
),
```

- [ ] **Step 2: Modify `src/cli/commands/run.ts` — wire TelemetrySubscriber and db toggle**

In `src/cli/commands/run.ts`, add these imports:
```typescript
import { TelemetrySubscriber } from "../../telemetry/subscriber.js"
import { makeTurnRepository } from "../../telemetry/repositories/turn-repository.js"
import { makeToolCallRepository } from "../../telemetry/repositories/tool-call-repository.js"
import { makeProviderRequestRepository } from "../../telemetry/repositories/provider-request-repository.js"
import { loadTelemetryConfig } from "../../telemetry/config.js"
import * as Path from "node:path"
import { dbPath } from "../../paths.js"

function openRunDb(): Database {
  const dp = dbPath()
  const db = new Database(dp)
  ;(db as any)._dbPath = dp
  return db
}
```

```typescript
import { Database } from "bun:sqlite"
```

In the `Effect.scoped` block of the run command, after `yield* FileLogger` / `yield* CliRenderer` (line 87), add:
```typescript
const config = await Effect.runPromise(loadTelemetryConfig)
const db = openRunDb()
const dbEnabled = !config.disableStores.has("db")
yield* _(TelemetrySubscriber({
  turn: makeTurnRepository(db),
  toolCall: makeToolCallRepository(db),
  providerRequest: makeProviderRequestRepository(db),
  shouldWrite: () => dbEnabled
}))
```

And add `import { Effect } from "effect"` at the top if not already (it already is).

Wait — the run command uses `Effect.gen(function* () { ... })` so we don't need `await Effect.runPromise`. Let me fix: change to yield* pattern.

```typescript
const config = yield* _(loadTelemetryConfig)
const db = openRunDb()
const dbEnabled = !config.disableStores.has("db")
yield* _(TelemetrySubscriber({
  turn: makeTurnRepository(db),
  toolCall: makeToolCallRepository(db),
  providerRequest: makeProviderRequestRepository(db),
  shouldWrite: () => dbEnabled
}))
```

Add `Effect.ensuring(Effect.sync(() => db.close()))` to close the DB when scope ends. The run command is already inside `Effect.scoped`, so wrap subscriber initialization:
```typescript
yield* _(Effect.addFinalizer(() => Effect.sync(() => db.close())))
yield* _(TelemetrySubscriber({ ... }))
```

- [ ] **Step 3: Modify `src/cli/commands/init.ts` — add telemetry to default settings**

In the `buildSettingsYaml` function (line 142), add the `telemetry` key to the YAML document before the `if (modelAliases...)` line. After `}` (line 177), add:
```typescript
;(doc.contents as any).telemetry = { disableStores: [] }
```

- [ ] **Step 4: Modify `src/cli/main.ts` — add telemetry subcommand**

Add the import:
```typescript
import { telemetryCommand } from "./commands/telemetry.js"
```

In the `rootCommand`, add `telemetryCommand` to the subcommands array (line 38):
```typescript
Command.withSubcommands([initCommand, doctorCommand, workflowCommand, mcpCommand, telemetryCommand])
```

- [ ] **Step 5: Run build to verify compilation**

```bash
bun run build
```

Expected: PASS. If errors, fix type issues.

- [ ] **Step 6: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All tests pass (existing + new). Fix any test failures.

- [ ] **Step 7: Commit**

```bash
git add src/workflow/runner.ts src/cli/commands/run.ts src/cli/commands/init.ts src/cli/main.ts
git commit -m "feat: wire telemetry toggle, subscriber, and CLI into runner"
```

---

### Task 12: Final verification

**Files:**
- Verify: All files from Tasks 1-11

- [ ] **Step 1: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All existing tests pass + all new tests pass. Check for regressions. If any existing test fails, debug and fix before proceeding.

- [ ] **Step 2: Run build**

```bash
bun run build
```

Expected: Zero type errors.

- [ ] **Step 3: Verify CLI smoke test**

```bash
bun run src/cli/main.ts telemetry status
```

Expected: Output shows telemetry is enabled with zero counts on a fresh DB. Errors or crashes indicate wiring issues.

```bash
bun run src/cli/main.ts telemetry disable file
bun run src/cli/main.ts telemetry status
bun run src/cli/main.ts telemetry enable
```

Expected: Each command succeeds, status reflects changes.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test: final verification and fixes for telemetry integration"
```

---
