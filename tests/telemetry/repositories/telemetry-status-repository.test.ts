import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../src/db/migrations.js"
import { makeTelemetryStatusRepository, TelemetryStatusRepository } from "../../../src/telemetry/repositories/telemetry-status-repository.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-ts-"))
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

describe("TelemetryStatusRepository", () => {
  let db: Database
  let repo: TelemetryStatusRepository

  beforeEach(() => {
    db = tempDb()
    repo = makeTelemetryStatusRepository(db, () => ({ disableStores: new Set() }))
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("returns zero counts for empty DB", async () => {
    const exit = await Effect.runPromiseExit(repo.getStatus())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.runCount).toBe(0)
      expect(exit.value.turnCount).toBe(0)
      expect(exit.value.toolCallCount).toBe(0)
      expect(exit.value.providerRequestCount).toBe(0)
      expect(exit.value.disabledStores).toEqual([])
      expect(exit.value.enabled).toBe(true)
    }
  })

  it("returns correct counts after inserting rows", async () => {
    db.prepare("INSERT INTO runs (id, workflow_id, started_at) VALUES ('r1', 'wf1', 'now')").run()
    db.prepare("INSERT INTO turns (id, run_id, task_id, turn_index, started_at) VALUES ('t1', 'r1', 'tsk1', 0, 'now')").run()
    db.prepare("INSERT INTO turns (id, run_id, task_id, turn_index, started_at) VALUES ('t2', 'r1', 'tsk1', 1, 'now')").run()
    db.prepare("INSERT INTO tool_calls (id, run_id, task_id, turn_id, tool_name, args_summary, started_at) VALUES ('tc1', 'r1', 'tsk1', 't1', 'bash', '{}', 'now')").run()
    db.prepare("INSERT INTO provider_requests (id, run_id, task_id, turn_id, provider, model, payload_summary, started_at) VALUES ('pr1', 'r1', 'tsk1', 't1', 'openai', 'gpt-5', '{}', 'now')").run()

    const exit = await Effect.runPromiseExit(repo.getStatus())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.runCount).toBe(1)
      expect(exit.value.turnCount).toBe(2)
      expect(exit.value.toolCallCount).toBe(1)
      expect(exit.value.providerRequestCount).toBe(1)
    }
  })

  it("reports disabledStores from config", async () => {
    const disabledRepo = makeTelemetryStatusRepository(db, () => ({
      disableStores: new Set(["file", "db"] as const)
    }))
    const exit = await Effect.runPromiseExit(disabledRepo.getStatus())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.disabledStores).toEqual(["file", "db"])
      expect(exit.value.enabled).toBe(false)
    }
  })
})
