import { describe, it, expect, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createSchema } from "../../src/db/schema.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  ;(db as any)._dbPath = dbPath
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("createSchema", () => {
  let db: Database

  afterEach(() => {
    if (db) cleanupDb(db)
  })

  it("creates all required tables", () => {
    db = tempDb()
    createSchema(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name)
    expect(tables).toContain("runs")
    expect(tables).toContain("tasks")
    expect(tables).toContain("token_events")
    expect(tables).toContain("workflow_state")
    expect(tables).toContain("durable_deferred")
  })

  it("is idempotent", () => {
    db = tempDb()
    createSchema(db)
    expect(() => createSchema(db)).not.toThrow()
  })

  it("can insert and query a run", () => {
    db = tempDb()
    createSchema(db)
    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)"
    ).run("run-1", "wf-1", "running", new Date().toISOString())
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get("run-1") as any
    expect(run).toBeDefined()
    expect(run.id).toBe("run-1")
    expect(run.workflow_id).toBe("wf-1")
    expect(run.status).toBe("running")
  })

  it("can insert and query tasks", () => {
    db = tempDb()
    createSchema(db)
    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)"
    ).run("run-1", "wf-1", "running", new Date().toISOString())
    db.prepare(
      "INSERT INTO tasks (id, run_id, agent_id, status) VALUES (?, ?, ?, ?)"
    ).run("run-1-task-1-abcde", "run-1", "agent-1", "pending")
    const tasks = db.prepare("SELECT * FROM tasks WHERE run_id = ?").all("run-1") as any[]
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe("run-1-task-1-abcde")
    expect(tasks[0].agent_id).toBe("agent-1")
  })

  it("can insert token events", () => {
    db = tempDb()
    createSchema(db)
    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)"
    ).run("run-1", "wf-1", "running", new Date().toISOString())
    db.prepare(
      "INSERT INTO token_events (run_id, task_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("run-1", "task-1", "completion", 100, 50, new Date().toISOString())
    const events = db.prepare("SELECT * FROM token_events WHERE run_id = ?").all("run-1") as any[]
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe("completion")
    expect(events[0].tokens_in).toBe(100)
    expect(events[0].tokens_out).toBe(50)
  })

  it("uses current_task column in runs", () => {
    db = tempDb()
    createSchema(db)
    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at, current_task) VALUES (?, ?, ?, ?, ?)"
    ).run("run-1", "wf-1", "running", new Date().toISOString(), "task-1")
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get("run-1") as any
    expect(run.current_task).toBe("task-1")
  })

  it("uses task_id column in token_events", () => {
    db = tempDb()
    createSchema(db)
    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)"
    ).run("run-1", "wf-1", "running", new Date().toISOString())
    db.prepare(
      "INSERT INTO token_events (run_id, task_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("run-1", "task-1", "completion", 100, 50, new Date().toISOString())
    const events = db.prepare("SELECT * FROM token_events WHERE task_id = ?").all("task-1") as any[]
    expect(events).toHaveLength(1)
    expect(events[0].task_id).toBe("task-1")
  })
})