import { Effect, Data } from "effect"
import { openDb } from "../../workflow/state.js"
import { setDurableDeferred } from "../../db/queries.js"

export class PauseError extends Data.TaggedError("PauseError")<{
  runId: string
  message: string
}> {}

export function pauseWorkflow(runId: string): Effect.Effect<string, PauseError> {
  return Effect.gen(function* () {
    const db = yield* openDb().pipe(
      Effect.mapError((e) => new PauseError({ runId, message: String(e) }))
    )

    setDurableDeferred(db, `pause-${runId}`, runId, "paused", "paused-by-user")
    db.close()

    return `Paused ${runId}`
  })
}