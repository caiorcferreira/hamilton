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

export function formatForFile(event: Event): Record<string, unknown> {
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
    case "TaskStarted":
      return { event: "task_started", task_id: event.taskId }
    case "TaskCompleted":
      return { event: "task_completed", task_id: event.taskId }
    case "TaskFailed":
      return { event: "task_failed", task_id: event.taskId, message: event.message }
    case "TaskTimedOut":
      return { event: "task_timed_out", task_id: event.taskId }
    case "TaskRetrying":
      return { event: "task_retrying", task_id: event.taskId }
    case "TaskPaused":
      return { event: "task_paused", task_id: event.taskId }
    case "PromptBuilt":
      return { event: "prompt_built", task_id: event.taskId, system_prompt: event.systemPrompt, task_prompt: event.taskPrompt }
    case "TurnStarted":
      return { event: "turn_started", task_id: event.taskId, turn_id: event.turnId, turn_index: event.turnIndex, timestamp: event.timestamp }
    case "ProviderRequestStarted":
      return { event: "provider_request_started", task_id: event.taskId, turn_id: event.turnId, request_id: event.requestId, provider: event.provider, model: event.model, payload_summary: event.payloadSummary, timestamp: event.timestamp }
    case "ModelSelected":
      return { event: "model_selected", task_id: event.taskId, provider: event.provider, model: event.model, timestamp: event.timestamp }
    default: {
      const { _tag, ...rest } = event as { _tag: string; [key: string]: unknown }
      return { event: _tag.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(), ...rest }
    }
  }
}