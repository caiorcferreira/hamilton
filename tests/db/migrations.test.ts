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

  it("migrate creates all tables from scratch (v1 -> v4)", () => {
    db = tempDb()
    const v = db.prepare("PRAGMA user_version").get() as { user_version: number }
    expect(v.user_version).toBe(0)

    migrate(db)

    const v2 = db.prepare("PRAGMA user_version").get() as { user_version: number }
    expect(v2.user_version).toBe(4)

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
    expect(v1).toBe(4)

    migrate(db)
    const v2 = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    expect(v2).toBe(4)
  })

  it("v2 recovers from partial migration (crash between ALTER TABLE and PRAGMA)", () => {
    db = tempDb()
    db.prepare("PRAGMA user_version = 1").run()
    db.exec("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT, current_task TEXT, error_message TEXT, context_json TEXT DEFAULT '{}')")
    db.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', started_at TEXT, completed_at TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, retry_count INTEGER DEFAULT 0, error_message TEXT, output_json TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")
    db.exec("CREATE TABLE IF NOT EXISTS token_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT NOT NULL, event_type TEXT NOT NULL, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, timestamp TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (run_id) REFERENCES runs(id))")
    db.exec("CREATE TABLE IF NOT EXISTS workflow_state (run_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (run_id, key))")
    db.exec("CREATE TABLE IF NOT EXISTS durable_deferred (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', value TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")

    db.exec("ALTER TABLE tasks ADD COLUMN model_provider TEXT")

    migrate(db)

    const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
    expect(v).toBe(4)

    const info = db.prepare("PRAGMA table_info('tasks')").all() as Array<{ name: string }>
    const colNames = info.map(c => c.name)
    expect(colNames).toContain("model_provider")
    expect(colNames).toContain("model_id")
  })

  it("v3 -> v4 adds task_name and execution_index to tasks", () => {
    db = tempDb()
    db.prepare("PRAGMA user_version = 3").run()
    db.exec("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT, current_task TEXT, error_message TEXT, context_json TEXT DEFAULT '{}')")
    db.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', started_at TEXT, completed_at TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, retry_count INTEGER DEFAULT 0, error_message TEXT, output_json TEXT, model_provider TEXT, model_id TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")
    db.exec("CREATE TABLE IF NOT EXISTS token_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT NOT NULL, event_type TEXT NOT NULL, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, timestamp TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (run_id) REFERENCES runs(id))")
    db.exec("CREATE TABLE IF NOT EXISTS workflow_state (run_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (run_id, key))")
    db.exec("CREATE TABLE IF NOT EXISTS durable_deferred (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', value TEXT, FOREIGN KEY (run_id) REFERENCES runs(id))")
    db.exec("CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_index INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, stop_reason TEXT, tool_result_count INTEGER DEFAULT 0, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id))")
    db.exec("CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, tool_name TEXT NOT NULL, args_summary TEXT NOT NULL, result_summary TEXT, is_error INTEGER DEFAULT 0, partial_update_count INTEGER DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
    db.exec("CREATE TABLE IF NOT EXISTS provider_requests (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status_code INTEGER, payload_summary TEXT NOT NULL, headers_summary TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, latency_ms INTEGER, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")

    migrate(db)

    const v = db.prepare("PRAGMA user_version").get() as { user_version: number }
    expect(v.user_version).toBe(4)

    const info = db.prepare("PRAGMA table_info('tasks')").all() as Array<{ name: string }>
    const colNames = info.map(c => c.name)
    expect(colNames).toContain("task_name")
    expect(colNames).toContain("execution_index")
  })
})
