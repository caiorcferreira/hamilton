import { Database } from "bun:sqlite"
import * as crypto from "node:crypto"
import { nanoid } from "nanoid"
import type { LoadedGuideline } from "../guidelines/types.js"
import type { MemoryWriter } from "./store.js"
import { insertMemoryEvent } from "./queries.js"

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
  atoms: Array<{ id: string; guidelineName: string; action: "created" | "skipped" }>
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
  const rows = db.prepare(`
    SELECT ma.id FROM memory_atoms ma
    JOIN memory_event_log mel ON mel.atom_id = ma.id
    WHERE mel.event_type = 'ingested'
      AND json_extract(mel.metadata, '$.source_path') = ?
      AND ma.status = 'active'
  `).all(sourcePath) as { id: string }[]
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

export function registerIngestedEvent(
  db: Database,
  sourcePath: string,
  hash: string,
  chunkCount: number
): void {
  insertMemoryEvent(db, {
    event_type: "ingested",
    actor: "system",
    metadata: JSON.stringify({
      source: "guideline",
      source_path: sourcePath,
      file_hash: hash,
      scope: "user",
      chunk_count: chunkCount,
    }),
  })
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
    const sourcePath = `/guidelines/${guideline.name}.md`
    const change = detectChanges(guideline, db, sourcePath)

    if (!change.changed) {
      skipped++
      atoms.push({ id: "", guidelineName: guideline.name, action: "skipped" })
      continue
    }

    const previousHash = getLastIngestedHash(db, sourcePath)
    if (previousHash !== null) {
      await tombstoneStale(writer, db, sourcePath)
      tombstoned++
    }

    const result = await writeToQmd(writer, guideline, db, "guideline", sourcePath, change.hash)
    ingested++
    atoms.push({ id: result.id, guidelineName: guideline.name, action: "created" })
  }

  return {
    processed: filtered.length,
    ingested,
    skipped,
    tombstoned,
    atoms,
  }
}