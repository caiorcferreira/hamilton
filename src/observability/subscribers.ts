import { Effect } from "effect"
import { Event, createSubscriber } from "../events/bus.js"
import { appendStepLog } from "./run-dir.js"

export const FileLogger = createSubscriber(
  (bus) => bus.subscribeAll,
  (event: Event) => {
    if ("stepId" in event && event.stepId) {
      return appendStepLog(event.runId, event.stepId, formatForFile(event)).pipe(
        Effect.catchAll(() => Effect.void)
      )
    }
    return Effect.void
  }
)

function formatForFile(event: Event): Record<string, unknown> {
  switch (event._tag) {
    case "LlmMessage":
      return { event: "llm_message", text: event.text, step_id: event.stepId }
    case "ToolCall":
      return { event: "tool_call", tool: event.tool, input: event.input, step_id: event.stepId }
    case "ToolResult":
      return { event: "tool_result", tool: event.tool, isError: event.isError, step_id: event.stepId }
    case "TurnEnd":
      return { event: "turn_end", tokens_in: event.tokensIn, tokens_out: event.tokensOut, step_id: event.stepId }
    case "TokenUsage":
      return { event: "token_usage", tokens_in: event.tokensIn, tokens_out: event.tokensOut, step_id: event.stepId }
    default:
      return { ...event }
  }
}