import { Effect } from "effect"
import { EventBus, type Event } from "../../events/bus.js"

export interface PiEvent {
  type: string
  assistantMessageEvent?: { type: string; delta?: string }
  message?: {
    role?: string
    content?: Array<{
      type: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      arguments?: unknown
    }>
    model?: string
    provider?: string
    api?: string
    usage?: {
      input: number
      output: number
      cacheRead?: number
      cacheWrite?: number
      totalTokens: number
    }
    stopReason?: string
  }
  toolResults?: Array<{
    role: string
    toolCallId: string
    toolName: string
    content?: Array<{ type: string; text?: string }>
    isError: boolean
  }>
  [key: string]: unknown
}

export function mapMessageEndToEvent(runId: string, taskId: string, event: PiEvent): Event[] {
  const content = event.message?.content
  if (!content || content.length === 0) return []

  const model = event.message?.model
  const provider = event.message?.provider

  const events: Event[] = []

  for (const block of content) {
    if (block.type === "text" && block.text && event.message?.role !== "toolResult") {
      events.push({ _tag: "LlmMessage", runId, taskId, text: block.text, model, provider })
    }
    if (block.type === "thinking" && block.thinking) {
      events.push({ _tag: "LlmThinking", runId, taskId, text: block.thinking, model, provider })
    }
  }

  return events
}

export function mapTurnEndToEvents(
  runId: string,
  taskId: string,
  event: PiEvent,
  currentStats: { inputTokens: number; outputTokens: number },
  lastStats: { inputTokens: number; outputTokens: number }
): Event[] {
  const events: Event[] = []

  const model = event.message?.model ?? "unknown"
  const provider = event.message?.provider ?? "unknown"
  const usage = event.message?.usage
  const stopReason = event.message?.stopReason ?? "unknown"
  const cacheRead = usage?.cacheRead ?? 0
  const cacheWrite = usage?.cacheWrite ?? 0

  for (const block of event.message?.content ?? []) {
    if (block.type === "toolCall" && block.id && block.name) {
      events.push({
        _tag: "ToolCall",
        runId,
        taskId,
        tool: block.name,
        input: block.arguments ?? {},
        toolCallId: block.id,
        model,
        provider
      })
    }
  }

  for (const result of event.toolResults ?? []) {
    events.push({
      _tag: "ToolResult",
      runId,
      taskId,
      tool: result.toolName,
      isError: result.isError,
      toolCallId: result.toolCallId
    })
  }

  const tokensIn = currentStats.inputTokens - lastStats.inputTokens
  const tokensOut = currentStats.outputTokens - lastStats.outputTokens

  events.push({
    _tag: "TurnEnd",
    runId,
    taskId,
    tokensIn,
    tokensOut,
    stopReason,
    cacheRead,
    cacheWrite,
    model,
    provider
  })

  events.push({
    _tag: "TokenUsage",
    runId,
    taskId,
    tokensIn,
    tokensOut
  })

  return events
}

export function subscribePiEvents(
  runId: string,
  taskId: string,
  getSessionStats: () => { inputTokens: number; outputTokens: number }
): (event: PiEvent) => Effect.Effect<void, never, EventBus> {
  let lastStats = { inputTokens: 0, outputTokens: 0 }

  return (event: PiEvent) =>
    Effect.gen(function* (_) {
      const bus = yield* _(EventBus)

      switch (event.type) {
        case "message_end": {
          const events = mapMessageEndToEvent(runId, taskId, event)
          for (const ev of events) {
            yield* _(bus.publish(ev))
          }
          break
        }
        case "turn_end": {
          const current = getSessionStats()
          const events = mapTurnEndToEvents(runId, taskId, event, current, lastStats)
          lastStats = current
          for (const ev of events) {
            yield* _(bus.publish(ev))
          }
          break
        }
      }
    })
}
