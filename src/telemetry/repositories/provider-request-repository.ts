import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export interface ProviderRequestRepository {
  readonly insert: (req: {
    id: string
    runId: string
    taskId: string
    turnId: string
    provider: string
    model: string
    payloadSummary: string
    startedAt: string
  }) => Effect.Effect<void, RepositoryError>

  readonly complete: (id: string, data: {
    statusCode: number
    headersSummary: string
    tokensIn: number
    tokensOut: number
    latencyMs: number
    completedAt: string
  }) => Effect.Effect<void, RepositoryError>
}

export const ProviderRequestRepository = Context.GenericTag<ProviderRequestRepository>("ProviderRequestRepository")

export const makeProviderRequestRepository = (db: Database): ProviderRequestRepository => ({
  insert: (req) =>
    Effect.try({
      try: () => {
        db.prepare(
          "INSERT INTO provider_requests (id, run_id, task_id, turn_id, provider, model, payload_summary, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(req.id, req.runId, req.taskId, req.turnId, req.provider, req.model, req.payloadSummary, req.startedAt)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    }),

  complete: (id, data) =>
    Effect.try({
      try: () => {
        db.prepare(
          "UPDATE provider_requests SET status_code = ?, headers_summary = ?, tokens_in = ?, tokens_out = ?, latency_ms = ?, completed_at = ? WHERE id = ?"
        ).run(data.statusCode, data.headersSummary, data.tokensIn, data.tokensOut, data.latencyMs, data.completedAt, id)
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const ProviderRequestRepositoryLive = (db: Database) =>
  Layer.succeed(ProviderRequestRepository, makeProviderRequestRepository(db))
