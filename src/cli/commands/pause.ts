import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import { openDb } from "../../workflow/state.js"
import { setDurableDeferred } from "../../db/queries.js"
import { hamiltonHome } from "../../paths.js"

export class PauseError extends Data.TaggedError("PauseError")<{
  runId: string
  message: string
}> {}

export function pauseWorkflow(runId: string): Effect.Effect<string, PauseError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new PauseError({
        runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const db = yield* _(openDb().pipe(
      Effect.mapError((e) => new PauseError({ runId, message: String(e) }))
    ))

    setDurableDeferred(db, `pause-${runId}`, runId, "paused", "paused-by-user")
    db.close()

    return `Paused ${runId}`
  })
}