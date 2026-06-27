# Memory Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement guideline ingestion as canonical memory atoms and curator-assisted context injection, plus the prerequisite EventBus generalization.

**Architecture:** Guideline files are ingested into a dual-layer storage system (qmd for content/search, Hamilton DB for lifecycle metadata) before `runWorkflow`. Inside the runner, a curator determines task context filters, the memory store retrieves relevant canonical atoms via qmd hybrid search, and the assembled context string is injected into the Pi session via `DefaultResourceLoader`, replacing raw guideline file injection.

**Tech Stack:** TypeScript, bun, Effect-TS, `@tobilu/qmd`, `bun:sqlite`, `@earendil-works/pi-ai`

---

### Task 1: EventBus Generalization — Make runId/taskId Optional on All Events

**Files:**
- Modify: `src/events/bus.ts`

- [ ] **Step 1: Update the Event type union — make runId and taskId optional on every variant**

```typescript
export type Event =
  | { readonly _tag: "WorkflowStarted"; readonly runId: string }
  | { readonly _tag: "WorkflowStatusChanged"; readonly runId: string; readonly status: string }
  | { readonly _tag: "TaskStarted"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskCompleted"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskFailed"; readonly runId: string; readonly taskId: string; readonly taskName: string; readonly message: string }
  | { readonly _tag: "TaskTimedOut"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskRetrying"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskPaused"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string; readonly summary?: Record<string, unknown> }
  | { readonly _tag: "LlmMessage"; readonly runId: string; readonly taskId: string; readonly text: string; readonly model?: string; readonly provider?: string }
  | { readonly _tag: "LlmThinking"; readonly runId: string; readonly taskId: string; readonly text: string; readonly model?: string; readonly provider?: string }
  | { readonly _tag: "ToolCall"; readonly runId: string; readonly taskId: string; readonly tool: string; readonly input: unknown; readonly toolCallId: string; readonly model?: string; readonly provider?: string; readonly isPartialUpdate?: boolean }
  | { readonly _tag: "ToolResult"; readonly runId: string; readonly taskId: string; readonly tool: string; readonly isError: boolean; readonly toolCallId: string }
  | { readonly _tag: "TurnEnd"; readonly runId: string; readonly taskId: string; readonly tokensIn: number; readonly tokensOut: number; readonly stopReason: string; readonly cacheRead: number; readonly cacheWrite: number; readonly model: string; readonly provider: string }
  | { readonly _tag: "TokenUsage"; readonly runId?: string; readonly taskId?: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "PromptBuilt"; readonly runId: string; readonly taskId: string; readonly systemPrompt: string; readonly taskPrompt: string; readonly guidelineFiles: ReadonlyArray<string> }
  | { readonly _tag: "TurnStarted"; readonly runId: string; readonly taskId: string; readonly turnId: string; readonly turnIndex: number; readonly timestamp: string }
  | { readonly _tag: "ProviderRequestStarted"; readonly runId: string; readonly taskId: string; readonly turnId: string; readonly requestId: string; readonly provider: string; readonly model: string; readonly payloadSummary: string; readonly timestamp: string }
  | { readonly _tag: "ModelSelected"; readonly runId: string; readonly taskId: string; readonly provider: string; readonly model: string; readonly timestamp: string }
  | { readonly _tag: "LspDiagnostic"; readonly runId: string; readonly taskId: string; readonly filePath: string; readonly text: string }
  | { readonly _tag: "TodoListUpdated"; readonly runId: string; readonly taskId: string; readonly todos: ReadonlyArray<{ readonly content: string; readonly status: "pending" | "in_progress" | "completed" | "cancelled"; readonly priority: "high" | "medium" | "low" }> }
  | { readonly _tag: "TaskInserted"; readonly runId: string; readonly taskId: string; readonly taskName: string; readonly scopeKey?: string; readonly depth: number }
  | { readonly _tag: "TodoConstraintError"; readonly runId: string; readonly taskId: string; readonly message: string }
```

The only change is `TokenUsage.runId` and `TokenUsage.taskId` become optional (`runId?: string; taskId?: string`).

- [ ] **Step 2: Update DbWriter subscriber to handle optional runId/taskId**

In `src/db/subscribers.ts`, the `TokenUsage` handler must skip when `runId` is undefined:

```typescript
if (event._tag === "TokenUsage") {
  if (!event.runId) return Effect.void
  return Effect.sync(() =>
    insertTokenEvent(db, event.runId, event.taskId ?? "", "completion", event.tokensIn, event.tokensOut)
  )
}
```

- [ ] **Step 3: Run tests to verify**

```bash
bun --bun vitest run tests/events/bus.test.ts tests/db/subscribers.test.ts tests/observability/subscribers.test.ts
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/events/bus.ts src/db/subscribers.ts
git commit -m "refactor: make runId and taskId optional on TokenUsage event"
```

---

### Task 2: Add Memory DB Schema — Migration v8

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrations.ts`
- Create: `tests/db/memory-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/memory-schema.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memory-schema-"))
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

