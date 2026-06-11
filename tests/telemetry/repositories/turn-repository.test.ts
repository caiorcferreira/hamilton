import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../src/db/migrations.js"
import { TurnRepository, makeTurnRepository } from "../../../src/telemetry/repositories/turn-repository.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-turn-"))
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

describe("TurnRepository", () => {
  let db: Database
  let repo: TurnRepository

  beforeEach(() => {
    db = tempDb()
    repo = makeTurnRepository(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("insert creates a row in turns table", async () => {
    const exit = await Effect.runPromiseExit(
      repo.insert({
        id: "turn-1",
        runId: "run-1",
        taskId: "task-1",
        turnIndex: 0,
        startedAt: "2026-01-01T00:00:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM turns WHERE id = ?").get("turn-1") as any
    expect(row).not.toBeNull()
    expect(row.run_id).toBe("run-1")
    expect(row.task_id).toBe("task-1")
    expect(row.turn_index).toBe(0)
    expect(row.started_at).toBe("2026-01-01T00:00:00Z")
    expect(row.completed_at).toBeNull()
    expect(row.stop_reason).toBeNull()
    expect(row.tool_result_count).toBe(0)
  })

  it("finish updates stop_reason, tool_result_count, completed_at", async () => {
    await Effect.runPromiseExit(
      repo.insert({
        id: "turn-2",
        runId: "run-1",
        taskId: "task-1",
        turnIndex: 1,
        startedAt: "2026-01-01T00:00:00Z"
      })
    )

    const exit = await Effect.runPromiseExit(
      repo.finish("turn-2", {
        stopReason: "end_turn",
        toolResultCount: 3,
        completedAt: "2026-01-01T00:01:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM turns WHERE id = ?").get("turn-2") as any
    expect(row.stop_reason).toBe("end_turn")
    expect(row.tool_result_count).toBe(3)
    expect(row.completed_at).toBe("2026-01-01T00:01:00Z")
  })
})
