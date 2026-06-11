import { Context, Data, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"
import type { TelemetryConfig } from "../config.js"

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string
}> {}

export type TelemetryStatus = {
  enabled: boolean
  disabledStores: Array<"file" | "db">
  dbPath: string
  dbSizeBytes: number
  runCount: number
  turnCount: number
  toolCallCount: number
  providerRequestCount: number
}

export interface TelemetryStatusRepository {
  readonly getStatus: () => Effect.Effect<TelemetryStatus, RepositoryError>
}

export const TelemetryStatusRepository = Context.GenericTag<TelemetryStatusRepository>("TelemetryStatusRepository")

export const makeTelemetryStatusRepository = (
  db: Database,
  getConfig: () => TelemetryConfig
): TelemetryStatusRepository => ({
  getStatus: () =>
    Effect.try({
      try: () => {
        const config = getConfig()
        const disabled = Array.from(config.disableStores)

        const runCount = (db.prepare("SELECT COUNT(*) as c FROM runs").get() as { c: number }).c
        const turnCount = (db.prepare("SELECT COUNT(*) as c FROM turns").get() as { c: number }).c
        const toolCallCount = (db.prepare("SELECT COUNT(*) as c FROM tool_calls").get() as { c: number }).c
        const providerRequestCount = (db.prepare("SELECT COUNT(*) as c FROM provider_requests").get() as { c: number }).c

        return {
          enabled: disabled.length < 2,
          disabledStores: disabled,
          dbPath: (db as any)._dbPath ?? "unknown",
          dbSizeBytes: 0,
          runCount,
          turnCount,
          toolCallCount,
          providerRequestCount
        }
      },
      catch: (e) => new RepositoryError({ message: String(e) })
    })
})

export const TelemetryStatusRepositoryLive = (db: Database, getConfig: () => TelemetryConfig) =>
  Layer.succeed(TelemetryStatusRepository, makeTelemetryStatusRepository(db, getConfig))
