import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../src/db/migrations.js"
import { makeToolCallRepository, ToolCallRepository } from "../../../src/telemetry/repositories/tool-call-repository.js"

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