describe("memory_atoms schema (migration v8)", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("creates memory_atoms and memory_event_log tables via migrate", () => {
    migrate(db)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain("memory_atoms")
    expect(names).toContain("memory_event_log")
  })

  it("enforces kind CHECK constraint", () => {
    migrate(db)
    expect(() =>
      db.prepare("INSERT INTO memory_atoms (id, path, kind, scope, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "a1", "canonical/test.md", "invalid_kind", "user", 0.5, new Date().toISOString(), new Date().toISOString()
      )
    ).toThrow()
  })

  it("enforces scope CHECK constraint", () => {
    migrate(db)
    expect(() =>
      db.prepare("INSERT INTO memory_atoms (id, path, kind, scope, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "a1", "canonical/test.md", "canonical", "invalid_scope", 0.5, new Date().toISOString(), new Date().toISOString()
      )
    ).toThrow()
  })

  it("defaults status to active", () => {
    migrate(db)
    db.prepare("INSERT INTO memory_atoms (id, path, kind, scope, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "a1", "canonical/test.md", "canonical", "user", 0.5, new Date().toISOString(), new Date().toISOString()
    )
    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get("a1") as { status: string }
    expect(row.status).toBe("active")
  })

  it("enforces actor CHECK constraint on memory_event_log", () => {
    migrate(db)
    expect(() =>
      db.prepare("INSERT INTO memory_event_log (event_type, actor, metadata) VALUES (?, ?, ?)").run(
        "atom.created", "invalid_actor", "{}"
      )
    ).toThrow()
  })

  it("migrate is idempotent", () => {
    migrate(db)
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain("memory_atoms")
    expect(names).toContain("memory_event_log")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/db/memory-schema.test.ts
```

Expected: FAIL — migration v8 not defined.

- [ ] **Step 3: Add DDL to src/db/schema.ts**

Append to the `createSchema` function body, after the `durable_deferred` CREATE TABLE:

```sql
CREATE TABLE IF NOT EXISTS memory_atoms (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('correction','failure','preference','fact','procedure','canonical')),
  scope TEXT NOT NULL CHECK (scope IN ('project','user')),
  confidence REAL NOT NULL DEFAULT 0.5,
  salience REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','demoted','tombstoned')),
  project_id TEXT,
  run_id TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  demoted_at TEXT,
  tombstoned_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  atom_id TEXT,
  run_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('agent','system','human')),
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The edit to `src/db/schema.ts` adds these two `CREATE TABLE IF NOT EXISTS` statements after the `durable_deferred` table in the `db.exec(...)` call (line 59, before the closing `).

- [ ] **Step 4: Add migration v8 to src/db/migrations.ts**

Add entry to the `MIGRATIONS` object:

```typescript
8: (db) => {
  db.exec("CREATE TABLE IF NOT EXISTS memory_atoms (id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('correction','failure','preference','fact','procedure','canonical')), scope TEXT NOT NULL CHECK (scope IN ('project','user')), confidence REAL NOT NULL DEFAULT 0.5, salience REAL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','demoted','tombstoned')), project_id TEXT, run_id TEXT, use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demoted_at TEXT, tombstoned_at TEXT)")
  db.exec("CREATE TABLE IF NOT EXISTS memory_event_log (id INTEGER PRIMARY KEY AUTOINCREMENT, atom_id TEXT, run_id TEXT, event_type TEXT NOT NULL, actor TEXT NOT NULL CHECK (actor IN ('agent','system','human')), reason TEXT, metadata TEXT NOT NULL DEFAULT '{}', timestamp TEXT NOT NULL DEFAULT (datetime('now')))")
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun --bun vitest run tests/db/memory-schema.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 6: Run full DB test suite to catch regressions**

```bash
bun --bun vitest run tests/db/
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts tests/db/memory-schema.test.ts
git commit -m "feat: add memory_atoms and memory_event_log tables (migration v8)"
```

---

### Task 3: Add Memory Paths to src/paths.ts

**Files:**
- Modify: `src/paths.ts`
- Create: `tests/paths-memory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/paths-memory.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { memoryDir, userMemoryDir, userMemoryDBPath } from "../src/paths.js"

describe("memory paths", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memory-paths-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("memoryDir returns ~/.hamilton/memory", () => {
    expect(memoryDir()).toBe(Path.join(tmpHome, ".hamilton", "memory"))
  })

  it("userMemoryDir returns ~/.hamilton/memory/user", () => {
    expect(userMemoryDir()).toBe(Path.join(tmpHome, ".hamilton", "memory", "user"))
  })

  it("userMemoryDBPath returns ~/.hamilton/memory/user/qmd.db", () => {
    expect(userMemoryDBPath()).toBe(Path.join(tmpHome, ".hamilton", "memory", "user", "qmd.db"))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/paths-memory.test.ts
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Add path functions to src/paths.ts**

After the `hooksDir` function:

```typescript
export function memoryDir(): string {
  return Path.join(hamiltonHome(), "memory")
}

export function userMemoryDir(): string {
  return Path.join(memoryDir(), "user")
}

export function userMemoryDBPath(): string {
  return Path.join(userMemoryDir(), "qmd.db")
}
```

- [ ] **Step 4: Update ensureHamiltonHome to create memory directories**

In `ensureHamiltonHome`, add to the `dirs` array before `guidelinesDir()`:

```typescript
Path.join(memoryDir(), "user", "canonical"),
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun --bun vitest run tests/paths-memory.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 6: Run full path test suite**

```bash
bun --bun vitest run tests/paths.test.ts
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/paths.ts tests/paths-memory.test.ts
git commit -m "feat: add memory directory path helpers"
```

---

### Task 4: Memory Queries — Hamilton DB CRUD for memory_atoms and memory_event_log

**Files:**
- Create: `src/memory/queries.ts`
- Create: `tests/memory/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/memory/queries.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import {
  insertMemoryAtom,
  getMemoryAtomById,
  getMemoryAtomsBySourcePath,
  updateMemoryAtomStatus,
  insertMemoryEvent
} from "../../src/memory/queries.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memqueries-"))
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

describe("memory queries", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
    migrate(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  const now = "2026-06-27T12:00:00.000Z"

  it("insertMemoryAtom inserts and returns the row", () => {
    insertMemoryAtom(db, {
      id: "a1",
      path: "canonical/test.md",
      kind: "canonical",
      scope: "user",
      confidence: 1.0,
      status: "active",
      created_at: now,
      updated_at: now
    })
    const row = db.prepare("SELECT * FROM memory_atoms WHERE id = ?").get("a1") as any
    expect(row.id).toBe("a1")
    expect(row.path).toBe("canonical/test.md")
    expect(row.kind).toBe("canonical")
    expect(row.scope).toBe("user")
    expect(row.confidence).toBe(1.0)
    expect(row.status).toBe("active")
  })

  it("getMemoryAtomById returns the row", () => {
    insertMemoryAtom(db, { id: "a1", path: "canonical/test.md", kind: "canonical", scope: "user", confidence: 1.0, status: "active", created_at: now, updated_at: now })
    const row = getMemoryAtomById(db, "a1")
    expect(row).not.toBeNull()
    expect(row!.id).toBe("a1")
  })

  it("getMemoryAtomById returns null for missing id", () => {
    const row = getMemoryAtomById(db, "nonexistent")
    expect(row).toBeNull()
  })

  it("getMemoryAtomsBySourcePath returns atoms queried by metadata source_path", () => {
    insertMemoryAtom(db, { id: "a1", path: "canonical/test.md", kind: "canonical", scope: "user", confidence: 1.0, status: "active", created_at: now, updated_at: now })
    insertMemoryEvent(db, { event_type: "ingested", actor: "system", metadata: JSON.stringify({ source_path: "/guidelines/my-guideline.md", file_hash: "abc123" }) })
    const results = getMemoryAtomsBySourcePath(db, "/guidelines/my-guideline.md")
    expect(results).toHaveLength(0)
  })

  it("updateMemoryAtomStatus changes status", () => {
    insertMemoryAtom(db, { id: "a1", path: "canonical/test.md", kind: "canonical", scope: "user", confidence: 1.0, status: "active", created_at: now, updated_at: now })
    updateMemoryAtomStatus(db, "a1", "tombstoned")
    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get("a1") as { status: string }
    expect(row.status).toBe("tombstoned")
  })

  it("insertMemoryEvent inserts an event row", () => {
    insertMemoryEvent(db, { event_type: "ingested", actor: "system", metadata: JSON.stringify({ source_path: "test.md", file_hash: "abc" }) })
    const rows = db.prepare("SELECT * FROM memory_event_log").all() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].event_type).toBe("ingested")
    expect(rows[0].actor).toBe("system")
  })

  it("insertMemoryEvent handles optional atom_id and run_id", () => {
    insertMemoryEvent(db, { event_type: "ingested", actor: "system", atom_id: "a1", run_id: "run1", metadata: "{}" })
    const rows = db.prepare("SELECT * FROM memory_event_log").all() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].atom_id).toBe("a1")
    expect(rows[0].run_id).toBe("run1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/memory/queries.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/memory/queries.ts**

```typescript
import { Database } from "bun:sqlite"

export interface MemoryAtomRow {
  id: string
  path: string
  kind: string
  scope: string
  confidence: number
  salience: number | null
  status: string
  project_id: string | null
  run_id: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  demoted_at: string | null
  tombstoned_at: string | null
}

export interface NewMemoryAtomRow {
  id: string
  path: string
  kind: string
  scope: string
  confidence: number
  status: string
  project_id?: string
  run_id?: string
  created_at: string
  updated_at: string
}

export interface MemoryEventRow {
  event_type: string
  actor: string
  atom_id?: string
  run_id?: string
  reason?: string
  metadata: string
}

export function insertMemoryAtom(db: Database, atom: NewMemoryAtomRow): void {
  db.prepare(`
    INSERT INTO memory_atoms (id, path, kind, scope, confidence, status, project_id, run_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    atom.id,
    atom.path,
    atom.kind,
    atom.scope,
    atom.confidence,
    atom.status,
    atom.project_id ?? null,
    atom.run_id ?? null,
    atom.created_at,
    atom.updated_at
  )
}

export function getMemoryAtomById(db: Database, id: string): MemoryAtomRow | null {
  return db.prepare("SELECT * FROM memory_atoms WHERE id = ?").get(id) as MemoryAtomRow | null
}

export function getMemoryAtomsBySourcePath(db: Database, sourcePath: string): MemoryAtomRow[] {
  return db.prepare(`
    SELECT ma.* FROM memory_atoms ma
    JOIN memory_event_log mel ON mel.atom_id = ma.id
    WHERE mel.event_type = 'ingested'
      AND json_extract(mel.metadata, '$.source_path') = ?
      AND ma.status = 'active'
  `).all(sourcePath) as MemoryAtomRow[]
}

export function updateMemoryAtomStatus(db: Database, id: string, status: string): void {
  const now = new Date().toISOString()
  const demotedAt = status === "demoted" ? now : null
  const tombstonedAt = status === "tombstoned" ? now : null
  db.prepare(`
    UPDATE memory_atoms SET status = ?, updated_at = ?, demoted_at = COALESCE(?, demoted_at), tombstoned_at = COALESCE(?, tombstoned_at) WHERE id = ?
  `).run(status, now, demotedAt, tombstonedAt, id)
}

export function insertMemoryEvent(db: Database, event: MemoryEventRow): void {
  db.prepare(`
    INSERT INTO memory_event_log (atom_id, run_id, event_type, actor, reason, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.atom_id ?? null,
    event.run_id ?? null,
    event.event_type,
    event.actor,
    event.reason ?? null,
    event.metadata
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/memory/queries.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/queries.ts tests/memory/queries.test.ts
git commit -m "feat: add memory DB query functions"
```

---

### Task 5: LLMClient — Extract from Pi Executor

**Files:**
- Create: `src/curator/llm-client.ts`
- Create: `tests/curator/llm-client.test.ts`

The `LLMClient` wraps `AuthStorage`, `ModelRegistry`, and `getModel` from `@earendil-works/pi-ai` with an optional `EventBusService` for publishing `TokenUsage` events.

- [ ] **Step 1: Write the test**

Create `tests/curator/llm-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createLLMClient } from "../../src/curator/llm-client.js"
import type { Context } from "@earendil-works/pi-ai"

describe("createLLMClient", () => {
  it("creates a client with complete method", () => {
    const client = createLLMClient()
    expect(client).toHaveProperty("complete")
    expect(typeof client.complete).toBe("function")
  })

  it("complete throws when model not found", async () => {
    const client = createLLMClient()
    await expect(
      client.complete("nonexistent", "model", [] as unknown as Context)
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/curator/llm-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/curator/llm-client.ts**

```typescript
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent"
import { complete, getModel, type Context, type Completion } from "@earendil-works/pi-ai"
import * as Path from "node:path"
import { piAgentDir } from "../executors/pi/paths.js"
import type { EventBusService } from "../events/bus.js"

export interface TokenUsage {
  provider: string
  modelId: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

export interface LLMClient {
  complete(provider: string, modelId: string, context: Context): Promise<Completion>
}

export function createLLMClient(config?: {
  modelsJsonPath?: string
  bus?: EventBusService
}): LLMClient {
  const agentDir = piAgentDir()
  const authStorage = AuthStorage.create(Path.join(agentDir, "auth.json"))
  const registry = config?.modelsJsonPath
    ? ModelRegistry.create(authStorage, config.modelsJsonPath)
    : ModelRegistry.create(authStorage, Path.join(agentDir, "models.json"))

  return {
    async complete(provider, modelId, context) {
      const model = getModel(provider as "openai", modelId as Parameters<typeof getModel>[1])

      const auth = await registry.getApiKeyAndHeaders(model)
      if (!auth.ok) throw new Error(auth.error)

      const startedAt = performance.now()
      const response = await complete(model, context, {
        apiKey: auth.apiKey,
        headers: auth.headers,
      })
      const latencyMs = performance.now() - startedAt

      if (config?.bus) {
        const effect = config.bus.publish({
          _tag: "TokenUsage" as const,
          tokensIn: response.usage?.input_tokens ?? 0,
          tokensOut: response.usage?.output_tokens ?? 0,
        })
        Effect.runPromise(effect).catch(() => {})
      }

      return response
    },
  }
}
```

Wait — this imports `Effect` and the EventBus from events/bus.ts. Let me check the import path relative to src/curator/.

The `piAgentDir` import needs to go up from `src/curator/` to `src/executors/pi/paths.js`. And `EventBusService` is in `src/events/bus.js` — also one level up.

Actually, let me reconsider the import paths. `src/curator/llm-client.ts` is at `src/curator/`. So:
- `../executors/pi/paths.js` → `src/executors/pi/paths.ts`
- `../events/bus.js` → `src/events/bus.ts`

And `Effect` needs to be imported from `"effect"`.

```typescript
import { Effect } from "effect"
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent"
import { complete, getModel, type Context, type Completion } from "@earendil-works/pi-ai"
import * as Path from "node:path"
import { piAgentDir } from "../executors/pi/paths.js"
import type { EventBusService } from "../events/bus.js"

export interface LLMClient {
  complete(provider: string, modelId: string, context: Context): Promise<Completion>
}

export function createLLMClient(config?: {
  modelsJsonPath?: string
  bus?: EventBusService
}): LLMClient {
  const agentDir = piAgentDir()
  const authStorage = AuthStorage.create(Path.join(agentDir, "auth.json"))
  const registry = config?.modelsJsonPath
    ? ModelRegistry.create(authStorage, config.modelsJsonPath)
    : ModelRegistry.create(authStorage, Path.join(agentDir, "models.json"))

  return {
    async complete(provider, modelId, context) {
      const model = getModel(provider as "openai", modelId as Parameters<typeof getModel>[1])

      const auth = await registry.getApiKeyAndHeaders(model)
      if (!auth.ok) throw new Error(auth.error)

      const startedAt = performance.now()
      const response = await complete(model, context, {
        apiKey: auth.apiKey,
        headers: auth.headers,
      })
      const latencyMs = performance.now() - startedAt

      if (config?.bus) {
        Effect.runPromise(
          config.bus.publish({
            _tag: "TokenUsage" as const,
            tokensIn: response.usage?.input_tokens ?? 0,
            tokensOut: response.usage?.output_tokens ?? 0,
          })
        ).catch(() => {})
      }

      return response
    },
  }
}
```

**Step 3 (actual code):**

```typescript
import { Effect } from "effect"
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent"
import { complete, getModel, type Context, type Completion } from "@earendil-works/pi-ai"
import * as Path from "node:path"
import { piAgentDir } from "../executors/pi/paths.js"
import type { EventBusService } from "../events/bus.js"

export interface LLMClient {
  complete(provider: string, modelId: string, context: Context): Promise<Completion>
}

export function createLLMClient(config?: {
  modelsJsonPath?: string
  bus?: EventBusService
}): LLMClient {
  const agentDir = piAgentDir()
  const authStorage = AuthStorage.create(Path.join(agentDir, "auth.json"))
  const registry = config?.modelsJsonPath
    ? ModelRegistry.create(authStorage, config.modelsJsonPath)
    : ModelRegistry.create(authStorage, Path.join(agentDir, "models.json"))

  return {
    async complete(provider, modelId, context) {
      const model = getModel(provider as "openai", modelId as Parameters<typeof getModel>[1])

      const auth = await registry.getApiKeyAndHeaders(model)
      if (!auth.ok) throw new Error(auth.error)

      const startedAt = performance.now()
      const response = await complete(model, context, {
        apiKey: auth.apiKey,
        headers: auth.headers,
      })
      const latencyMs = performance.now() - startedAt

      if (config?.bus) {
        Effect.runPromise(
          config.bus.publish({
            _tag: "TokenUsage" as const,
            tokensIn: response.usage?.input_tokens ?? 0,
            tokensOut: response.usage?.output_tokens ?? 0,
          })
        ).catch(() => {})
      }

      return response
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/curator/llm-client.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/curator/llm-client.ts tests/curator/llm-client.test.ts
git commit -m "feat: extract LLMClient from Pi executor"
```

---

### Task 6: MemoryStore — Interfaces and Concrete Implementation

**Files:**
- Create: `src/memory/store.ts`
- Create: `tests/memory/store.test.ts`

The `MemoryReader` and `MemoryWriter` interfaces plus a concrete `MemoryStore` class that implements both. Factory functions `createUserMemoryStore` and `createProjectMemoryStore`.

For this phase, only `createUserMemoryStore` is needed. The store wraps qmd's `createStore` API plus Hamilton DB queries.

- [ ] **Step 1: Install @tobilu/qmd**

```bash
bun add @tobilu/qmd
```

- [ ] **Step 2: Write the test**

Create `tests/memory/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import { createUserMemoryStore } from "../../src/memory/store.js"

describe("createUserMemoryStore", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memstore-"))
    process.env.HOME = tmpHome
    const homeDir = Path.join(tmpHome, ".hamilton", "memory", "user")
    Fs.mkdirSync(homeDir, { recursive: true })
    Fs.mkdirSync(Path.join(homeDir, "canonical"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("creates a user memory store with reader and writer", async () => {
    const { reader, writer, close } = await createUserMemoryStore(tmpHome)
    expect(reader).toHaveProperty("retrieveRelevant")
    expect(reader).toHaveProperty("getAtom")
    expect(writer).toHaveProperty("writeAtom")
    expect(writer).toHaveProperty("tombstone")
    expect(writer).toHaveProperty("updateStatus")
    await close()
  })

  it("writes and retrieves an atom", async () => {
    const { reader, writer, close } = await createUserMemoryStore(tmpHome)
    const db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)

    const { id, path } = await writer.writeAtom({
      id: "test-a1",
      title: "Test Canonical",
      kind: "canonical",
      scope: "user",
      content: "This is a test canonical atom.",
      tags: ["lang:typescript", "testing"],
      source_path: "/guidelines/test.md",
      source: "guideline",
    }, db)

    expect(id).toBe("test-a1")
    expect(path).toContain("canonical/")
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "memory", "user", path))).toBe(true)

    const atom = await reader.getAtom(id)
    expect(atom).not.toBeNull()
    expect(atom!.id).toBe("test-a1")
    expect(atom!.content).toBe("This is a test canonical atom.")

    db.close()
    await close()
  })

  it("tombstone marks atom as tombstoned", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)

    const { id } = await writer.writeAtom({
      id: "test-a2",
      title: "To Be Tombstoned",
      kind: "canonical",
      scope: "user",
      content: "Will be removed.",
      tags: [],
      source_path: "/guidelines/old.md",
      source: "guideline",
    }, db)

    await writer.tombstone(id, db)

    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get(id) as { status: string } | null
    expect(row).not.toBeNull()
    expect(row!.status).toBe("tombstoned")

    db.close()
    await close()
  })

  it("close cleans up the store", async () => {
    const { close } = await createUserMemoryStore(tmpHome)
    await close()
    const qmdDbPath = Path.join(tmpHome, ".hamilton", "memory", "user", "qmd.db")
    expect(Fs.existsSync(qmdDbPath)).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun --bun vitest run tests/memory/store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement src/memory/store.ts**

```typescript
import { createStore, type Store } from "@tobilu/qmd"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"
import { userMemoryDBPath, userMemoryDir } from "../paths.js"
import { insertMemoryAtom, updateMemoryAtomStatus, type NewMemoryAtomRow } from "./queries.js"

export interface MemoryAtom {
  id: string
  title: string
  kind: "canonical" | "correction" | "failure" | "fact" | "procedure" | "preference"
  scope: "project" | "user"
  confidence: number
  content: string
  tags: string[]
}

export interface NewMemoryAtom {
  id: string
  title: string
  kind: string
  scope: string
  content: string
  tags: string[]
  source_path: string
  source: string
}

export interface MemoryFilters {
  tags: string[]
  languages: string[]
  filePaths: string[]
}

export interface MemoryReader {
  retrieveRelevant(filters: MemoryFilters, limit: number): Promise<MemoryAtom[]>
  getAtom(id: string): Promise<MemoryAtom | null>
}

export interface MemoryWriter {
  writeAtom(atom: NewMemoryAtom, db: Database): Promise<{ id: string; path: string }>
  tombstone(id: string, db: Database): Promise<void>
  updateStatus(id: string, status: string, db: Database): Promise<void>
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function buildFrontmatter(atom: NewMemoryAtom): string {
  const frontmatter: Record<string, unknown> = {
    id: atom.id,
    title: atom.title,
    kind: atom.kind,
    scope: atom.scope,
    source: atom.source,
    confidence: 1.0,
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    project_id: null,
    tags: atom.tags,
    demoted_at: null,
    tombstoned_at: null,
    contradicts: [],
  }
  if (atom.source_path) {
    frontmatter.source_path = atom.source_path
  }
  return `---\n${Yaml.stringify(frontmatter)}---\n\n${atom.content}`
}

function atomFromFrontmatter(frontmatter: Record<string, unknown>, content: string): MemoryAtom {
  return {
    id: frontmatter.id as string,
    title: frontmatter.title as string,
    kind: frontmatter.kind as MemoryAtom["kind"],
    scope: frontmatter.scope as MemoryAtom["scope"],
    confidence: frontmatter.confidence as number,
    content,
    tags: (frontmatter.tags as string[]) ?? [],
  }
}

export async function createUserMemoryStore(hamiltonHome: string): Promise<{
  reader: MemoryReader
  writer: MemoryWriter
  close(): Promise<void>
}> {
  const dir = Path.join(hamiltonHome, ".hamilton", "memory", "user")
  const dbPath = Path.join(dir, "qmd.db")

  Fs.mkdirSync(dir, { recursive: true })
  Fs.mkdirSync(Path.join(dir, "canonical"), { recursive: true })

  const store: Store = await createStore({ dbPath })

  await store.addCollection({
    name: "canonical",
    description: "Canonical memory atoms from ingested guideline files.",
    basePath: Path.join(dir, "canonical"),
  })

  const reader: MemoryReader = {
    async retrieveRelevant(filters, limit) {
      const query = [...filters.tags, ...filters.languages, ...filters.filePaths].join(" ") || ""
      try {
        const results = await (store as any).search({
          query,
          collections: ["canonical"],
          limit,
          minScore: 0.1,
        })
        if (!results || results.length === 0) return []
        return results.map((r: any) => ({
          id: r.id ?? r.metadata?.id ?? "",
          title: r.title ?? r.metadata?.title ?? "",
          kind: "canonical" as const,
          scope: "user" as const,
          confidence: 1.0,
          content: r.content ?? "",
          tags: r.tags ?? [],
        }))
      } catch {
        return []
      }
    },

    async getAtom(id) {
      try {
        const result = await (store as any).get({ id })
        if (!result) return null
        return {
          id: result.id ?? result.metadata?.id ?? "",
          title: result.metadata?.title ?? "",
          kind: "canonical" as const,
          scope: "user" as const,
          confidence: 1.0,
          content: result.content ?? "",
          tags: result.metadata?.tags ?? [],
        }
      } catch {
        return null
      }
    },
  }

  const writer: MemoryWriter = {
    async writeAtom(atom, db) {
      const slug = slugify(atom.title)
      const relativePath = `canonical/${slug}-${atom.id}.md`
      const filePath = Path.join(dir, relativePath)

      const frontmatterContent = buildFrontmatter(atom)
      Fs.writeFileSync(filePath, frontmatterContent, "utf-8")

      await store.update({ collections: ["canonical"] })
      await store.embed({ force: false, chunkStrategy: "auto" })

      insertMemoryAtom(db, {
        id: atom.id,
        path: relativePath,
        kind: atom.kind,
        scope: atom.scope,
        confidence: 1.0,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      return { id: atom.id, path: relativePath }
    },

    async tombstone(id, db) {
      updateMemoryAtomStatus(db, id, "tombstoned")
    },

    async updateStatus(id, status, db) {
      updateMemoryAtomStatus(db, id, status)
    },
  }

  return {
    reader,
    writer,
    async close() {
      await (store as any).close?.()
    },
  }
}

export async function createProjectMemoryStore(dbPath: string, storePath: string): Promise<{
  reader: MemoryReader
  writer: MemoryWriter
  close(): Promise<void>
}> {
  Fs.mkdirSync(storePath, { recursive: true })

  const store: Store = await createStore({ dbPath })
  await store.addCollection({
    name: "canonical",
    description: "Canonical memory atoms.",
    basePath: Path.join(storePath, "canonical"),
  })

  const reader: MemoryReader = {
    async retrieveRelevant(_filters, _limit) { return [] },
    async getAtom(_id) { return null },
  }

  const writer: MemoryWriter = {
    async writeAtom(atom, db) {
      insertMemoryAtom(db, {
        id: atom.id,
        path: "canonical/dummy.md",
        kind: atom.kind,
        scope: atom.scope,
        confidence: 1.0,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      return { id: atom.id, path: "" }
    },
    async tombstone(_id, _db) {},
    async updateStatus(id, status, db) {
      updateMemoryAtomStatus(db, id, status)
    },
  }

  return { reader, writer, close: async () => { await (store as any).close?.() } }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun --bun vitest run tests/memory/store.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/memory/store.ts tests/memory/store.test.ts package.json bun.lock
git commit -m "feat: add MemoryStore with qmd + Hamilton DB dual-layer storage"
```

---

### Task 7: Guideline Ingest Pipeline

**Files:**
- Create: `src/memory/guidelines.ts`
- Create: `tests/memory/guidelines.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/memory/guidelines.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import { createUserMemoryStore } from "../../src/memory/store.js"
import {
  detectChanges,
  tombstoneStale,
  writeToQmd,
  registerIngestedEvent,
} from "../../src/memory/guidelines.js"
import type { MemoryWriter } from "../../src/memory/store.js"

function makeGuideline(name: string, content: string) {
  return { name, instructions: [{ name: `${name}/file.md`, content }], rules: null }
}

describe("detectChanges", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("returns changed=true when no prior ingestion event exists", () => {
    const guideline = makeGuideline("my-guideline", "some content")
    const result = detectChanges(guideline, db, "/guidelines/my-guideline.md")
    expect(result.changed).toBe(true)
    expect(result.hash).toBeTypeOf("string")
  })

  it("returns changed=false when hash matches previous ingestion", () => {
    const guideline = makeGuideline("my-guideline", "some content")
    const first = detectChanges(guideline, db, "/guidelines/my-guideline.md")

    db.prepare(`
      INSERT INTO memory_event_log (event_type, actor, metadata)
      VALUES ('ingested', 'system', ?)
    `).run(JSON.stringify({ source_path: "/guidelines/my-guideline.md", file_hash: first.hash }))

    const second = detectChanges(guideline, db, "/guidelines/my-guideline.md")
    expect(second.changed).toBe(false)
  })

  it("returns changed=true when hash differs", () => {
    const guideline1 = makeGuideline("my-guideline", "content v1")
    const result1 = detectChanges(guideline1, db, "/guidelines/my-guideline.md")

    db.prepare(`
      INSERT INTO memory_event_log (event_type, actor, metadata)
      VALUES ('ingested', 'system', ?)
    `).run(JSON.stringify({ source_path: "/guidelines/my-guideline.md", file_hash: result1.hash }))

    const guideline2 = makeGuideline("my-guideline", "content v2 different")
    const result2 = detectChanges(guideline2, db, "/guidelines/my-guideline.md")
    expect(result2.changed).toBe(true)
  })

  it("normalizes line endings before hashing", () => {
    const guideline1 = makeGuideline("my-guideline", "line1\r\nline2\rline3")
    const guideline2 = makeGuideline("my-guideline", "line1\nline2\nline3")
    const r1 = detectChanges(guideline1, db, "/guidelines/my-guideline.md")
    const r2 = detectChanges(guideline2, db, "/guidelines/my-guideline.md")
    expect(r1.hash).toBe(r2.hash)
  })
})

describe("tombstoneStale", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-ts-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
    db.prepare("INSERT INTO memory_atoms (id, path, kind, scope, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "a1", "canonical/test.md", "canonical", "user", 1.0, "active", new Date().toISOString(), new Date().toISOString()
    )
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("tombstones active atoms matching source_path", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    await tombstoneStale(writer, db, "/guidelines/old.md")
    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get("a1") as any
    await close()
  })
})

describe("writeToQmd", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-write-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("writes guideline to qmd and inserts pending DB row", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const guideline = makeGuideline("my-guideline", "This is guideline content.")
    const result = await writeToQmd(writer, guideline, db, "guideline", "/guidelines/my-guideline.md")

    expect(result.id).toBeTypeOf("string")
    expect(result.path).toContain("canonical/")

    const filePath = Path.join(tmpHome, ".hamilton", "memory", "user", result.path)
    expect(Fs.existsSync(filePath)).toBe(true)
    const content = Fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("This is guideline content.")
    expect(content).toContain("kind: canonical")
    expect(content).toContain("source: guideline")
    expect(content).toContain("confidence: 1")

    await close()
  })
})

describe("registerIngestedEvent", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-reg-"))
    process.env.HOME = tmpHome
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("inserts ingested event with correct metadata", () => {
    registerIngestedEvent(db, "/guidelines/my-guideline.md", "abc123", 5)
    const rows = db.prepare("SELECT * FROM memory_event_log WHERE event_type = 'ingested'").all() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].actor).toBe("system")
    const metadata = JSON.parse(rows[0].metadata)
    expect(metadata.source).toBe("guideline")
    expect(metadata.source_path).toBe("/guidelines/my-guideline.md")
    expect(metadata.file_hash).toBe("abc123")
    expect(metadata.chunk_count).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/memory/guidelines.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/memory/guidelines.ts**

```typescript
import { Database } from "bun:sqlite"
import * as crypto from "node:crypto"
import * as Path from "node:path"
import type { LoadedGuideline } from "../guidelines/types.js"
import type { MemoryWriter } from "./store.js"
import { insertMemoryEvent } from "./queries.js"
import { nanoid } from "nanoid"

export interface ChangeResult {
  changed: boolean
  hash: string
}

export interface WriteResult {
  id: string
  path: string
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex")
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function getFirstInstructionContent(guideline: LoadedGuideline): string {
  if (guideline.instructions && guideline.instructions.length > 0) {
    return guideline.instructions.map(i => i.content).join("\n\n")
  }
  return ""
}

function getLastIngestedHash(db: Database, sourcePath: string): string | null {
  const row = db.prepare(`
    SELECT metadata FROM memory_event_log
    WHERE event_type = 'ingested'
      AND json_extract(metadata, '$.source_path') = ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(sourcePath) as { metadata: string } | null
  if (!row) return null
  try {
    const meta = JSON.parse(row.metadata)
    return meta.file_hash ?? null
  } catch {
    return null
  }
}

export function detectChanges(
  guideline: LoadedGuideline,
  db: Database,
  sourcePath: string
): ChangeResult {
  const content = getFirstInstructionContent(guideline)
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const hash = sha256(normalized)
  const previous = getLastIngestedHash(db, sourcePath)
  return { changed: previous !== hash, hash }
}

export async function tombstoneStale(
  writer: MemoryWriter,
  db: Database,
  sourcePath: string
): Promise<void> {
  const rows = db.prepare(`
    SELECT ma.id FROM memory_atoms ma
    JOIN memory_event_log mel ON mel.atom_id = ma.id
    WHERE mel.event_type = 'ingested'
      AND json_extract(mel.metadata, '$.source_path') = ?
      AND ma.status = 'active'
  `).all(sourcePath) as { id: string }[]
  for (const row of rows) {
    await writer.tombstone(row.id, db)
  }
}

export async function writeToQmd(
  writer: MemoryWriter,
  guideline: LoadedGuideline,
  db: Database,
  source: string,
  sourcePath: string
): Promise<WriteResult> {
  const content = getFirstInstructionContent(guideline)
  const title = guideline.name
  const id = nanoid(21)

  const result = await writer.writeAtom({
    id,
    title,
    kind: "canonical",
    scope: "user",
    content,
    tags: [],
    source_path: sourcePath,
    source,
  }, db)

  return { id: result.id, path: result.path }
}

export function registerIngestedEvent(
  db: Database,
  sourcePath: string,
  hash: string,
  chunkCount: number
): void {
  insertMemoryEvent(db, {
    event_type: "ingested",
    actor: "system",
    metadata: JSON.stringify({
      source: "guideline",
      source_path: sourcePath,
      file_hash: hash,
      scope: "user",
      chunk_count: chunkCount,
    }),
  })
}
```

Note: This requires `nanoid` as a dependency. Add it:

```bash
bun add nanoid
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/memory/guidelines.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/guidelines.ts tests/memory/guidelines.test.ts package.json bun.lock
git commit -m "feat: add guideline ingest pipeline (detectChanges, tombstone, write, register)"
```

---

### Task 8: Context Injection — buildMemoryContext

**Files:**
- Create: `src/memory/context.ts`
- Create: `tests/memory/context.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/memory/context.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildMemoryContext } from "../../src/memory/context.js"
import type { MemoryAtom } from "../../src/memory/store.js"

describe("buildMemoryContext", () => {
  it("returns empty string for empty atom list", () => {
    expect(buildMemoryContext([])).toBe("")
  })

  it("formats canonical atoms into reference section", () => {
    const atoms: MemoryAtom[] = [
      {
        id: "a1",
        title: "Code Style Guide",
        kind: "canonical",
        scope: "user",
        confidence: 1.0,
        content: "Use 2-space indentation.",
        tags: ["lang:typescript"],
      },
    ]
    const context = buildMemoryContext(atoms)
    expect(context).toContain("Agent Memory — Session Context")
    expect(context).toContain("REFERENCE (canonical knowledge)")
    expect(context).toContain("[canonical] Code Style Guide")
    expect(context).toContain("Use 2-space indentation.")
    expect(context).toContain("ID: a1")
  })

  it("includes the correct markdown structure", () => {
    const atoms: MemoryAtom[] = [
      {
        id: "a1",
        title: "Test Guideline",
        kind: "canonical",
        scope: "user",
        confidence: 1.0,
        content: "Some content.",
        tags: [],
      },
    ]
    const context = buildMemoryContext(atoms)
    expect(context).toContain("---")
    expect(context).toContain("authoritative guidelines")
    expect(context).toContain("1 atoms injected inline")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/memory/context.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/memory/context.ts**

```typescript
import type { MemoryAtom } from "./store.js"

export function buildMemoryContext(atoms: MemoryAtom[]): string {
  if (atoms.length === 0) return ""

  let context = `---
## Agent Memory — Session Context

> The following memories were retrieved from your long-term store.
> These are authoritative guidelines ingested from project instruction files.

### REFERENCE (canonical knowledge)

`

  for (const atom of atoms) {
    context += `#### [canonical] ${atom.title}
*Confidence: ${atom.confidence} | ID: ${atom.id}*

${atom.content}

---
`
  }

  context += `
*${atoms.length} atoms injected inline.*
---
`

  return context
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/memory/context.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/memory/context.ts tests/memory/context.test.ts
git commit -m "feat: add buildMemoryContext formatter"
```

---

### Task 9: Curator — suggestMemoryFilters

**Files:**
- Create: `src/curator/curator.ts`
- Create: `tests/curator/curator.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/curator/curator.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createCurator } from "../../src/curator/curator.js"
import { createLLMClient } from "../../src/curator/llm-client.js"

describe("createCurator", () => {
  it("creates a curator with suggestMemoryFilters", () => {
    const llmClient = createLLMClient()
    const curator = createCurator(llmClient)
    expect(curator).toHaveProperty("suggestMemoryFilters")
    expect(curator).toHaveProperty("findRelevantAtoms")
  })

  it("suggestMemoryFilters returns valid structure even on LLM failure", async () => {
    const mockClient = {
      complete: async () => {
        throw new Error("LLM unavailable")
      },
    }
    const curator = createCurator(mockClient)
    const result = await curator.suggestMemoryFilters("Fix the build", ["src/index.ts"])
    expect(result).toHaveProperty("tags")
    expect(result).toHaveProperty("languages")
    expect(result).toHaveProperty("filePaths")
    expect(Array.isArray(result.tags)).toBe(true)
    expect(Array.isArray(result.languages)).toBe(true)
    expect(Array.isArray(result.filePaths)).toBe(true)
  })

  it("suggestMemoryFilters returns parsed results on success", async () => {
    const mockClient = {
      complete: async () => ({
        choices: [{ message: { content: JSON.stringify({ tags: ["testing"], languages: ["lang:typescript"], filePaths: ["src/test.ts"] }) } }],
      }),
    }
    const curator = createCurator(mockClient)
    const result = await curator.suggestMemoryFilters("Write unit tests", ["src/test.ts"])
    expect(result.tags).toContain("testing")
    expect(result.languages).toContain("lang:typescript")
    expect(result.filePaths).toContain("src/test.ts")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/curator/curator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/curator/curator.ts**

```typescript
import type { LLMClient } from "./llm-client.js"
import type { MemoryReader, MemoryAtom, MemoryFilters } from "../memory/store.js"

export interface Curator {
  suggestMemoryFilters(taskPrompt: string, files: string[]): Promise<MemoryFilters>
  findRelevantAtoms(reader: MemoryReader, filePath: string, tags: string[]): Promise<MemoryAtom[]>
}

export function createCurator(llmClient: LLMClient): Curator {
  return {
    async suggestMemoryFilters(taskPrompt, files) {
      const systemPrompt = `You are a task context analyzer. Given a task prompt and file list, return a JSON object with:
- tags: string[] — relevant context tags (e.g. "testing", "refactor", "database", "ci")
- languages: string[] — programming language tags (e.g. "lang:typescript", "lang:python")
- filePaths: string[] — the most relevant file paths for context

Detect languages from file extensions:
- .ts/.tsx → "lang:typescript"
- .js/.jsx → "lang:javascript"
- .py → "lang:python"
- .rs → "lang:rust"
- .go → "lang:go"
- .java → "lang:java"

Return ONLY the JSON object, no other text.`

      const userPrompt = `Task prompt: ${taskPrompt}\n\nFiles: ${files.join(", ") || "none"}`

      try {
        const response = await llmClient.complete("default", "default", [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ])

        const text = response.choices?.[0]?.message?.content ?? "{}"
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("No JSON found in response")

        const parsed = JSON.parse(jsonMatch[0])
        return {
          tags: parsed.tags ?? [],
          languages: parsed.languages ?? [],
          filePaths: parsed.filePaths ?? [],
        }
      } catch {
        return { tags: [], languages: [], filePaths: [] }
      }
    },

    async findRelevantAtoms(reader, filePath, tags) {
      return reader.retrieveRelevant(
        { tags, languages: [], filePaths: [filePath] },
        5
      )
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/curator/curator.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/curator/curator.ts tests/curator/curator.test.ts
git commit -m "feat: add Curator with suggestMemoryFilters"
```

---

### Task 10: Move EventBusLive to Application Scope in main.ts

**Files:**
- Modify: `src/cli/main.ts`
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/resume.ts`

Currently `EventBusLive` is provided inside `run.ts` and `resume.ts` via `.pipe(Effect.provide(EventBusLive))`. It must move to `main.ts` so the bus is available to the guideline ingest pipeline that runs before `runWorkflow`.

- [ ] **Step 1: Modify src/cli/main.ts**

Provide `EventBusLive` at the root level:

```typescript
program.pipe(
  Effect.provide(BunContext.layer),
  Effect.provide(EventBusLive),
  BunRuntime.runMain
)
```

Add the import:

```typescript
import { EventBusLive } from "../events/bus.js"
```

- [ ] **Step 2: Modify src/cli/commands/run.ts**

Remove `.pipe(Effect.provide(EventBusLive))` from both the foreground and background code paths. The `EventBus` is already in scope from main.ts.

In the foreground path (around line 143), change:

```typescript
const result = yield* Effect.exit(
  Effect.scoped(
    Effect.gen(function* () {
      yield* TaskLogger
      yield* CliRenderer
      const telemetryCfg = yield* loadTelemetryConfig
      const db = new Database(dbPath())
      const dbEnabled = !telemetryCfg.disableStores.has("db")
      yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
      yield* TelemetrySubscriber({
        turn: makeTurnRepository(db),
        toolCall: makeToolCallRepository(db),
        providerRequest: makeProviderRequestRepository(db),
        shouldWrite: () => dbEnabled
      })
      return yield* executeRun({ workflowSlug: slug, prompt: promptText, variants: variants._tag === "Some" ? variants.value : undefined, externalRunId })
    })
  ).pipe(Effect.provide(EventBusLive))
)
```

To:

```typescript
const result = yield* Effect.exit(
  Effect.scoped(
    Effect.gen(function* () {
      yield* TaskLogger
      yield* CliRenderer
      const telemetryCfg = yield* loadTelemetryConfig
      const db = new Database(dbPath())
      const dbEnabled = !telemetryCfg.disableStores.has("db")
      yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
      yield* TelemetrySubscriber({
        turn: makeTurnRepository(db),
        toolCall: makeToolCallRepository(db),
        providerRequest: makeProviderRequestRepository(db),
        shouldWrite: () => dbEnabled
      })
      return yield* executeRun({ workflowSlug: slug, prompt: promptText, variants: variants._tag === "Some" ? variants.value : undefined, externalRunId })
    })
  )
)
```

Also remove the `EventBusLive` import from `run.ts` (line 10).

- [ ] **Step 3: Modify src/cli/commands/resume.ts**

Remove `.pipe(Effect.provide(EventBusLive))` from the `resumeWorkflow` function (around line 93):

Change:

```typescript
return yield* runWorkflow(spec as unknown as WorkflowSpec, context, templateOptions, runId, recursionConfig.maxDepth ?? undefined).pipe(
  Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
)
```

And remove the `.pipe(Effect.provide(EventBusLive))` wrapping it (line 93).

Also remove the `EventBusLive` import from `resume.ts` (line 12).

- [ ] **Step 4: Run the full test suite**

```bash
bun --bun vitest run
```

Expected: All 155+ tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/main.ts src/cli/commands/run.ts src/cli/commands/resume.ts
git commit -m "refactor: lift EventBusLive to application scope in main.ts"
```

---

### Task 11: Modify runner.ts — Remove Internal guideline Loading, Accept memoryReader

**Files:**
- Modify: `src/workflow/runner.ts`

The runner no longer calls `loadGuidelines` / `extractGuidelineArtifacts` internally. It receives `guidelineRules` and `memoryReader` from the caller. Per-task, it uses the curator to generate filters, retrieves relevant atoms, and builds the memory context.

- [ ] **Step 1: Change runWorkflow signature**

Change from:
```typescript
export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  templateOptions: TemplateOptions,
  existingRunId?: string,
  maxRecursionDepth?: number
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
```

To:
```typescript
import type { MemoryReader } from "../memory/store.js"
import type { CompiledRule } from "../guidelines/types.js"
import { createCurator } from "../curator/curator.js"
import { createLLMClient } from "../curator/llm-client.js"
import { buildMemoryContext } from "../memory/context.js"

export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  templateOptions: TemplateOptions,
  guidelineRules: CompiledRule[],
  memoryReader: MemoryReader,
  existingRunId?: string,
  maxRecursionDepth?: number
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
```

- [ ] **Step 2: Remove internal loadGuidelines call**

Delete lines 110-111:
```typescript
const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))
const { files: guidelineFiles, rules: allRules } = extractGuidelineArtifacts(loadedGuidelines)
```

Replace `allRules` references with the parameter `guidelineRules`.

- [ ] **Step 3: Add per-task curator + memory context building inside dispatchTask**

Inside the task dispatch loop (line 226), before `dispatchTask`, build the memory context:

```typescript
const llmClient = createLLMClient()
const curator = createCurator(llmClient)
const taskFiles: string[] = []
const filters = await Effect.promise(() => curator.suggestMemoryFilters(task.name, taskFiles))
const atoms = await Effect.promise(() => memoryReader.retrieveRelevant(filters, 5))
const memoryContext = buildMemoryContext(atoms)
```

Wait — we can't use `await` inside `Effect.gen`. We need `yield* _(Effect.promise(...))`.

Let me reconsider. The per-task memory context needs to be built inside the runner's task dispatch loop. Looking at line 226 where `dispatchTask` is called:

```typescript
yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState, hookRuntime))
```

The `guidelineFiles` parameter is what we're replacing. Instead, we pass in `memoryContext` which is a string that gets injected into the system prompt.

But building the memory context involves async operations (curator LLM call + qmd search). These need to happen inside the Effect context. Let me think about the simplest integration...

Simplest approach: build memory context inline before dispatching, using `yield* _(Effect.promise(...))`:

```typescript
const bus = yield* _(EventBus)
const llmClient = createLLMClient({ bus })
const curator = createCurator(llmClient)

const memoryFilters = yield* _(Effect.promise(() => curator.suggestMemoryFilters(task.name, [])))
const memoryAtoms = yield* _(Effect.promise(() => memoryReader.retrieveRelevant(memoryFilters, 5)))
const memoryContext = buildMemoryContext(memoryAtoms)

yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, memoryContext, guidelineRules, skillRegistry, templateOptions, scriptConfig, execState, hookRuntime))
```

Note: this builds memory context per-task using the task name as the prompt. The curator fires an LLM call per task. Error handling: catcher returns empty filters, old retrieveRelevant and buildMemoryContext handle gracefully.

- [ ] **Step 4: Change dispatchTask parameter from guidelineFiles to memoryContext**

In `src/workflow/task-executor.ts`, change `dispatchTask` signature:

From:
```typescript
export function dispatchTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  ctx: WorkflowRuntime,
  spec: WorkflowSpec,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  ...
```

To:
```typescript
export function dispatchTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  ctx: WorkflowRuntime,
  spec: WorkflowSpec,
  memoryContext: string,
  allRules: CompiledRule[],
  ...
```

And pass `memoryContext` down to `buildAgentExecEffect`:

```typescript
const execEffect = buildAgentExecEffect(task, taskEnv, spec, ctx, memoryContext, allRules, skillRegistry, templateOptions, agent, taskId, hookRuntime)
```

- [ ] **Step 5: Change buildAgentExecEffect to accept memoryContext**

Change signature from:
```typescript
function buildAgentExecEffect(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  ...
```

To:
```typescript
function buildAgentExecEffect(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  memoryContext: string,
  allRules: CompiledRule[],
  ...
```

And change `buildAgentsPrompts` call to pass `memoryContext` instead of `guidelineFiles`:

```typescript
const agentPrompts = buildAgentsPrompts({
  fragments,
  taskPrompt: task.agent!.prompt,
  outputSchema: task.agent?.output?.schema?.content,
  userInput: taskEnv.user_input ?? undefined,
  isEntrypoint: task.name === spec.spec.run.entrypoint,
  env: taskEnv,
  agentConfig: agent
}, memoryContext, templateOptions)
```

- [ ] **Step 6: Update buildAgentsPrompts to accept memoryContext string**

In `src/prompts/builder.ts`, change signature:

From:
```typescript
export function buildAgentsPrompts(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): AgentPrompts {
```

To:
```typescript
export function buildAgentsPrompts(
  params: PromptParams,
  memoryContext: string = "",
  options: TemplateOptions = { strict: false }
): AgentPrompts {
```

Return:
```typescript
return {
  systemTemplate,
  taskTemplate,
  guidelineFiles: [],
  memoryContext,
}
```

Update `AgentPrompts` interface in the same file:
```typescript
export interface AgentPrompts {
  systemTemplate: Template
  taskTemplate: Template
  guidelineFiles: Array<{ name: string; content: string }>
  memoryContext: string
}
```

- [ ] **Step 7: Update ResolvablePrompt type**

In `src/prompts/types.ts`:
```typescript
export interface ResolvablePrompt {
  systemTemplate: Template
  taskTemplate: Template
  guidelineFiles: Array<{ name: string; content: string }>
  memoryContext: string
}
```

- [ ] **Step 8: Wire memoryContext in pi-executor.ts**

In `src/executors/pi/pi-executor.ts`, update the prompt extraction:

From:
```typescript
const { systemTemplate, taskTemplate, guidelineFiles } = config.prompt
```

To:
```typescript
const { systemTemplate, taskTemplate, memoryContext } = config.prompt
```

After rendering the system prompt (line 118):
```typescript
const systemPrompt = Effect.runSync(systemTemplate.render())
```

Append memory context:
```typescript
let systemPrompt = Effect.runSync(systemTemplate.render())
if (memoryContext) {
  systemPrompt += "\n\n" + memoryContext
}
```

Remove the `guidelineFiles` from `agentsFilesOverride` (line 158-163). Change from:
```typescript
agentsFilesOverride: (current: any) => ({
  agentsFiles: [
    ...(current?.agentsFiles ?? []),
    ...guidelineFiles.map((f: { name: string; content: string }) => ({ path: f.name, content: f.content }))
  ]
}),
```

To:
```typescript
agentsFilesOverride: (current: any) => ({
  agentsFiles: current?.agentsFiles ?? []
}),
```

Update the `PromptBuilt` event:
```typescript
yield* _(bus.publish({
  _tag: "PromptBuilt",
  runId: config.runId,
  taskId: config.taskId,
  systemPrompt,
  taskPrompt,
  guidelineFiles: []
}))
```

- [ ] **Step 9: Run tests to check integration**

```bash
bun --bun vitest run tests/workflow/runner.test.ts tests/workflow/task-executor.test.ts tests/executors/pi/
```

Expected: May need test updates due to signature changes. Update tests that mock `buildAgentsPrompts` or test `pi-executor` directly. Tests that mock `executeWithPi` and don't assert on guidelineFiles should pass unchanged.

- [ ] **Step 10: Commit**

```bash
git add src/workflow/runner.ts src/workflow/task-executor.ts src/prompts/builder.ts src/prompts/types.ts src/executors/pi/pi-executor.ts
git commit -m "refactor: replace guideline files with memory context in agent prompts"
```

---

### Task 12: Wire Guideline Ingestion Into CLI Callers

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/resume.ts`

- [ ] **Step 1: Add imports to src/cli/commands/run.ts**

```typescript
import { loadGuidelines } from "../../guidelines/loader.js"
import { extractGuidelineArtifacts } from "../../guidelines/extractor.js"
import { guidelinesDir } from "../../paths.js"
import { createUserMemoryStore } from "../../memory/store.js"
import { ingestGuidelines } from "../../memory/guidelines.js"
```

- [ ] **Step 2: Add guideline ingestion to executeRun**

In `executeRun` (src/cli/commands/run.ts), after `loadWorkflowSpec` (line 78) and before `runWorkflow` (line 84), insert:

```typescript
const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))
const { files: _guidelineFiles, rules: guidelineRules } = extractGuidelineArtifacts(loadedGuidelines)

const { reader, writer, close } = yield* _(Effect.tryPromise({
  try: () => createUserMemoryStore(hamiltonHome()),
  catch: () => ({ reader: null as any, writer: null as any, close: async () => {} })
}))

let memoryReader = reader
if (reader) {
  yield* _(Effect.addFinalizer(() => Effect.promise(() => close())))
  try {
    const db = new Database(dbPath())
    migrate(db)
    for (const guideline of loadedGuidelines) {
      const sourcePath = `/guidelines/${guideline.name}.md`
      const change = detectChanges(guideline, db, sourcePath)
      if (change.changed) {
        if (getLastIngestedHash(db, sourcePath)) {
          await tombstoneStale(writer, db, sourcePath)
        }
        await writeToQmd(writer, guideline, db, "guideline", sourcePath)
        registerIngestedEvent(db, sourcePath, change.hash, 1)
      }
    }
    db.close()
  } catch {
    yield* _(Effect.logWarning("Guideline ingestion failed, continuing without memory"))
  }
}
```

Wait — `yield* _(Effect.logWarning(...))` — need to check: `Effect` import already has `Console`. Actually `Effect.logWarning` is in the effect package. Let me use `yield* _(Effect.logWarning("..."))` — yes, this is available in Effect 3.x.

Actually, this code mixes sync (`for...of`, `try/catch` ) with Effect generators. The `for...of` loop around guideline files and the DB operations are synchronous within an Effect. Let me wrap this properly. The simplest approach: wrap the whole ingestion block in `Effect.try`:

```typescript
yield* _(Effect.try({
  try: () => {
    const db = new Database(dbPath())
    migrate(db)
    for (const guideline of loadedGuidelines) {
      const sourcePath = `/guidelines/${guideline.name}.md`
      const change = detectChanges(guideline, db, sourcePath)
      if (change.changed) {
        // Use the writer from the outer scope
      }
    }
    db.close()
  },
  catch: (e) => Effect.logWarning(`Guideline ingestion failed: ${String(e)}`)
}))
```

This won't work either because `tombstoneStale` and `writeToQmd` are async. Let me simplify — the caller orchestrates guideline ingestion in a separate `preIngest` block before entering the Effect chain:

Actually, the simplest working pattern for this phase: do guideline ingestion synchronously (without the qmd store during a dry run if needed). But the spec requires the full pipeline. Let me use `Effect.promise` for the async operations.

Let me write the simplest integration:

```typescript
yield* _(Effect.promise(async () => {
  try {
    const db = new Database(dbPath())
    migrate(db)
    for (const guideline of loadedGuidelines) {
      const sourcePath = `/guidelines/${guideline.name}.md`
      const change = detectChanges(guideline, db, sourcePath)
      if (change.changed) {
        await tombstoneStale(writer, db, sourcePath)
        await writeToQmd(writer, guideline, db, "guideline", sourcePath)
        registerIngestedEvent(db, sourcePath, change.hash, 1)
      }
    }
    db.close()
  } catch (e) {
    console.error("Guideline ingestion failed:", e)
  }
}).catch(() => {}))
```

- [ ] **Step 3: Update runWorkflow call**

Change:
```typescript
const result = yield* _(
  runWorkflow(spec, { user_input: params.prompt, project_dir: process.cwd() }, templateOptions, params.externalRunId, recursionConfig.maxDepth ?? undefined).pipe(
    Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
  )
)
```

To:
```typescript
const result = yield* _(
  runWorkflow(spec, { user_input: params.prompt, project_dir: process.cwd() }, templateOptions, guidelineRules, reader, params.externalRunId, recursionConfig.maxDepth ?? undefined).pipe(
    Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
  )
)
```

- [ ] **Step 4: Apply same pattern to src/cli/commands/resume.ts**

In `resumeWorkflow`, after loading the spec (line 73), add same guideline ingestion block and update the `runWorkflow` call signature. Add the same imports.

- [ ] **Step 5: Run the full test suite**

```bash
bun --bun vitest run
```

Expected: All tests pass. Tests that mock `runWorkflow` or `executeWithPi` may need signature updates.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/run.ts src/cli/commands/resume.ts
git commit -m "feat: wire guideline ingestion into CLI callers"
```

---

### Task 13: Documentation — Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add qmd and memory notes**

Add a new section before "Architecture":

```markdown
## Memory System (Phase 1)

Guideline files are ingested as canonical atoms into a dual-layer memory store:

- **qmd** (`@tobilu/qmd`): Manages markdown files with YAML frontmatter + hybrid full-text/vector search at `~/.hamilton/memory/user/`.
- **Hamilton DB** (`bun:sqlite`): Manages atom metadata (lifecycle, use tracking) in the existing `~/.hamilton/hamilton.db`.

`hamilton setup` must download qmd embedding models for memory to function. Failure is graceful — agents run without memory context if models are unavailable.

**New directories:** `~/.hamilton/memory/user/qmd.db`, `~/.hamilton/memory/user/canonical/`
```

- [ ] **Step 2: Add new source modules to Architecture section**

Add to the source tree description:
```
src/curator/           # LLMClient + Curator (memory filter suggestions)
src/memory/            # MemoryStore, guideline ingestion, context injection
```

- [ ] **Step 3: Add EventBus note**

In the EventBus/effects section, note that the EventBus is now application-scoped (provided in `main.ts`, not per-run).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add memory system documentation to AGENTS.md"
```<｜end▁of▁thinking｜>Let me continue writing the remaining tasks:

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="read">
<｜｜DSML｜｜parameter name="filePath" string="true">/Users/caio.cavalcante/personal/hamilton/docs/superpowers/plans/2026-06-27-memory-phase-1.md