import { Effect, Scope } from "effect"
import { Database } from "bun:sqlite"
import { Event, createSubscriber, EventBus } from "../events/bus.js"
import { insertTokenEvent } from "./queries.js"

export const DbWriter = (db: Database): Effect.Effect<void, never, Scope.Scope | EventBus> =>
  createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      if (event._tag === "TokenUsage") {
        return Effect.sync(() =>
          insertTokenEvent(db, event.runId, event.stepId, "completion", event.tokensIn, event.tokensOut)
        )
      }
      return Effect.void
    }
  )