import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Stream } from "effect"
import { subscribePiEvents, type PiEvent } from "../../../src/executors/pi/streaming.js"
import { Event, EventBus, EventBusLive } from "../../../src/events/bus.js"

describe("subscribePiEvents", () => {
  let sessionStats: { inputTokens: number; outputTokens: number }
  let handler: (event: PiEvent) => Effect.Effect<void, never, EventBus>

  beforeEach(() => {
    sessionStats = { inputTokens: 0, outputTokens: 0 }
    handler = subscribePiEvents("run-1", "task-1", () => sessionStats)
  })

  it("publishes ToolCall event on tool_execution_start", async () => {
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
        yield* _(handler({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    expect(collected).toHaveLength(1)
    expect(collected[0]._tag).toBe("ToolCall")
  })

  it("publishes LlmMessage event on message_end with buffered text", async () => {
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
        yield* _(handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } }))
        yield* _(handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } }))
        yield* _(handler({ type: "message_end" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const llmMsg = collected.find((e) => e._tag === "LlmMessage")
    expect(llmMsg).toBeDefined()
  })

  it("publishes TurnEnd and TokenUsage on turn_end with computed deltas", async () => {
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
        yield* _(handler({ type: "turn_end" }))

        sessionStats = { inputTokens: 250, outputTokens: 120 }
        yield* _(handler({ type: "turn_end" }))

        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const turnEnds = collected.filter((e) => e._tag === "TurnEnd")
    expect(turnEnds).toHaveLength(2)
    if (turnEnds[0]?._tag === "TurnEnd") {
      expect(turnEnds[0].tokensIn).toBe(100)
      expect(turnEnds[0].tokensOut).toBe(50)
    }
    if (turnEnds[1]?._tag === "TurnEnd") {
      expect(turnEnds[1].tokensIn).toBe(150)
      expect(turnEnds[1].tokensOut).toBe(70)
    }

    const tokenUsages = collected.filter((e) => e._tag === "TokenUsage")
    expect(tokenUsages).toHaveLength(2)
  })

  it("resets buffer on tool_execution_start", async () => {
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
        yield* _(handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Some text" } }))
        yield* _(handler({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } }))
        yield* _(handler({ type: "message_end" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const llmMsgs = collected.filter((e) => e._tag === "LlmMessage")
    expect(llmMsgs).toHaveLength(0)
  })

  it("does not emit LlmMessage when buffer is empty on message_end", async () => {
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
        yield* _(handler({ type: "message_end" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const llmMsgs = collected.filter((e) => e._tag === "LlmMessage")
    expect(llmMsgs).toHaveLength(0)
  })
})