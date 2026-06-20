import { describe, it, expect } from "vitest"
import { Database } from "bun:sqlite"
import { createSchema } from "../../src/db/schema.js"
import { migrate } from "../../src/db/migrations.js"
import { insertTask, insertTaskWithParent } from "../../src/db/queries.js"
import { buildTaskId } from "../../src/workflow/engine.js"

function tempDb(): Database {
  const db = new Database(":memory:")
  return db
}

describe("db migration v6 — parent_task_id and depth", () => {
  it("adds parent_task_id and depth columns via migration", () => {
    const db = tempDb()
    migrate(db)

    const info = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>
    const columns = info.map(c => c.name)

    expect(columns).toContain("parent_task_id")
    expect(columns).toContain("depth")
  })

  it("existing rows default to depth 0 and null parent", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-1"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "plan")
    insertTask(db, runId, taskId, "planner", "plan", 0)

    const row = db.prepare("SELECT parent_task_id, depth FROM tasks WHERE id = ?").get(taskId) as { parent_task_id: string | null; depth: number }
    expect(row.parent_task_id).toBeNull()
    expect(row.depth).toBe(0)
  })

  it("can store parent_task_id and depth via insertTaskWithParent", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-2"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const parentId = buildTaskId(runId, "parent")
    insertTaskWithParent(db, runId, parentId, "parent-agent", "parent", 0, null, 0)

    const childId = buildTaskId(runId, "child")
    insertTaskWithParent(db, runId, childId, "child-agent", "child", 1, parentId, 1)

    const row = db.prepare("SELECT parent_task_id, depth FROM tasks WHERE id = ?").get(childId) as { parent_task_id: string | null; depth: number }
    expect(row.parent_task_id).toBe(parentId)
    expect(row.depth).toBe(1)
  })
})