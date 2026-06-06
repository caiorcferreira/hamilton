import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createSchema } from "../../src/db/schema.js"
import {
  insertRun,
  insertSteps,
  updateStepStarted,
  updateStepCompleted,
  updateStepFailed,
  insertTokenEvent,
  updateRunCompleted,
  updateRunFailed,
  getRunById,
  getStepsByRunId,
  getRunStatus,
  setWorkflowState,
  getWorkflowState,
  setDurableDeferred,
  getDurableDeferred,
  updateRunContext
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

  it("insertSteps creates all steps", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertSteps(db, "run-1", [
      { stepId: "step-1", agentId: "agent-1" },
      { stepId: "step-2", agentId: "agent-2" }
    ])
    const steps = getStepsByRunId(db, "run-1")
    expect(steps).toHaveLength(2)
    expect(steps[0].step_id).toBe("step-1")
    expect(steps[0].agent_id).toBe("agent-1")
    expect(steps[1].step_id).toBe("step-2")
  })

  it("updateStepStarted sets status to running", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertSteps(db, "run-1", [{ stepId: "step-1", agentId: "agent-1" }])
    updateStepStarted(db, "run-1", "step-1", "2025-01-01T00:01:00Z")
    const steps = getStepsByRunId(db, "run-1")
    expect(steps[0].status).toBe("running")
    expect(steps[0].started_at).toBe("2025-01-01T00:01:00Z")
    const run = getRunById(db, "run-1")
    expect(run!.current_step).toBe("step-1")
  })

  it("updateStepCompleted sets status, tokens, output", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertSteps(db, "run-1", [{ stepId: "step-1", agentId: "agent-1" }])
    updateStepStarted(db, "run-1", "step-1", "2025-01-01T00:01:00Z")
    updateStepCompleted(db, "run-1", "step-1", "2025-01-01T00:02:00Z", {
      tokensIn: 100,
      tokensOut: 50,
      output: { result: "done" }
    })
    const steps = getStepsByRunId(db, "run-1")
    expect(steps[0].status).toBe("completed")
    expect(steps[0].tokens_in).toBe(100)
    expect(steps[0].tokens_out).toBe(50)
    expect(JSON.parse(steps[0].output_json!)).toEqual({ result: "done" })
  })

  it("updateStepFailed sets status and error", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertSteps(db, "run-1", [{ stepId: "step-1", agentId: "agent-1" }])
    updateStepFailed(db, "run-1", "step-1", "something went wrong")
    const steps = getStepsByRunId(db, "run-1")
    expect(steps[0].status).toBe("failed")
    expect(steps[0].error_message).toBe("something went wrong")
  })

  it("insertTokenEvent adds event", () => {
    insertRun(db, "run-1", "wf-1", "2025-01-01T00:00:00Z")
    insertTokenEvent(db, "run-1", "step-1", "completion", 100, 50)
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
    expect(run!.current_step).toBeNull()
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
    insertSteps(db, "run-1", [{ stepId: "step-1", agentId: "agent-1" }])
    updateStepStarted(db, "run-1", "step-1", "2025-01-01T00:01:00Z")
    updateStepCompleted(db, "run-1", "step-1", "2025-01-01T00:02:00Z", {
      tokensIn: 100,
      tokensOut: 50
    })
    insertTokenEvent(db, "run-1", "step-1", "completion", 100, 50)
    const status = getRunStatus(db, "run-1")
    expect(status).not.toBeNull()
    expect(status!.runId).toBe("run-1")
    expect(status!.workflow).toBe("wf-1")
    expect(status!.steps).toHaveLength(1)
    expect(status!.totalTokensIn).toBe(100)
    expect(status!.totalTokensOut).toBe(50)
  })

  it("getRunById returns null for non-existent run", () => {
    const run = getRunById(db, "nonexistent")
    expect(run).toBeNull()
  })
})