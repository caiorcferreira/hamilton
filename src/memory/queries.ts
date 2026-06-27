import { Database } from "bun:sqlite"

export interface MemoryAtomRow {
  id: string
  path: string
  kind: string
  scope: string
  confidence: number
  salience: number | null
  status: string
  project_id: string | null
  run_id: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  demoted_at: string | null
  tombstoned_at: string | null
}

export interface NewMemoryAtomRow {
  id: string
  path: string
  kind: string
  scope: string
  confidence: number
  status: string
  project_id?: string
  run_id?: string
  created_at: string
  updated_at: string
}

export interface MemoryEventRow {
  event_type: string
  actor: string
  atom_id?: string
  run_id?: string
  reason?: string
  metadata: string
}

export function insertMemoryAtom(db: Database, atom: NewMemoryAtomRow): void {
  db.prepare(`
    INSERT INTO memory_atoms (id, path, kind, scope, confidence, status, project_id, run_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    atom.id,
    atom.path,
    atom.kind,
    atom.scope,
    atom.confidence,
    atom.status,
    atom.project_id ?? null,
    atom.run_id ?? null,
    atom.created_at,
    atom.updated_at
  )
}

export function getMemoryAtomById(db: Database, id: string): MemoryAtomRow | null {
  return db.prepare("SELECT * FROM memory_atoms WHERE id = ?").get(id) as MemoryAtomRow | null
}

export function getMemoryAtomsBySourcePath(db: Database, sourcePath: string): MemoryAtomRow[] {
  return db.prepare(`
    SELECT ma.* FROM memory_atoms ma
    JOIN memory_event_log mel ON mel.atom_id = ma.id
    WHERE mel.event_type = 'ingested'
      AND json_extract(mel.metadata, '$.source_path') = ?
      AND ma.status = 'active'
  `).all(sourcePath) as MemoryAtomRow[]
}

export function updateMemoryAtomStatus(db: Database, id: string, status: string): void {
  const now = new Date().toISOString()
  const demotedAt = status === "demoted" ? now : null
  const tombstonedAt = status === "tombstoned" ? now : null
  db.prepare(`
    UPDATE memory_atoms SET status = ?, updated_at = ?, demoted_at = COALESCE(?, demoted_at), tombstoned_at = COALESCE(?, tombstoned_at) WHERE id = ?
  `).run(status, now, demotedAt, tombstonedAt, id)
}

export function insertMemoryEvent(db: Database, event: MemoryEventRow): void {
  db.prepare(`
    INSERT INTO memory_event_log (atom_id, run_id, event_type, actor, reason, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.atom_id ?? null,
    event.run_id ?? null,
    event.event_type,
    event.actor,
    event.reason ?? null,
    event.metadata
  )
}