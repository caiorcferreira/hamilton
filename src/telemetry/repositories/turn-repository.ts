import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export interface TurnRepository {
  readonly insert: (turn: {
    id: string
    runId: string
    taskId: string
    turnIndex: number
    startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly finish: (id: string, data: {
    stopReason: string
    toolResultCount: number
    completedAt: string
  }) => Effect.Effect<void, RepositoryError>
}

export const TurnRepository = Context.GenericTag<TurnRepository>("TurnRepository")

export const makeTurnRepository = (db: Database): TurnRepository => ({
  insert: (turn) =>
    Effect.try({
      try: () => {
        db.prepare(
          "INSERT INTO turns (id, run_id, task_id, turn_index, started_at) VALUES (?, ?, ?, ?, ?)"
        ).run(turn.id, turn.runId, turn.taskId, turn.turnIndex, turn.startedAt)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  finish: (id, data) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE turns SET stop_reason = ?, tool_result_count = ?, completed_at = ? WHERE id = ?"
        ).run(data.stopReason, data.toolResultCount, data.completedAt, id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const TurnRepositoryLive = (db: Database) =>
  Layer.succeed(TurnRepository, makeTurnRepository(db))
