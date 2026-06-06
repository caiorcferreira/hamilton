import { Effect, Data } from "effect"
import { Database } from "bun:sqlite"
import { dbPath } from "../paths.js"
import { createSchema } from "../db/schema.js"
import { getRunStatus } from "../db/queries.js"

export class RunStateError extends Data.TaggedError("RunStateError")<{
  runId: string
  message: string
}> {}

export interface RunStatus {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt: string | null
  currentStep: string | null
  steps: Array<{
    stepId: string
    agentSlug: string
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

export function openDb(): Effect.Effect<Database, RunStateError> {
  return Effect.try({
    try: () => {
      const dp = dbPath()
      const db = new Database(dp)
      db.run("PRAGMA journal_mode = WAL")
      createSchema(db)
      return db
    },
    catch: (e) =>
      new RunStateError({
        runId: "db",
        message: `Failed to open database: ${String(e)}`
      })
  })
}

export function loadRunState(runId: string): Effect.Effect<RunStatus, RunStateError> {
  return Effect.gen(function* () {
    const db = yield* openDb()
    const status = getRunStatus(db, runId)

    if (!status) {
      db.close()
      return yield* Effect.fail(
        new RunStateError({ runId, message: `Run not found: ${runId}` })
      )
    }

    db.close()
    return status
  })
}