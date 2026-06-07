import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Effect, Exit } from "effect"
import { listRunHistory } from "../../src/cli/commands/runs.js"
import { createSchema } from "../../src/db/schema.js"
import { insertRun, updateRunFailed } from "../../src/db/queries.js"
import { dbPath } from "../../src/paths.js"

describe("listRunHistory", () => {
  let db: Database & { _tempDir: string }

  beforeEach(() => {
    const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
    const fakeHome = Path.join(tmp, ".hamilton")
    Fs.mkdirSync(fakeHome, { recursive: true })
    process.env.HOME = tmp
    db = Object.assign(
      new Database(Path.join(fakeHome, "hamilton.db")),
      { _tempDir: tmp }
    ) as Database & { _tempDir: string }
    createSchema(db)
  })

  afterEach(() => {
    db.close()
    if (db._tempDir) Fs.rmSync(db._tempDir, { recursive: true, force: true })
  })

  it("returns empty array when no runs exist", async () => {
    const exit = await Effect.runPromiseExit(listRunHistory())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("returns runs ordered by started_at DESC", async () => {
    const now = new Date().toISOString()
    const earlier = new Date(Date.now() - 3600000).toISOString()
    insertRun(db, "run-1", "bug-fix", earlier)
    insertRun(db, "run-2", "feature-dev", now)

    const exit = await Effect.runPromiseExit(listRunHistory())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2)
      expect(exit.value[0].id).toBe("run-2")
    }
  })

  it("filters by status", async () => {
    const now = new Date().toISOString()
    insertRun(db, "run-ok", "bug-fix", now)
    insertRun(db, "run-fail", "bug-fix", now)
    updateRunFailed(db, "run-fail", "error")

    const exit = await Effect.runPromiseExit(listRunHistory({ status: "failed" }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].id).toBe("run-fail")
    }
  })

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      insertRun(db, `run-${i}`, "bug-fix", new Date(Date.now() - i * 1000).toISOString())
    }
    const exit = await Effect.runPromiseExit(listRunHistory({ limit: 3 }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(3)
      expect(exit.value[0].completed_at).toBeDefined()
    }
  })
})