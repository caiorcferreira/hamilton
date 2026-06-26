import { describe, it, expect } from "vitest"
import { Database } from "bun:sqlite"
import { migrate } from "../../src/db/migrations.js"
import { insertTask } from "../../src/db/queries.js"
import { buildTaskId } from "../../src/workflow/engine.js"

function tempDb(): Database {
  return new Database(":memory:")
}

describe("db migration v7 — depth and dependencies", () => {
  it("existing rows default to depth 0", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-1"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "plan")
    insertTask(db, runId, taskId, "planner", "plan", 0, 0, [], {})

    const row = db.prepare("SELECT depth, dependencies FROM tasks WHERE id = ?").get(taskId) as { depth: number; dependencies: string | null }
    expect(row.depth).toBe(0)
    expect(JSON.parse(row.dependencies ?? "[]")).toEqual([])
  })

  it("can store depth via insertTask", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-2"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "child")
    insertTask(db, runId, taskId, "child-agent", "child", 1, 3, ["parent"], {})

    const row = db.prepare("SELECT depth, dependencies FROM tasks WHERE id = ?").get(taskId) as { depth: number; dependencies: string }
    expect(row.depth).toBe(3)
    expect(JSON.parse(row.dependencies)).toEqual(["parent"])
  })
})