import { Effect, Scope } from "effect"
import { Event, EventBus, createSubscriber } from "../events/bus.js"
import { appendEngineLog, writeSummary } from "./run-dir.js"
import type { TelemetryConfig } from "../telemetry/config.js"
import type { WorkflowSpec } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"

export const WorkflowLogger = (
  telemetryConfig: TelemetryConfig,
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  startedAt: string
): Effect.Effect<void, never, Scope.Scope | EventBus> =>
  createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      const fileEnabled = !telemetryConfig.disableStores.has("file")
      if (!fileEnabled) return Effect.void

      if (event._tag === "WorkflowStarted") {
        return Effect.gen(function* (_) {
          yield* _(appendEngineLog(event.runId, { event: "workflow_started", workflowId: spec.metadata.name, parameters: initialParameters, startedAt }))
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "WorkflowCompleted") {
        return Effect.gen(function* (_) {
          if (event.message) {
            yield* _(appendEngineLog(event.runId, { event: "workflow_failed", error: event.message }))
          } else {
            yield* _(appendEngineLog(event.runId, { event: "workflow_completed", status: event.summary?.status }))
          }
          if (event.summary) {
            yield* _(writeSummary(event.runId, event.summary))
          }
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "TaskInserted") {
        return Effect.gen(function* (_) {
          yield* _(appendEngineLog(event.runId, {
            event: "task_inserted",
            taskId: event.taskId,
            taskName: event.taskName,
            scopeKey: event.scopeKey,
            depth: event.depth
          }))
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      return Effect.void
    }
  )
