import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { subscribePiEvents, type PiEvent, type SubscribeConfig } from "../../src/observability/streaming.js"

describe("subscribePiEvents", () => {
  const onLogCalls: Record<string, unknown>[] = []
  const onTokenCalls: { runId: string; stepId: string; tokensIn: number; tokensOut: number }[] = []

  let config: SubscribeConfig
  let handler: ReturnType<typeof subscribePiEvents>

  beforeEach(() => {
    onLogCalls.length = 0
    onTokenCalls.length = 0

    config = {
      runId: "run-1",
      stepId: "step-1",
      onLog: (event) => {
        onLogCalls.push(event)
        return Effect.succeed(undefined)
      },
      onTokenEvent: (params) => {
        onTokenCalls.push(params)
        return Effect.succeed(undefined)
      }
    }

    handler = subscribePiEvents(config)
  })

  it("returns a function", () => {
    expect(typeof handler).toBe("function")
  })

  it("handles tool_execution_start events", async () => {
    const event: PiEvent = {
      type: "tool_execution_start",
      toolName: "bash",
      args: { command: "ls" }
    }
    await Effect.runPromise(handler(event))
    expect(onLogCalls).toHaveLength(1)
    expect(onLogCalls[0]).toEqual({
      event: "tool_call",
      tool: "bash",
      input: { command: "ls" },
      step_id: "step-1"
    })
  })

  it("handles turn_end with token tracking", async () => {
    const event: PiEvent = {
      type: "turn_end",
      tokenUsage: { input: 100, output: 50 }
    }
    await Effect.runPromise(handler(event))
    expect(onLogCalls).toHaveLength(1)
    expect(onLogCalls[0]).toEqual({
      event: "turn_end",
      tokens_in: 100,
      tokens_out: 50,
      step_id: "step-1"
    })
    expect(onTokenCalls).toHaveLength(1)
    expect(onTokenCalls[0]).toEqual({
      runId: "run-1",
      stepId: "step-1",
      tokensIn: 100,
      tokensOut: 50
    })
  })

  it("buffers text deltas and emits full message on message_end", async () => {
    const delta1: PiEvent = {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello" }
    }
    const delta2: PiEvent = {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: " world" }
    }
    const messageEnd: PiEvent = {
      type: "message_end"
    }

    await Effect.runPromise(handler(delta1))
    await Effect.runPromise(handler(delta2))
    expect(onLogCalls).toHaveLength(0)

    await Effect.runPromise(handler(messageEnd))
    expect(onLogCalls).toHaveLength(1)
    expect(onLogCalls[0]).toEqual({
      event: "llm_message",
      text: "Hello world",
      step_id: "step-1"
    })
  })

  it("does not emit llm_message when buffer is empty on message_end", async () => {
    const messageEnd: PiEvent = {
      type: "message_end"
    }
    await Effect.runPromise(handler(messageEnd))
    expect(onLogCalls).toHaveLength(0)
  })

  it("resets buffer on tool_execution_start", async () => {
    const delta: PiEvent = {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Some text" }
    }
    const toolStart: PiEvent = {
      type: "tool_execution_start",
      toolName: "bash",
      args: { command: "ls" }
    }
    const messageEnd: PiEvent = {
      type: "message_end"
    }

    await Effect.runPromise(handler(delta))
    await Effect.runPromise(handler(toolStart))
    expect(onLogCalls).toHaveLength(1)
    expect(onLogCalls[0]).toEqual({
      event: "tool_call",
      tool: "bash",
      input: { command: "ls" },
      step_id: "step-1"
    })

    onLogCalls.length = 0
    await Effect.runPromise(handler(messageEnd))
    expect(onLogCalls).toHaveLength(0)
  })
})