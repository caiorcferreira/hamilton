import { Effect, Scope } from "effect"
import { Database } from "bun:sqlite"
import { Event, createSubscriber, EventBus } from "../events/bus.js"
import { insertTokenEvent, setWorkflowState } from "./queries.js"

export const DbWriter = (db: Database): Effect.Effect<void, never, Scope.Scope | EventBus> =>
  createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      if (event._tag === "TokenUsage") {
        return Effect.sync(() =>
          insertTokenEvent(db, event.runId, event.taskId, "completion", event.tokensIn, event.tokensOut)
        )
      }
      if (event._tag === "ModelSelected") {
        return Effect.sync(() =>
          db.prepare(
            `UPDATE tasks SET model_provider = ?, model_id = ? WHERE id = ?`
          ).run(event.provider, event.model, event.taskId)
        )
      }
      if (event._tag === "TodoListUpdated") {
        return Effect.sync(() =>
          setWorkflowState(db, event.runId, `todo_list:${event.taskId}`, JSON.stringify(event.todos))
        )
      }
      return Effect.void
    }
  )
