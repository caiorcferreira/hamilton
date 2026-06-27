import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import {
  insertMemoryAtom,
  getMemoryAtomById,
  getMemoryAtomsBySourcePath,
  updateMemoryAtomStatus,
  insertMemoryEvent
} from "../../src/memory/queries.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memqueries-"))
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

describe("memory queries", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
    migrate(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  const now = "2026-06-27T12:00:00.000Z"

  it("insertMemoryAtom inserts and returns the row", () => {
    insertMemoryAtom(db, {
      id: "a1",
      path: "canonical/test.md",
      kind: "canonical",
      scope: "user",
      confidence: 1.0,
      status: "active",
      created_at: now,
      updated_at: now
    })
    const row = db.prepare("SELECT * FROM memory_atoms WHERE id = ?").get("a1") as any
    expect(row.id).toBe("a1")
    expect(row.path).toBe("canonical/test.md")
    expect(row.kind).toBe("canonical")
    expect(row.scope).toBe("user")
    expect(row.confidence).toBe(1.0)
    expect(row.status).toBe("active")
  })

  it("getMemoryAtomById returns the row", () => {
    insertMemoryAtom(db, { id: "a1", path: "canonical/test.md", kind: "canonical", scope: "user", confidence: 1.0, status: "active", created_at: now, updated_at: now })
    const row = getMemoryAtomById(db, "a1")
    expect(row).not.toBeNull()
    expect(row!.id).toBe("a1")
  })

  it("getMemoryAtomById returns null for missing id", () => {
    const row = getMemoryAtomById(db, "nonexistent")
    expect(row).toBeNull()
  })

  it("getMemoryAtomsBySourcePath returns atoms linked via event_log", () => {
    insertMemoryAtom(db, { id: "a1", path: "canonical/test.md", kind: "canonical", scope: "user", confidence: 1.0, status: "active", created_at: now, updated_at: now })
    insertMemoryEvent(db, { event_type: "ingested", actor: "system", atom_id: "a1", metadata: JSON.stringify({ source_path: "/guidelines/my-guideline.md", file_hash: "abc123" }) })
    const results = getMemoryAtomsBySourcePath(db, "/guidelines/my-guideline.md")
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("a1")
  })

  it("getMemoryAtomsBySourcePath excludes tombstoned atoms", () => {
    insertMemoryAtom(db, { id: "a1", path: "canonical/test.md", kind: "canonical", scope: "user", confidence: 1.0, status: "active", created_at: now, updated_at: now })
    insertMemoryEvent(db, { event_type: "ingested", actor: "system", atom_id: "a1", metadata: JSON.stringify({ source_path: "/guidelines/my-guideline.md", file_hash: "abc123" }) })
    updateMemoryAtomStatus(db, "a1", "tombstoned")
    const results = getMemoryAtomsBySourcePath(db, "/guidelines/my-guideline.md")
    expect(results).toHaveLength(0)
  })

  it("updateMemoryAtomStatus changes status", () => {
    insertMemoryAtom(db, { id: "a1", path: "canonical/test.md", kind: "canonical", scope: "user", confidence: 1.0, status: "active", created_at: now, updated_at: now })
    updateMemoryAtomStatus(db, "a1", "tombstoned")
    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get("a1") as { status: string }
    expect(row.status).toBe("tombstoned")
  })

  it("insertMemoryEvent inserts an event row", () => {
    insertMemoryEvent(db, { event_type: "ingested", actor: "system", metadata: JSON.stringify({ source_path: "test.md", file_hash: "abc" }) })
    const rows = db.prepare("SELECT * FROM memory_event_log").all() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].event_type).toBe("ingested")
    expect(rows[0].actor).toBe("system")
  })

  it("insertMemoryEvent handles optional atom_id and run_id", () => {
    insertMemoryEvent(db, { event_type: "ingested", actor: "system", atom_id: "a1", run_id: "run1", metadata: "{}" })
    const rows = db.prepare("SELECT * FROM memory_event_log").all() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].atom_id).toBe("a1")
    expect(rows[0].run_id).toBe("run1")
  })
})