import { Effect, Scope } from "effect"
import { createSubscriber, EventBus } from "../events/bus.js"
import type { Event } from "../events/bus.js"
import type { TurnRepository } from "./repositories/turn-repository.js"
import type { ToolCallRepository } from "./repositories/tool-call-repository.js"
import type { ProviderRequestRepository } from "./repositories/provider-request-repository.js"
import { summarizeToolArgs } from "./summaries.js"

export interface TelemetryRepos {
  turn: TurnRepository
  toolCall: ToolCallRepository
  providerRequest: ProviderRequestRepository
  shouldWrite: () => boolean
}

export const TelemetrySubscriber = (repos: TelemetryRepos): Effect.Effect<void, never, Scope.Scope | EventBus> => {
  const currentTurns = new Map<string, string>()

  const turnKey = (runId: string, stepId: string) => runId + ":" + stepId

  const buildCallId = (runId: string, stepId: string, tool: string) =>
    runId + "-" + stepId + "-" + tool

  return createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      if (!repos.shouldWrite()) return Effect.void

      if (event._tag === "TurnStarted") {
        currentTurns.set(turnKey(event.runId, event.stepId), event.turnId)
        return repos.turn.insert({
          id: event.turnId,
          runId: event.runId,
          taskId: event.stepId,
          turnIndex: event.turnIndex,
          startedAt: event.timestamp
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "TurnEnd") {
        const turnId = currentTurns.get(turnKey(event.runId, event.stepId))
        if (!turnId) return Effect.void
        return repos.turn.finish(turnId, {
          stopReason: "end_turn",
          toolResultCount: 0,
          completedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "ToolCall" && event.isPartialUpdate) {
        const callId = buildCallId(event.runId, event.stepId, event.tool)
        return repos.toolCall.incrementPartialUpdates(callId).pipe(
          Effect.catchAll(() => Effect.void)
        )
      }

      if (event._tag === "ToolCall" && !event.isPartialUpdate) {
        const turnId = currentTurns.get(turnKey(event.runId, event.stepId))
        if (!turnId) return Effect.void
        const callId = buildCallId(event.runId, event.stepId, event.tool)
        const argsSummary = JSON.stringify(summarizeToolArgs(event.input))
        return repos.toolCall.insert({
          id: callId,
          runId: event.runId,
          taskId: event.stepId,
          turnId,
          toolName: event.tool,
          argsSummary,
          startedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      if (event._tag === "ToolResult") {
        const callId = buildCallId(event.runId, event.stepId, event.tool)
        const resultSummary = "{}"
        return repos.toolCall.finish(callId, {
          resultSummary,
          isError: event.isError,
          completedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }

      return Effect.void
    }
  )
}
