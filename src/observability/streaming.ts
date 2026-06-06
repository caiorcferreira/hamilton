import { Effect } from "effect"

export interface PiEvent {
  type: string
  toolName?: string
  toolCall?: { input: Record<string, unknown> }
  isError?: boolean
  assistantMessageEvent?: { type: string; delta?: string }
  tokenUsage?: { input: number; output: number }
  [key: string]: unknown
}

export interface SubscribeConfig {
  runId: string
  stepId: string
  onLog: (event: Record<string, unknown>) => Effect.Effect<void>
  onTokenEvent: (params: { runId: string; stepId: string; tokensIn: number; tokensOut: number }) => Effect.Effect<void>
}

export function subscribePiEvents(config: SubscribeConfig): (event: PiEvent) => Effect.Effect<void> {
  return (event: PiEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
            yield* config.onLog({ event: "llm_delta", delta: event.assistantMessageEvent.delta, step_id: config.stepId })
          }
          break
        case "tool_execution_start":
          yield* config.onLog({ event: "tool_call", tool: event.toolName ?? "unknown", input: event.toolCall?.input ?? {}, step_id: config.stepId })
          break
        case "tool_execution_end":
          yield* config.onLog({ event: "tool_result", tool: event.toolName ?? "unknown", isError: event.isError ?? false, step_id: config.stepId })
          break
        case "turn_end":
          const tokensIn = event.tokenUsage?.input ?? 0
          const tokensOut = event.tokenUsage?.output ?? 0
          yield* config.onLog({ event: "turn_end", tokens_in: tokensIn, tokens_out: tokensOut, step_id: config.stepId })
          yield* config.onTokenEvent({ runId: config.runId, stepId: config.stepId, tokensIn, tokensOut })
          break
      }
    })
}