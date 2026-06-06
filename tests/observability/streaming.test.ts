import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { subscribePiEvents, type PiEvent, type SubscribeConfig } from "../../src/observability/streaming.js"

describe("subscribePiEvents", () => {
  const onLogCalls: Record<string, unknown>[] = []
  const onTokenCalls: { runId: string; stepId: string; tokensIn: number; tokensOut: number }[] = []

  const config: SubscribeConfig = {
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

  const handler = subscribePiEvents(config)

  beforeEach(() => {
    onLogCalls.length = 0
    onTokenCalls.length = 0
  })

  it("returns a function", () => {
    expect(typeof handler).toBe("function")
  })

  it("handles tool_execution_start events", async () => {
    const event: PiEvent = {
      type: "tool_execution_start",
      toolName: "bash",
      toolCall: { input: { command: "ls" } }
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
})