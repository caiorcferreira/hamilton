import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Stream } from "effect"
import { subscribePiEvents, mapMessageEndToEvent, mapTurnEndToEvents, type PiEvent } from "../../../src/executors/pi/streaming.js"
import { Event, EventBus, EventBusLive } from "../../../src/events/bus.js"

describe("mapMessageEndToEvent", () => {
  const runId = "run-1"
  const taskId = "task-1"

  it("returns LlmMessage when message has text content", () => {
    const event: PiEvent = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
        model: "glm-5.1",
        provider: "openai"
      }
    }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(1)
    expect(result[0]._tag).toBe("LlmMessage")
    if (result[0]._tag === "LlmMessage") {
      expect(result[0].text).toBe("Hello world")
      expect(result[0].model).toBe("glm-5.1")
      expect(result[0].provider).toBe("openai")
    }
  })

  it("returns LlmThinking when message has thinking content", () => {
    const event: PiEvent = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Let me think about this..." }],
        model: "glm-5.1",
        provider: "openai"
      }
    }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(1)
    expect(result[0]._tag).toBe("LlmThinking")
    if (result[0]._tag === "LlmThinking") {
      expect(result[0].text).toBe("Let me think about this...")
      expect(result[0].model).toBe("glm-5.1")
      expect(result[0].provider).toBe("openai")
    }
  })

  it("returns empty array when message has no content", () => {
    const event: PiEvent = {
      type: "message_end",
      message: { role: "assistant", content: [] }
    }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(0)
  })

  it("returns empty array when message is undefined", () => {
    const event: PiEvent = { type: "message_end" }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(0)
  })
})

describe("mapTurnEndToEvents", () => {
  const runId = "run-1"
  const taskId = "task-1"
  let lastStats: { inputTokens: number; outputTokens: number }

  beforeEach(() => {
    lastStats = { inputTokens: 50, outputTokens: 30 }
  })

  it("publishes ToolCall events for each tool call in message content", () => {
    const event: PiEvent = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-abc", name: "ls", arguments: { path: "/tmp" } },
        ],
        model: "glm-5.1",
        provider: "openai",
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
        stopReason: "toolUse"
      },
      toolResults: [
        { role: "toolResult", toolCallId: "call-abc", toolName: "ls", content: [{ type: "text", text: "file.txt" }], isError: false }
      ]
    }
    const currentStats = { inputTokens: 150, outputTokens: 80 }
    const results = mapTurnEndToEvents(runId, taskId, event, currentStats, lastStats)

    const toolCalls = results.filter(e => e._tag === "ToolCall")
    expect(toolCalls).toHaveLength(1)
    if (toolCalls[0]._tag === "ToolCall") {
      expect(toolCalls[0].tool).toBe("ls")
      expect(toolCalls[0].toolCallId).toBe("call-abc")
      expect(toolCalls[0].model).toBe("glm-5.1")
      expect(toolCalls[0].provider).toBe("openai")
    }

    const toolResults = results.filter(e => e._tag === "ToolResult")
    expect(toolResults).toHaveLength(1)
    if (toolResults[0]._tag === "ToolResult") {
      expect(toolResults[0].tool).toBe("ls")
      expect(toolResults[0].toolCallId).toBe("call-abc")
      expect(toolResults[0].isError).toBe(false)
    }

    const turnEnd = results.find(e => e._tag === "TurnEnd")
    expect(turnEnd).toBeDefined()
    if (turnEnd?._tag === "TurnEnd") {
      expect(turnEnd.stopReason).toBe("toolUse")
      expect(turnEnd.cacheRead).toBe(0)
      expect(turnEnd.cacheWrite).toBe(0)
      expect(turnEnd.model).toBe("glm-5.1")
      expect(turnEnd.provider).toBe("openai")
    }

    const tokenUsage = results.find(e => e._tag === "TokenUsage")
    expect(tokenUsage).toBeDefined()
    if (tokenUsage?._tag === "TokenUsage") {
      expect(tokenUsage.tokensIn).toBe(100)
      expect(tokenUsage.tokensOut).toBe(50)
    }
  })

  it("handles turn_end with no tool calls and no tool results", () => {
    const event: PiEvent = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        model: "glm-5.1",
        provider: "openai",
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
        stopReason: "stop"
      },
      toolResults: []
    }
    const currentStats = { inputTokens: 150, outputTokens: 80 }
    const results = mapTurnEndToEvents(runId, taskId, event, currentStats, lastStats)

    const toolCalls = results.filter(e => e._tag === "ToolCall")
    expect(toolCalls).toHaveLength(0)
    const toolResults = results.filter(e => e._tag === "ToolResult")
    expect(toolResults).toHaveLength(0)
    const turnEnd = results.find(e => e._tag === "TurnEnd")
    expect(turnEnd).toBeDefined()
    if (turnEnd?._tag === "TurnEnd") {
      expect(turnEnd.stopReason).toBe("stop")
    }
  })
})

describe("subscribePiEvents", () => {
  let sessionStats: { inputTokens: number; outputTokens: number }
  let handler: (event: PiEvent) => Effect.Effect<void, never, EventBus>

  beforeEach(() => {
    sessionStats = { inputTokens: 0, outputTokens: 0 }
    handler = subscribePiEvents("run-1", "task-1", () => sessionStats)
  })

  it("publishes LlmMessage on message_end with text content", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Hello" }], model: "glm-5.1", provider: "openai" }
        }))
        yield* _(Effect.sleep("50 millis"))
      })
    )
    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))
    const llmMsg = collected.find((e) => e._tag === "LlmMessage")
    expect(llmMsg).toBeDefined()
    if (llmMsg?._tag === "LlmMessage") {
      expect(llmMsg.text).toBe("Hello")
      expect(llmMsg.model).toBe("glm-5.1")
      expect(llmMsg.provider).toBe("openai")
    }
  })

  it("publishes ToolCall and ToolResult events from turn_end", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        sessionStats = { inputTokens: 100, outputTokens: 50 }
        yield* _(handler({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "call-xyz", name: "ls", arguments: { path: "/tmp" } }],
            model: "glm-5.1", provider: "openai",
            usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
            stopReason: "toolUse"
          },
          toolResults: [{ role: "toolResult", toolCallId: "call-xyz", toolName: "ls", content: [{ type: "text", text: "file.txt" }], isError: false }]
        }))
        yield* _(Effect.sleep("50 millis"))
      })
    )
    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))
    const toolCalls = collected.filter((e) => e._tag === "ToolCall")
    expect(toolCalls).toHaveLength(1)
    const toolResults = collected.filter((e) => e._tag === "ToolResult")
    expect(toolResults).toHaveLength(1)
  })

  it("does not emit events for message_update", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ignored" } }))
        yield* _(Effect.sleep("50 millis"))
      })
    )
    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))
    expect(collected).toHaveLength(0)
  })
})
