import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export interface ToolCallRepository {
  readonly insert: (call: {
    id: string
    runId: string
    taskId: string
    turnId: string
    toolName: string
    argsSummary: string
    startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly finish: (id: string, data: {
    resultSummary: string
    isError: boolean
    completedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly incrementPartialUpdates: (id: string) => Effect.Effect<void, RepositoryError>
}

export const ToolCallRepository = Context.GenericTag<ToolCallRepository>("ToolCallRepository")

export const makeToolCallRepository = (db: Database): ToolCallRepository => ({
  insert: (call) =>
    Effect.try({
      try: () => {
        db.prepare(
          "INSERT INTO tool_calls (id, run_id, task_id, turn_id, tool_name, args_summary, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(call.id, call.runId, call.taskId, call.turnId, call.toolName, call.argsSummary, call.startedAt)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  finish: (id, data) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE tool_calls SET result_summary = ?, is_error = ?, completed_at = ? WHERE id = ?"
        ).run(data.resultSummary, data.isError ? 1 : 0, data.completedAt, id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  incrementPartialUpdates: (id) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE tool_calls SET partial_update_count = partial_update_count + 1 WHERE id = ?"
        ).run(id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const ToolCallRepositoryLive = (db: Database) =>
  Layer.succeed(ToolCallRepository, makeToolCallRepository(db))
