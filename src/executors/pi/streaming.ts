import { Effect } from "effect"
import { EventBus } from "../../events/bus.js"

export interface PiEvent {
  type: string
  toolName?: string
  toolCallId?: string
  args?: unknown
  isError?: boolean
  assistantMessageEvent?: { type: string; delta?: string }
  message?: { content?: Array<{ type: string; text?: string }> }
  result?: unknown
  [key: string]: unknown
}

export function subscribePiEvents(
  runId: string,
  taskId: string,
  getSessionStats: () => { inputTokens: number; outputTokens: number }
): (event: PiEvent) => Effect.Effect<void, never, EventBus> {
  let buffer = ""
  let lastStats = { inputTokens: 0, outputTokens: 0 }

  return (event: PiEvent) =>
    Effect.gen(function* (_) {
      const bus = yield* _(EventBus)

      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
            buffer += event.assistantMessageEvent.delta
          }
          break
        case "message_end":
          if (buffer) {
            const text = buffer
            buffer = ""
            yield* _(bus.publish({ _tag: "LlmMessage", runId, taskId, text }))
          }
          break
        case "tool_execution_start":
          buffer = ""
          yield* _(
            bus.publish({
              _tag: "ToolCall",
              runId,
              taskId,
              tool: event.toolName ?? "unknown",
              input: event.args ?? {}
            })
          )
          break
        case "tool_execution_end":
          yield* _(
            bus.publish({
              _tag: "ToolResult",
              runId,
              taskId,
              tool: event.toolName ?? "unknown",
              isError: event.isError ?? false
            })
          )
          break
        case "turn_end":
          const current = getSessionStats()
          const tokensIn = current.inputTokens - lastStats.inputTokens
          const tokensOut = current.outputTokens - lastStats.outputTokens
          lastStats = current

          yield* _(bus.publish({ _tag: "TurnEnd", runId, taskId, tokensIn, tokensOut }))
          yield* _(bus.publish({ _tag: "TokenUsage", runId, taskId, tokensIn, tokensOut }))
          break
      }
    })
}