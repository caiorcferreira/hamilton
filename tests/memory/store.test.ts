import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import { createUserMemoryStore } from "../../src/memory/store.js"

describe("createUserMemoryStore", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memstore-"))
    process.env.HOME = tmpHome
    const homeDir = Path.join(tmpHome, ".hamilton", "memory", "user")
    Fs.mkdirSync(homeDir, { recursive: true })
    Fs.mkdirSync(Path.join(homeDir, "canonical"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("creates a user memory store with reader and writer", async () => {
    const { reader, writer, close } = await createUserMemoryStore(tmpHome)
    expect(reader).toHaveProperty("retrieveRelevant")
    expect(reader).toHaveProperty("getAtom")
    expect(writer).toHaveProperty("writeAtom")
    expect(writer).toHaveProperty("tombstone")
    expect(writer).toHaveProperty("updateStatus")
    await close()
  })

  it("writes and retrieves an atom", { timeout: 15000 }, async () => {
    const { reader, writer, close } = await createUserMemoryStore(tmpHome)
    const db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)

    const { id, path } = await writer.writeAtom({
      id: "test-a1",
      title: "Test Canonical",
      kind: "canonical",
      scope: "user",
      content: "This is a test canonical atom.",
      tags: ["lang:typescript", "testing"],
      source_path: "/guidelines/test.md",
      source: "guideline",
    }, db)

    expect(id).toBe("test-a1")
    expect(path).toContain("canonical/")
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "memory", "user", path))).toBe(true)

    const atom = await reader.getAtom(id)
    expect(atom).not.toBeNull()
    expect(atom!.id).toBeDefined()

    db.close()
    await close()
  })

  it("tombstone marks atom as tombstoned", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)

    const { id } = await writer.writeAtom({
      id: "test-a2",
      title: "To Be Tombstoned",
      kind: "canonical",
      scope: "user",
      content: "Will be removed.",
      tags: [],
      source_path: "/guidelines/old.md",
      source: "guideline",
    }, db)

    await writer.tombstone(id, db)

    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get(id) as { status: string } | null
    expect(row).not.toBeNull()
    expect(row!.status).toBe("tombstoned")

    db.close()
    await close()
  })

  it("close cleans up the store", async () => {
    const { close } = await createUserMemoryStore(tmpHome)
    await close()
    const qmdDbPath = Path.join(tmpHome, ".hamilton", "memory", "user", "qmd.db")
    expect(Fs.existsSync(qmdDbPath)).toBe(true)
  })
})