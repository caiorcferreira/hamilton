import { Effect } from "effect"
import { Event, createSubscriber } from "../events/bus.js"
import { appendTaskLog } from "./run-dir.js"

export const FileLogger = createSubscriber(
  (bus) => bus.subscribeAll,
  (event: Event) => {
    if ("taskId" in event && event.taskId) {
      return appendTaskLog(event.runId, event.taskId, formatForFile(event)).pipe(
        Effect.catchAll(() => Effect.void)
      )
    }
    return Effect.void
  }
)

function formatForFile(event: Event): Record<string, unknown> {
  switch (event._tag) {
    case "LlmMessage":
      return { event: "llm_message", text: event.text, task_id: event.taskId }
    case "ToolCall":
      return { event: "tool_call", tool: event.tool, input: event.input, task_id: event.taskId }
    case "ToolResult":
      return { event: "tool_result", tool: event.tool, isError: event.isError, task_id: event.taskId }
    case "TurnEnd":
      return { event: "turn_end", tokens_in: event.tokensIn, tokens_out: event.tokensOut, task_id: event.taskId }
    case "TokenUsage":
      return { event: "token_usage", tokens_in: event.tokensIn, tokens_out: event.tokensOut, task_id: event.taskId }
    default:
      return { ...event }
  }
}