import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadRunState } from "../../src/workflow/state.js"
import { createSchema } from "../../src/db/schema.js"
import { insertRun, insertTasks, updateTaskStarted, updateTaskCompleted, updateRunCompleted, insertTokenEvent, getRunStatus } from "../../src/db/queries.js"
import { formatStatus } from "../../src/cli/commands/status.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-status-"))
  const dp = Path.join(dir, "hamilton.db")
  const db = new Database(dp)
    ;(db as any)._tempDir = dir
  createSchema(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("loadRunState (SQLite-backed)", () => {
  let db: Database
  let origHome: string | undefined
  let tmpHome: string

  beforeEach(() => {
    db = tempDb()
    origHome = process.env.HOME
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-state-"))
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    cleanupDb(db)
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("reads run state from SQLite", async () => {
    const startedAt = "2026-01-01T00:00:00.000Z"
    insertRun(db, "run-1", "bug-fix", startedAt)
    insertTasks(db, "run-1", [
      { taskSlug: "triage", agentName: "triager" },
      { taskSlug: "fix", agentName: "fixer" }
    ])
    const tasks = db.prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY id").all("run-1") as any[]
    const triageTaskId = tasks.find((t: any) => t.id.includes("triage"))!.id
    const fixTaskId = tasks.find((t: any) => t.id.includes("fix"))!.id

    updateTaskStarted(db, "run-1", triageTaskId, "2026-01-01T00:00:01.000Z")
    updateTaskCompleted(db, "run-1", triageTaskId, "2026-01-01T00:00:30.000Z", {
      tokensIn: 500,
      tokensOut: 200
    })
    updateTaskStarted(db, "run-1", fixTaskId, "2026-01-01T00:00:31.000Z")
    insertTokenEvent(db, "run-1", triageTaskId, "completion", 500, 200)

    const dp = Path.join(tmpHome, ".hamilton", "hamilton.db")
    const targetDb = new Database(dp)
    createSchema(targetDb)
    const sourceData = db.prepare("SELECT * FROM runs").all() as any[]
    for (const row of sourceData) {
      targetDb.prepare(
        `INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at, completed_at, current_task, error_message, context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.workflow_id, row.status, row.started_at, row.completed_at, row.current_task, row.error_message, row.context_json)
    }
    const tasksData = db.prepare("SELECT * FROM tasks").all() as any[]
    for (const row of tasksData) {
      targetDb.prepare(
        `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, status, started_at, completed_at, tokens_in, tokens_out, retry_count, error_message, output_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(row.id, row.run_id, row.agent_id, row.status, row.started_at, row.completed_at, row.tokens_in, row.tokens_out, row.retry_count, row.error_message, row.output_json)
    }
    const tokenData = db.prepare("SELECT * FROM token_events").all() as any[]
    for (const row of tokenData) {
      targetDb.prepare(
        `INSERT INTO token_events (run_id, task_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(row.run_id, row.task_id, row.event_type, row.tokens_in, row.tokens_out, row.timestamp)
    }
    targetDb.close()

    const exit = await Effect.runPromiseExit(loadRunState("run-1"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.runId).toBe("run-1")
      expect(exit.value.workflow).toBe("bug-fix")
      expect(exit.value.status).toBe("running")
      expect(exit.value.tasks).toHaveLength(2)
      expect(exit.value.tasks[0].taskId).toContain("fix")
      expect(exit.value.tasks[0].status).toBe("running")
      expect(exit.value.tasks[1].taskId).toContain("triage")
      expect(exit.value.tasks[1].status).toBe("completed")
      expect(exit.value.totalTokensIn).toBe(500)
      expect(exit.value.totalTokensOut).toBe(200)
    }
  })

  it("returns failure for non-existent run", async () => {
    const dp = Path.join(tmpHome, ".hamilton", "hamilton.db")
    const targetDb = new Database(dp)
    createSchema(targetDb)
    targetDb.close()

    const exit = await Effect.runPromiseExit(loadRunState("nonexistent"))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("formatStatus", () => {
  it("formats a running status", () => {
    const runId = "bug-fix-abc123"
    const status = {
      runId,
      workflow: "bug-fix",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      currentTask: "fix",
      tasks: [
        { taskId: `${runId}-triage-x1y2z`, taskSlug: "triager", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-investigate-x2y3z`, taskSlug: "investigator", status: "completed", startedAt: "2026-01-01T00:00:30.000Z", completedAt: "2026-01-01T00:01:00.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-setup-x3y4z`, taskSlug: "setter", status: "completed", startedAt: "2026-01-01T00:01:00.000Z", completedAt: "2026-01-01T00:01:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-fix-x4y5z`, taskSlug: "fixer", status: "running", startedAt: "2026-01-01T00:01:30.000Z", completedAt: null, tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-verify-x5y6z`, taskSlug: "verifier", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null }
      ],
      totalTokensIn: 25000,
      totalTokensOut: 8000,
      errorMessage: null
    }
    const output = formatStatus(status as any)
    expect(output).toContain("Run folder:")
    expect(output).toContain("bug-fix")
    expect(output).toContain("running")
    expect(output).toContain(runId)
    expect(output).toContain("fix (4/5)")
    expect(output).toContain("triage")
    expect(output).toContain("verify")
    expect(output).toContain("25,000")
    expect(output).toContain("8,000")
    expect(output).toContain("Errors:    none")

    const lines = output.split("\n")
    const tasksLineIdx = lines.findIndex((l) => l === "Tasks:")
    expect(tasksLineIdx).toBeGreaterThanOrEqual(0)
    expect(tasksLineIdx).toBe(lines.length - 6)

    for (const t of status.tasks) {
      const slug = t.taskId.slice(runId.length + 1, t.taskId.lastIndexOf("-"))
      const found = lines.some((l) => l.includes(slug))
      expect(found).toBe(true)
    }
  })

  it("formats a completed status", () => {
    const runId = "run-done"
    const status = {
      runId,
      workflow: "test-wf",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:05:00.000Z",
      currentTask: null,
      tasks: [
        { taskId: `${runId}-task-1-abc`, taskSlug: "a1", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:02:00.000Z", tokensIn: 100, tokensOut: 50, errorMessage: null }
      ],
      totalTokensIn: 100,
      totalTokensOut: 50,
      errorMessage: null
    }
    const output = formatStatus(status as any)
    expect(output).toContain("completed")
    expect(output).toContain("5m 0s total")
  })

  it("formats a failed status with error", () => {
    const runId = "run-fail"
    const status = {
      runId,
      workflow: "failing-wf",
      status: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:10.000Z",
      currentTask: null,
      tasks: [
        { taskId: `${runId}-task-1-abc`, taskSlug: "a1", status: "failed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: "API error" }
      ],
      totalTokensIn: 0,
      totalTokensOut: 0,
      errorMessage: "API error"
    }
    const output = formatStatus(status as any)
    expect(output).toContain("failed")
    expect(output).toContain("API error")
  })

  it("indents subtask instances with 3 spaces", () => {
    const runId = "feature-dev-abc123"
    const status = {
      runId,
      workflow: "feature-dev",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      currentTask: `${runId}-implement-stories-0-x1y2z`,
      tasks: [
        { taskId: `${runId}-triage-x1y2z`, taskSlug: "triager", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: `${runId}-implement-stories-0-x2y3z`, taskSlug: "implementer", status: "running", startedAt: "2026-01-01T00:00:30.000Z", completedAt: null, tokensIn: 1000, tokensOut: 500, errorMessage: null },
        { taskId: `${runId}-implement-stories-1-x3y4z`, taskSlug: "implementer", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null }
      ],
      totalTokensIn: 1500,
      totalTokensOut: 700,
      errorMessage: null
    }
    const output = formatStatus(status as any)
    const lines = output.split("\n")

    const triageLine = lines.find((l) => l.includes("triage") && !l.includes("Task:"))
    expect(triageLine).toBeDefined()
    expect(triageLine!.startsWith("  ")).toBe(true)

    const subtask0 = lines.find((l) => l.includes("implement-stories/0") && !l.includes("Task:"))
    expect(subtask0).toBeDefined()
    expect(subtask0!.startsWith("   ")).toBe(true)

    const subtask1 = lines.find((l) => l.includes("implement-stories/1") && !l.includes("Task:"))
    expect(subtask1).toBeDefined()
    expect(subtask1!.startsWith("   ")).toBe(true)

    expect(triageLine).toContain("(triager)")
    expect(subtask0).not.toContain("(implementer)")
  })
})