import { Database } from "bun:sqlite"
import { buildTaskId } from "../workflow/engine.js"

export interface RunRow {
  id: string
  workflow_id: string
  status: string
  started_at: string
  completed_at: string | null
  current_task: string | null
  error_message: string | null
  context_json: string
}

export interface TaskRow {
  id: string
  run_id: string
  agent_id: string
  task_name: string
  execution_index: number
  status: string
  started_at: string | null
  completed_at: string | null
  tokens_in: number
  tokens_out: number
  retry_count: number
  error_message: string | null
  output_json: string | null
}

export interface RunStatusRow {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt: string | null
  currentTask: string | null
  tasks: Array<{
    taskId: string
    taskName: string
    status: string
    startedAt: string | null
    completedAt: string | null
    tokensIn: number
    tokensOut: number
    errorMessage: string | null
  }>
  totalTokensIn: number
  totalTokensOut: number
  errorMessage: string | null
}

export function insertRun(
  db: Database,
  runId: string,
  workflowId: string,
  startedAt: string
): void {
  db.prepare(
    `INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`
  ).run(runId, workflowId, startedAt)
}

export function insertTasks(
  db: Database,
  runId: string,
  tasks: Array<{ taskName: string; agentName: string; executionIndex: number }>
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status) VALUES (?, ?, ?, ?, ?, 'pending')`
  )
  for (const task of tasks) {
    stmt.run(buildTaskId(runId, task.taskName), runId, task.agentName, task.taskName, task.executionIndex)
  }
}

export function insertTask(
  db: Database,
  runId: string,
  taskId: string,
  agentName: string,
  taskName: string,
  executionIndex: number
): void {
  db.prepare(
    `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status) VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(taskId, runId, agentName, taskName, executionIndex)
}

export function updateTaskStarted(
  db: Database,
  runId: string,
  taskId: string,
  startedAt: string
): void {
  db.prepare(
    `UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?`
  ).run(startedAt, taskId)
  db.prepare(
    `UPDATE runs SET current_task = ? WHERE id = ?`
  ).run(taskId, runId)
}

export function updateTaskCompleted(
  db: Database,
  runId: string,
  taskId: string,
  completedAt: string,
  data: { tokensIn?: number; tokensOut?: number; output?: unknown }
): void {
  const outputJson = data.output ? JSON.stringify(data.output) : null
  db.prepare(
    `UPDATE tasks SET status = 'completed', completed_at = ?, tokens_in = ?, tokens_out = ?, output_json = ? WHERE id = ?`
  ).run(completedAt, data.tokensIn ?? 0, data.tokensOut ?? 0, outputJson, taskId)
}

export function updateTaskFailed(
  db: Database,
  runId: string,
  taskId: string,
  errorMessage: string
): void {
  db.prepare(
    `UPDATE tasks SET status = 'failed', error_message = ? WHERE id = ?`
  ).run(errorMessage, taskId)
}

export function insertTokenEvent(
  db: Database,
  runId: string,
  taskId: string,
  eventType: string,
  tokensIn: number,
  tokensOut: number
): void {
  db.prepare(
    `INSERT INTO token_events (run_id, task_id, event_type, tokens_in, tokens_out, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(runId, taskId, eventType, tokensIn, tokensOut, new Date().toISOString())
}

export function updateRunCompleted(
  db: Database,
  runId: string,
  completedAt: string
): void {
  db.prepare(
    `UPDATE runs SET status = 'completed', completed_at = ?, current_task = NULL WHERE id = ?`
  ).run(completedAt, runId)
}

export function updateRunFailed(
  db: Database,
  runId: string,
  errorMessage: string
): void {
  db.prepare(
    `UPDATE runs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?`
  ).run(new Date().toISOString(), errorMessage, runId)
}

export function getRunById(db: Database, runId: string): RunRow | null {
  return db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | null ?? null
}

export function getTasksByRunId(db: Database, runId: string): TaskRow[] {
  return db.prepare(`SELECT * FROM tasks WHERE run_id = ? ORDER BY id`).all(runId) as TaskRow[]
}

export function getRunStatus(db: Database, runId: string): RunStatusRow | null {
  const run = getRunById(db, runId)
  if (!run) return null

  const tasks = getTasksByRunId(db, runId)
  const tokenResult = db.prepare(
    `SELECT COALESCE(SUM(tokens_in), 0) as total_in, COALESCE(SUM(tokens_out), 0) as total_out FROM token_events WHERE run_id = ?`
  ).get(runId) as { total_in: number; total_out: number }

  return {
    runId: run.id,
    workflow: run.workflow_id,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    currentTask: run.current_task,
    tasks: tasks.map((t) => ({
      taskId: t.id,
      taskSlug: t.agent_id,
      status: t.status,
      startedAt: t.started_at,
      completedAt: t.completed_at,
      tokensIn: t.tokens_in,
      tokensOut: t.tokens_out,
      errorMessage: t.error_message
    })),
    totalTokensIn: tokenResult.total_in,
    totalTokensOut: tokenResult.total_out,
    errorMessage: run.error_message
  }
}

export function setWorkflowState(
  db: Database,
  runId: string,
  key: string,
  value: string
): void {
  db.prepare(
    `INSERT OR REPLACE INTO workflow_state (run_id, key, value) VALUES (?, ?, ?)`
  ).run(runId, key, value)
}

export function getWorkflowState(
  db: Database,
  runId: string,
  key: string
): string | null {
  const row = db.prepare(
    `SELECT value FROM workflow_state WHERE run_id = ? AND key = ?`
  ).get(runId, key) as { value: string } | null
  return row?.value ?? null
}

export function setDurableDeferred(
  db: Database,
  id: string,
  runId: string,
  state: string,
  value?: string
): void {
  db.prepare(
    `INSERT OR REPLACE INTO durable_deferred (id, run_id, state, value) VALUES (?, ?, ?, ?)`
  ).run(id, runId, state, value ?? null)
}

export function getDurableDeferred(
  db: Database,
  id: string
): { state: string; value: string | null } | null {
  const row = db.prepare(
    `SELECT state, value FROM durable_deferred WHERE id = ?`
  ).get(id) as { state: string; value: string | null } | null
  return row ?? null
}

export function updateRunContext(
  db: Database,
  runId: string,
  contextJson: string
): void {
  db.prepare(
    `UPDATE runs SET context_json = ? WHERE id = ?`
  ).run(contextJson, runId)
}

export interface RunSummary {
  id: string
  workflow_id: string
  status: string
  started_at: string
  completed_at: string | null
  current_task: string | null
}

export function listRuns(
  db: Database,
  opts?: { status?: string; limit?: number }
): RunSummary[] {
  const status = opts?.status ?? null
  const limit = opts?.limit ?? 20
  const rows = db.prepare(
    `SELECT id, workflow_id, status, started_at, completed_at, current_task
     FROM runs
     WHERE (? IS NULL OR status = ?)
     ORDER BY started_at DESC
     LIMIT ?`
  ).all(status, status, limit)
  return rows as RunSummary[]
}