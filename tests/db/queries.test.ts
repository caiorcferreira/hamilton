import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createSchema } from "../../src/db/schema.js"
import {
  insertRun,
  insertTasks,
  insertTask,
  updateTaskStarted,
  updateTaskCompleted,
  updateTaskFailed,
  insertTokenEvent,
  updateRunCompleted,
  updateRunFailed,
  getRunById,
  getTasksByRunId,
  getRunStatus,
  setWorkflowState,
  getWorkflowState,
  setDurableDeferred,
  getDurableDeferred,
  updateRunContext,
  listRuns
} from "../../src/db/queries.js"

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

describe("queries", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
    createSchema(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("insertRun and getRunById", () => {
    const startedAt = "2025-01-01T00:00:00Z"
    insertRun(db, "run-1", "wf-1", startedAt)
    const run = getRunById(db, "run-1")
    expect(run).not.toBeNull()
    expect(run!.id).toBe("run-1")
    expect(run!.workflow_id).toBe("wf-1")
    expect(run!.status).toBe("running")
    expect(run!.started_at).toBe(startedAt)
  })

  it("insertTasks creates all tasks", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTasks(db, "run-1", [
      { taskName: "task-1", agentName: "agent-1", executionIndex: 0 },
      { taskName: "task-2", agentName: "agent-2", executionIndex: 1 }
    ])
    const tasks = getTasksByRunId(db, "run-1")
    expect(tasks).toHaveLength(2)
    expect(tasks[0].id).toContain("task-1")
    expect(tasks[0].agent_id).toBe("agent-1")
    expect(tasks[0].task_name).toBe("task-1")
    expect(tasks[0].execution_index).toBe(0)
    expect(tasks[1].id).toContain("task-2")
    expect(tasks[1].task_name).toBe("task-2")
    expect(tasks[1].execution_index).toBe(1)
  })

  it("insertTask inserts a single task", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTask(db, "run-1", "run-1-dynamic-abcde", "agent-1", "dynamic-task", 99)
    const tasks = getTasksByRunId(db, "run-1")
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe("run-1-dynamic-abcde")
    expect(tasks[0].agent_id).toBe("agent-1")
    expect(tasks[0].task_name).toBe("dynamic-task")
    expect(tasks[0].execution_index).toBe(99)
    expect(tasks[0].status).toBe("pending")
  })

  it("updateTaskStarted sets status to running", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTasks(db, "run-1", [{ taskName: "task-1", agentName: "agent-1", executionIndex: 0 }])
    const tasks = getTasksByRunId(db, "run-1")
    const taskId = tasks[0].id
    updateTaskStarted(db, "run-1", taskId, "2025-01-01T00:01:00Z")
    const updated = getTasksByRunId(db, "run-1")
    expect(updated[0].status).toBe("running")
    expect(updated[0].started_at).toBe("2025-01-01T00:01:00Z")
    const run = getRunById(db, "run-1")
    expect(run!.current_task).toBe(taskId)
  })

  it("updateTaskCompleted sets status, tokens, output", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTasks(db, "run-1", [{ taskName: "task-1", agentName: "agent-1", executionIndex: 0 }])
    const tasks = getTasksByRunId(db, "run-1")
    const taskId = tasks[0].id
    updateTaskStarted(db, "run-1", taskId, "2025-01-01T00:01:00Z")
    updateTaskCompleted(db, "run-1", taskId, "2025-01-01T00:02:00Z", {
      tokensIn: 100,
      tokensOut: 50,
      output: { result: "done" }
    })
    const updated = getTasksByRunId(db, "run-1")
    expect(updated[0].status).toBe("completed")
    expect(updated[0].tokens_in).toBe(100)
    expect(updated[0].tokens_out).toBe(50)
    expect(JSON.parse(updated[0].output_json!)).toEqual({ result: "done" })
  })

  it("updateTaskFailed sets status and error", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTasks(db, "run-1", [{ taskName: "task-1", agentName: "agent-1", executionIndex: 0 }])
    const tasks = getTasksByRunId(db, "run-1")
    const taskId = tasks[0].id
    updateTaskFailed(db, "run-1", taskId, "something went wrong")
    const updated = getTasksByRunId(db, "run-1")
    expect(updated[0].status).toBe("failed")
    expect(updated[0].error_message).toBe("something went wrong")
  })

  it("insertTokenEvent adds event", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTokenEvent(db, "run-1", "task-1", "completion", 100, 50)
    const events = db.prepare("SELECT * FROM token_events WHERE run_id = ?").all("run-1") as any[]
    expect(events).toHaveLength(1)
    expect(events[0].tokens_in).toBe(100)
    expect(events[0].tokens_out).toBe(50)
  })

  it("updateRunCompleted sets completed status", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    updateRunCompleted(db, "run-1", "2025-01-01T00:10:00Z")
    const run = getRunById(db, "run-1")
    expect(run!.status).toBe("completed")
    expect(run!.completed_at).toBe("2025-01-01T00:10:00Z")
    expect(run!.current_task).toBeNull()
  })

  it("updateRunFailed sets failed status with error", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    updateRunFailed(db, "run-1", "fatal error")
    const run = getRunById(db, "run-1")
    expect(run!.status).toBe("failed")
    expect(run!.error_message).toBe("fatal error")
    expect(run!.completed_at).not.toBeNull()
  })

  it("getRunStatus returns formatted status for CLI", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTasks(db, "run-1", [{ taskName: "task-1", agentName: "agent-1", executionIndex: 0 }])
    const tasks = getTasksByRunId(db, "run-1")
    const taskId = tasks[0].id
    updateTaskStarted(db, "run-1", taskId, "2025-01-01T00:01:00Z")
    updateTaskCompleted(db, "run-1", taskId, "2025-01-01T00:02:00Z", {
      tokensIn: 100,
      tokensOut: 50
    })
    insertTokenEvent(db, "run-1", taskId, "completion", 100, 50)
    const status = getRunStatus(db, "run-1")
    expect(status).not.toBeNull()
    expect(status!.runId).toBe("run-1")
    expect(status!.workflow).toBe("wf-1")
    expect(status!.tasks).toHaveLength(1)
    expect(status!.tasks[0].taskName).toBe("task-1")
    expect(status!.totalTokensIn).toBe(100)
    expect(status!.totalTokensOut).toBe(50)
  })

  it("getRunStatus returns tasks ordered by execution_index", () => {
    insertRun(db, "run-order", "wf-order", "2025-01-01T00:00:00Z")
    insertTasks(db, "run-order", [
      { taskName: "third", agentName: "agent-c", executionIndex: 2 },
      { taskName: "first", agentName: "agent-a", executionIndex: 0 },
      { taskName: "second", agentName: "agent-b", executionIndex: 1 }
    ])
    const status = getRunStatus(db, "run-order")
    expect(status!.tasks[0].taskName).toBe("first")
    expect(status!.tasks[1].taskName).toBe("second")
    expect(status!.tasks[2].taskName).toBe("third")
  })

  it("getRunById returns null for non-existent run", () => {
    const run = getRunById(db, "nonexistent")
    expect(run).toBeNull()
  })
})

