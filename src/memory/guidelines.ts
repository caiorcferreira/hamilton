import { Database } from "bun:sqlite"
import * as crypto from "node:crypto"
import { nanoid } from "nanoid"
import type { LoadedGuideline } from "../guidelines/types.js"
import type { MemoryWriter } from "./store.js"
import { insertMemoryEvent, getMemoryAtomsBySourcePath } from "./queries.js"

export interface ChangeResult {
  changed: boolean
  hash: string
}

export interface WriteResult {
  id: string
  path: string
}

export interface IngestSummary {
  processed: number
  ingested: number
  skipped: number
  tombstoned: number
  atoms: Array<{ id: string; guidelineName: string; fileName: string; action: "created" }>
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex")
}

function getInstructionContent(guideline: LoadedGuideline): string {
  if (guideline.instructions && guideline.instructions.length > 0) {
    return guideline.instructions.map(i => i.content).join("\n\n")
  }
  return ""
}

export function getLastIngestedHash(db: Database, sourcePath: string): string | null {
  const row = db.prepare(`
    SELECT metadata FROM memory_event_log
    WHERE event_type = 'ingested'
      AND json_extract(metadata, '$.source_path') = ?
    ORDER BY id DESC LIMIT 1
  `).get(sourcePath) as { metadata: string } | null
  if (!row) return null
  try {
    const meta = JSON.parse(row.metadata)
    return meta.file_hash ?? null
  } catch {
    return null
  }
}

export function detectChanges(
  guideline: LoadedGuideline,
  db: Database,
  sourcePath: string
): ChangeResult {
  const content = getInstructionContent(guideline)
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const hash = sha256(normalized)
  const previous = getLastIngestedHash(db, sourcePath)
  return { changed: previous !== hash, hash }
}

export async function tombstoneStale(
  writer: MemoryWriter,
  db: Database,
  sourcePath: string
): Promise<void> {
  const rows = getMemoryAtomsBySourcePath(db, sourcePath)
  for (const row of rows) {
    await writer.tombstone(row.id, db)
  }
}

export async function writeToQmd(
  writer: MemoryWriter,
  guideline: LoadedGuideline,
  db: Database,
  source: string,
  sourcePath: string,
  hash?: string,
): Promise<WriteResult> {
  const content = getInstructionContent(guideline)
  const title = guideline.name
  const id = nanoid(21)

  const result = await writer.writeAtom({
    id,
    title,
    kind: "canonical",
    scope: "user",
    content,
    tags: [],
    source_path: sourcePath,
    source,
  }, db)

  const metaObj: Record<string, unknown> = {
    source,
    source_path: sourcePath,
    scope: "user",
    chunk_count: 1,
  }
  if (hash) {
    metaObj.file_hash = hash
  }

  insertMemoryEvent(db, {
    event_type: "ingested",
    actor: "system",
    atom_id: id,
    metadata: JSON.stringify(metaObj),
  })

  return { id: result.id, path: result.path }
}

export async function ingestGuidelines(
  writer: MemoryWriter,
  db: Database,
  guidelines: LoadedGuideline[]
): Promise<IngestSummary> {
  const filtered = guidelines.filter(
    (g) => g.instructions !== null && g.instructions.length > 0
  )

  let ingested = 0
  let skipped = 0
  let tombstoned = 0
  const atoms: IngestSummary["atoms"] = []

  for (const guideline of filtered) {
    for (const instruction of guideline.instructions!) {
      const rawName = instruction.name.split(/[/:]/).pop()!
      const fileName = rawName.endsWith(".md") ? rawName.slice(0, -3) : rawName
      const sourcePath = `/guidelines/${guideline.name}/${fileName}.md`

      const normalized = instruction.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      const hash = sha256(normalized)
      const previousHash = getLastIngestedHash(db, sourcePath)

      if (previousHash === hash) {
        skipped++
        continue
      }

      if (previousHash !== null) {
        await tombstoneStale(writer, db, sourcePath)
        tombstoned++
      }

      const result = await writeInstructionAtom(
        writer, db, instruction, guideline.name, sourcePath, hash
      )
      ingested++
      atoms.push({ id: result.id, guidelineName: guideline.name, fileName: fileName, action: "created" })
    }
  }

  return {
    processed: ingested + skipped,
    ingested,
    skipped,
    tombstoned,
    atoms,
  }
}

async function writeInstructionAtom(
  writer: MemoryWriter,
  db: Database,
  instruction: { name: string; content: string },
  guidelineName: string,
  sourcePath: string,
  hash: string
): Promise<WriteResult> {
  const id = nanoid(21)
  const rawName = instruction.name.split(/[/:]/).pop()!
  const fileName = rawName.endsWith(".md") ? rawName.slice(0, -3) : rawName
  const title = `${guidelineName}/${fileName}`

  const result = await writer.writeAtom({
    id,
    title,
    kind: "canonical",
    scope: "user",
    content: instruction.content,
    tags: [],
    source_path: sourcePath,
    source: "guideline",
  }, db)

  insertMemoryEvent(db, {
    event_type: "ingested",
    actor: "system",
    atom_id: id,
    metadata: JSON.stringify({
      source: "guideline",
      source_path: sourcePath,
      file_hash: hash,
      scope: "user",
      chunk_count: 1,
    }),
  })

  return { id: result.id, path: result.path }
}