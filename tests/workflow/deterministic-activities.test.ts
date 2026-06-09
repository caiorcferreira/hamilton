import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Database } from "bun:sqlite"
import { Effect, Exit } from "effect"
import { resolvePersona } from "../../src/prompts/persona.js"
import { createSchema } from "../../src/db/schema.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-deterministic-"))
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

describe("deterministic activities", () => {
  let db: Database
  let origHome: string | undefined
  let tmpHome: string

  beforeEach(() => {
    db = tempDb()
    origHome = process.env.HOME
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-det-"))
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    cleanupDb(db)
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("createGitWorktree fails for nonexistent repo", async () => {
    const { createGitWorktree } = await import("../../src/workflow/deterministic-activities.js")
    const result = await Effect.runPromiseExit(
      createGitWorktree({ repo: "/nonexistent/path", branch: "test" }, "step-1")
    )
    expect(Exit.isFailure(result)).toBe(true)
  })

  it("cleanupGitWorktree succeeds for nonexistent path", async () => {
    const { cleanupGitWorktree } = await import("../../src/workflow/deterministic-activities.js")
    const result = await Effect.runPromiseExit(
      cleanupGitWorktree({ worktreePath: "/nonexistent/path" }, "step-1")
    )
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.cleaned).toBe(true)
    }
  })
})