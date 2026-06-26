import { describe, it, expect } from "vitest"
import { Database } from "bun:sqlite"
import { migrate } from "../../src/db/migrations.js"
import { insertTask, insertTasks } from "../../src/db/queries.js"
import { buildTaskId } from "../../src/workflow/engine.js"

function tempDb(): Database {
  return new Database(":memory:")
}

describe("db migration v7 — task_def and dependencies", () => {
  it("adds task_def and dependencies columns, removes parent_task_id", () => {
    const db = tempDb()
    migrate(db)

    const info = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>
    const columns = info.map(c => c.name)

    expect(columns).toContain("task_def")
    expect(columns).toContain("dependencies")
    expect(columns).toContain("depth")
  })

  it("stores dependencies as JSON array", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-1"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "plan")
    insertTask(db, runId, taskId, "planner", "plan", 0, 0, ["setup"], {})

    const row = db.prepare("SELECT dependencies, task_def FROM tasks WHERE id = ?").get(taskId) as { dependencies: string; task_def: string }
    expect(JSON.parse(row.dependencies)).toEqual(["setup"])
    expect(JSON.parse(row.task_def)).toEqual({})
  })

  it("stores task_def with full task config", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-2"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "build")
    const taskConfig = {
      agent: { executorRef: "builder", prompt: { content: "Build it" } },
      arguments: { forEach: { valueFrom: { ref: "inputs.parameters.items" }, as: "item" } },
      when: "inputs.parameters.go == true"
    }
    insertTask(db, runId, taskId, "builder", "build", 0, 1, [], taskConfig)

    const row = db.prepare("SELECT task_def FROM tasks WHERE id = ?").get(taskId) as { task_def: string }
    const parsed = JSON.parse(row.task_def)
    expect(parsed.agent.executorRef).toBe("builder")
    expect(parsed.arguments.forEach.as).toBe("item")
    expect(parsed.when).toBe("inputs.parameters.go == true")
  })

  it("empty dependencies stored as []", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-3"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "leaf")
    insertTask(db, runId, taskId, "agent", "leaf", 0, 0, [], {})

    const row = db.prepare("SELECT dependencies FROM tasks WHERE id = ?").get(taskId) as { dependencies: string }
    expect(JSON.parse(row.dependencies)).toEqual([])
  })

  it("insertTasks batch stores all rows", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-4"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    insertTasks(db, runId, [
      { taskName: "a", agentName: "agent-a", executionIndex: 0, depth: 0, dependencies: [], taskConfig: { agent: { executorRef: "agent-a", prompt: { content: "A" } } } },
      { taskName: "b", agentName: "agent-b", executionIndex: 1, depth: 0, dependencies: ["a"], taskConfig: { agent: { executorRef: "agent-b", prompt: { content: "B" } } } }
    ])

    const rows = db.prepare("SELECT task_name, dependencies, task_def FROM tasks WHERE run_id = ? ORDER BY execution_index").all(runId) as Array<{ task_name: string; dependencies: string; task_def: string }>
    expect(rows.length).toBe(2)
    expect(rows[0].task_name).toBe("a")
    expect(JSON.parse(rows[0].dependencies)).toEqual([])
    expect(rows[1].task_name).toBe("b")
    expect(JSON.parse(rows[1].dependencies)).toEqual(["a"])
  })
})