import { Effect } from "effect"

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

export interface SubscribeConfig {
  runId: string
  stepId: string
  onLog: (event: Record<string, unknown>) => Effect.Effect<void>
  onTokenEvent: (params: { runId: string; stepId: string; tokensIn: number; tokensOut: number }) => Effect.Effect<void>
  getSessionStats: () => { inputTokens: number; outputTokens: number }
}

export function subscribePiEvents(config: SubscribeConfig): (event: PiEvent) => Effect.Effect<void> {
  let buffer = ""
  let lastStats = { inputTokens: 0, outputTokens: 0 }

  return (event: PiEvent) =>
    Effect.gen(function* () {
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
            yield* config.onLog({ event: "llm_message", text, step_id: config.stepId })
          }
          break
        case "tool_execution_start":
          buffer = ""
          yield* config.onLog({ event: "tool_call", tool: event.toolName ?? "unknown", input: event.args ?? {}, step_id: config.stepId })
          break
        case "tool_execution_end":
          yield* config.onLog({ event: "tool_result", tool: event.toolName ?? "unknown", isError: event.isError ?? false, step_id: config.stepId })
          break
        case "turn_end":
          const current = config.getSessionStats()
          const tokensIn = current.inputTokens - lastStats.inputTokens
          const tokensOut = current.outputTokens - lastStats.outputTokens
          lastStats = current
          yield* config.onLog({ event: "turn_end", tokens_in: tokensIn, tokens_out: tokensOut, step_id: config.stepId })
          yield* config.onTokenEvent({ runId: config.runId, stepId: config.stepId, tokensIn, tokensOut })
          break
      }
    })
}