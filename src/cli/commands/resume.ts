import { Effect, Data } from "effect"
import { openDb } from "../../workflow/state.js"
import { setDurableDeferred, getRunById } from "../../db/queries.js"

export class ResumeError extends Data.TaggedError("ResumeError")<{
  runId: string
  message: string
}> {}

export function resumeWorkflow(runId: string): Effect.Effect<string, ResumeError> {
  return Effect.gen(function* () {
    const db = yield* openDb().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    )

    const run = getRunById(db, runId)
    if (!run) {
      db.close()
      return yield* Effect.fail(new ResumeError({ runId, message: "Run not found" }))
    }

    if (run.status !== "paused") {
      db.close()
      return yield* Effect.fail(new ResumeError({ runId, message: "Run is not paused" }))
    }

    setDurableDeferred(db, `pause-${runId}`, runId, "pending")
    db.close()

    return `Resume initiated for ${runId}. Run 'hamilton workflow status ${runId}' for progress.`
  })
}