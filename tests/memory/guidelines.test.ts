import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import { createUserMemoryStore } from "../../src/memory/store.js"
import {
  detectChanges,
  tombstoneStale,
  writeToQmd,
  ingestGuidelines,
} from "../../src/memory/guidelines.js"
import type { MemoryWriter } from "../../src/memory/store.js"
import type { LoadedGuideline } from "../../src/guidelines/types.js"

function makeGuideline(name: string, content: string): LoadedGuideline {
  return { name, instructions: [{ name: `${name}/file.md`, content }], rules: null }
}

describe("detectChanges", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("returns changed=true when no prior ingestion event exists", () => {
    const guideline = makeGuideline("my-guideline", "some content")
    const result = detectChanges(guideline, db, "/guidelines/my-guideline.md")
    expect(result.changed).toBe(true)
    expect(result.hash).toBeTypeOf("string")
  })

  it("returns changed=false when hash matches previous ingestion", () => {
    const guideline = makeGuideline("my-guideline", "some content")
    const first = detectChanges(guideline, db, "/guidelines/my-guideline.md")

    db.prepare(`
      INSERT INTO memory_event_log (event_type, actor, metadata)
      VALUES ('ingested', 'system', ?)
    `).run(JSON.stringify({ source_path: "/guidelines/my-guideline.md", file_hash: first.hash }))

    const second = detectChanges(guideline, db, "/guidelines/my-guideline.md")
    expect(second.changed).toBe(false)
  })

  it("returns changed=true when hash differs", () => {
    const guideline1 = makeGuideline("my-guideline", "content v1")
    const result1 = detectChanges(guideline1, db, "/guidelines/my-guideline.md")

    db.prepare(`
      INSERT INTO memory_event_log (event_type, actor, metadata)
      VALUES ('ingested', 'system', ?)
    `).run(JSON.stringify({ source_path: "/guidelines/my-guideline.md", file_hash: result1.hash }))

    const guideline2 = makeGuideline("my-guideline", "content v2 different")
    const result2 = detectChanges(guideline2, db, "/guidelines/my-guideline.md")
    expect(result2.changed).toBe(true)
  })

  it("normalizes line endings before hashing", () => {
    const guideline1 = makeGuideline("my-guideline", "line1\r\nline2\rline3")
    const guideline2 = makeGuideline("my-guideline", "line1\nline2\nline3")
    const r1 = detectChanges(guideline1, db, "/guidelines/my-guideline.md")
    const r2 = detectChanges(guideline2, db, "/guidelines/my-guideline.md")
    expect(r1.hash).toBe(r2.hash)
  })
})

describe("tombstoneStale", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-ts-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("tombstones active atoms linked to the source path", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const guideline = makeGuideline("old-guideline", "old content")
    const result = await writeToQmd(writer, guideline, db, "guideline", "/guidelines/old.md")

    await tombstoneStale(writer, db, "/guidelines/old.md")

    const row = db.prepare("SELECT status FROM memory_atoms WHERE id = ?").get(result.id) as { status: string } | null
    expect(row).not.toBeNull()
    expect(row!.status).toBe("tombstoned")

    await close()
  })
})

describe("writeToQmd", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-write-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("writes guideline to qmd and inserts DB row", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const guideline = makeGuideline("my-guideline", "This is guideline content.")
    const result = await writeToQmd(writer, guideline, db, "guideline", "/guidelines/my-guideline.md")

    expect(result.id).toBeTypeOf("string")
    expect(result.path).toContain("canonical/")

    const filePath = Path.join(tmpHome, "memory", "user", result.path)
    expect(Fs.existsSync(filePath)).toBe(true)
    const content = Fs.readFileSync(filePath, "utf-8")
    expect(content).toContain("This is guideline content.")
    expect(content).toContain("kind: canonical")
    expect(content).toContain("source: guideline")

    await close()
  })
})

describe("ingestGuidelines", () => {
  let tmpHome: string
  let db: Database
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guidelines-ingest-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    db.close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("ingests new guidelines and returns summary", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const g1 = makeGuideline("guideline-a", "Content for A")
    const g2 = makeGuideline("guideline-b", "Content for B")

    const summary = await ingestGuidelines(writer, db, [g1, g2])

    expect(summary.processed).toBe(2)
    expect(summary.ingested).toBe(2)
    expect(summary.skipped).toBe(0)
    expect(summary.tombstoned).toBe(0)
    expect(summary.atoms).toHaveLength(2)
    expect(summary.atoms.every((a) => a.action === "created")).toBe(true)

    const activeAtoms = db.prepare("SELECT * FROM memory_atoms WHERE status = 'active'").all() as any[]
    expect(activeAtoms).toHaveLength(2)

    const ingestedEvents = db.prepare("SELECT * FROM memory_event_log WHERE event_type = 'ingested'").all() as any[]
    expect(ingestedEvents).toHaveLength(2)

    await close()
  })

  it("skips unchanged guidelines", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const g1 = makeGuideline("guideline-a", "Content for A")

    await ingestGuidelines(writer, db, [g1])
    const summary2 = await ingestGuidelines(writer, db, [g1])

    expect(summary2.ingested).toBe(0)
    expect(summary2.skipped).toBe(1)
    expect(summary2.atoms).toHaveLength(0)

    await close()
  })

  it("tombstones stale atoms when content changes", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const g1v1 = makeGuideline("guideline-a", "Content for A v1")

    const summary1 = await ingestGuidelines(writer, db, [g1v1])
    expect(summary1.ingested).toBe(1)

    const g1v2 = makeGuideline("guideline-a", "Content for A v2 different")
    const summary2 = await ingestGuidelines(writer, db, [g1v2])

    expect(summary2.ingested).toBe(1)
    expect(summary2.tombstoned).toBe(1)
    expect(summary2.skipped).toBe(0)

    const activeAtoms = db.prepare("SELECT * FROM memory_atoms WHERE status = 'active'").all() as any[]
    const tombstonedAtoms = db.prepare("SELECT * FROM memory_atoms WHERE status = 'tombstoned'").all() as any[]
    expect(activeAtoms).toHaveLength(1)
    expect(tombstonedAtoms).toHaveLength(1)

    await close()
  })

  it("skips guidelines with no instruction content", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)
    const emptyGuideline: LoadedGuideline = { name: "empty", instructions: null, rules: null }
    const g1 = makeGuideline("guideline-a", "Content for A")

    const summary = await ingestGuidelines(writer, db, [emptyGuideline, g1])

    expect(summary.processed).toBe(1)
    expect(summary.ingested).toBe(1)

    await close()
  })

  it("handles empty guidelines array", async () => {
    const { writer, close } = await createUserMemoryStore(tmpHome)

    const summary = await ingestGuidelines(writer, db, [])

    expect(summary.processed).toBe(0)
    expect(summary.ingested).toBe(0)
    expect(summary.skipped).toBe(0)
    expect(summary.tombstoned).toBe(0)
    expect(summary.atoms).toHaveLength(0)

    await close()
  })
})