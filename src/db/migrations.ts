import { Database } from "bun:sqlite"
import { Data } from "effect"
import { createSchema } from "./schema.js"

export class MigrationError extends Data.TaggedError("MigrationError")<{
  version: number
  message: string
}> {}

const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => createSchema(db),
  2: (db) => {
    for (const col of ["model_provider", "model_id"]) {
      try { db.exec("ALTER TABLE tasks ADD COLUMN " + col + " TEXT") }
      catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    }
  },
  3: (db) => {
    db.exec("CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_index INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, stop_reason TEXT, tool_result_count INTEGER DEFAULT 0, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id))")
    db.exec("CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, tool_name TEXT NOT NULL, args_summary TEXT NOT NULL, result_summary TEXT, is_error INTEGER DEFAULT 0, partial_update_count INTEGER DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
    db.exec("CREATE TABLE IF NOT EXISTS provider_requests (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status_code INTEGER, payload_summary TEXT NOT NULL, headers_summary TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, latency_ms INTEGER, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
  },
  4: (db) => {
    try { db.exec("ALTER TABLE tasks ADD COLUMN task_name TEXT NOT NULL DEFAULT ''") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    try { db.exec("ALTER TABLE tasks ADD COLUMN execution_index INTEGER NOT NULL DEFAULT 0") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  },
  5: (db) => {
    try { db.exec("ALTER TABLE runs ADD COLUMN pid INTEGER") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  },
  6: (db) => {
    try { db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id)") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    try { db.exec("ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  },
  7: (db) => {
    try { db.exec("ALTER TABLE tasks ADD COLUMN dependencies TEXT") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    try { db.exec("ALTER TABLE tasks ADD COLUMN task_def TEXT") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  },
  8: (db) => {
    db.exec("CREATE TABLE IF NOT EXISTS memory_atoms (id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('correction','failure','preference','fact','procedure','canonical')), scope TEXT NOT NULL CHECK (scope IN ('project','user')), confidence REAL NOT NULL DEFAULT 0.5, salience REAL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','demoted','tombstoned')), project_id TEXT, run_id TEXT, use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, demoted_at TEXT, tombstoned_at TEXT)")
    db.exec("CREATE TABLE IF NOT EXISTS memory_event_log (id INTEGER PRIMARY KEY AUTOINCREMENT, atom_id TEXT, run_id TEXT, event_type TEXT NOT NULL, actor TEXT NOT NULL CHECK (actor IN ('agent','system','human')), reason TEXT, metadata TEXT NOT NULL DEFAULT '{}', timestamp TEXT NOT NULL DEFAULT (datetime('now')))")
  },
  9: (db) => {
    try { db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'leaf'") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    try { db.exec("ALTER TABLE tasks ADD COLUMN parent_task_name TEXT") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  }
}

export function migrate(db: Database): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number }
  const currentVersion: number = row.user_version

  const versions = Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b)

  for (const version of versions) {
    if (version <= currentVersion) continue

    try {
      db.transaction(() => {
        MIGRATIONS[version](db)
        db.prepare("PRAGMA user_version = " + version).run()
      })()
    } catch (e) {
      if (e && typeof e === "object" && "_tag" in e && (e as any)._tag === "MigrationError") throw e
      throw new MigrationError({ version, message: String(e) })
    }
  }
}