describe("listRuns", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
    createSchema(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("returns runs ordered by started_at DESC", () => {
    const now = new Date().toISOString()
    const earlier = new Date(Date.now() - 3600000).toISOString()
    insertRun(db, "run-1", "bug-fix", earlier)
    insertRun(db, "run-2", "feature-dev", now)
    const runs = listRuns(db)
    expect(runs).toHaveLength(2)
    expect(runs[0].id).toBe("run-2")
    expect(runs[1].id).toBe("run-1")
  })

  it("filters by status", () => {
    const now = new Date().toISOString()
    insertRun(db, "run-ok", "bug-fix", now)
    insertRun(db, "run-fail", "security-audit", now)
    updateRunFailed(db, "run-fail", "it broke")
    const running = listRuns(db, { status: "running" })
    expect(running).toHaveLength(1)
    expect(running[0].id).toBe("run-ok")
    const failed = listRuns(db, { status: "failed" })
    expect(failed).toHaveLength(1)
    expect(failed[0].id).toBe("run-fail")
  })

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      insertRun(db, `run-${i}`, "bug-fix", new Date(Date.now() - i * 1000).toISOString())
    }
    expect(listRuns(db, { limit: 3 })).toHaveLength(3)
  })

  it("default limit is 20", () => {
    const runs = listRuns(db)
    expect(runs.length).toBeLessThanOrEqual(20)
  })
})