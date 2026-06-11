import { Database } from "bun:sqlite"

export function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      current_task TEXT,
      error_message TEXT,
      context_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_name TEXT NOT NULL DEFAULT '',
      execution_index INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      output_json TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS token_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_state (
      run_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (run_id, key)
    );

    CREATE TABLE IF NOT EXISTS durable_deferred (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      value TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
  `)
}