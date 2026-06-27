import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memory-schema-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("memory_atoms schema (migration v8)", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("creates memory_atoms and memory_event_log tables via migrate", () => {
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain("memory_atoms")
    expect(names).toContain("memory_event_log")
  })

  it("enforces kind CHECK constraint", () => {
    migrate(db)
    expect(() =>
      db.prepare("INSERT INTO memory_atoms (id, path, kind, scope, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "a1", "canonical/test.md", "invalid_kind", "user", 0.5, new Date().toISOString(), new Date().toISOString()
      )
    ).toThrow()
  })

  it("enforces scope CHECK constraint", () => {
    migrate(db)
    expect(() =>
      db.prepare("INSERT INTO memory_atoms (id, path, kind, scope, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        "a1", "canonical/test.md", "canonical", "invalid_scope", 0.5, new Date().toISOString(), new Date().toISOString()
      )
    ).toThrow()
  })

  it("defaults status to active", () => {
    migrate(db)
    db.prepare("INSERT INTO memory_atoms (id, path, kind, scope, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "a1", "canonical/test.md", "canonical", "user", 0.5, new Date().toISOString(), new Date().toISOString()
    )
    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get("a1") as { status: string }
    expect(row.status).toBe("active")
  })

  it("enforces actor CHECK constraint on memory_event_log", () => {
    migrate(db)
    expect(() =>
      db.prepare("INSERT INTO memory_event_log (event_type, actor, metadata) VALUES (?, ?, ?)").run(
        "atom.created", "invalid_actor", "{}"
      )
    ).toThrow()
  })

  it("migrate is idempotent", () => {
    migrate(db)
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain("memory_atoms")
    expect(names).toContain("memory_event_log")
  })
})