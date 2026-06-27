import { describe, it, expect } from "vitest"
import { Effect, Stream } from "effect"
import { Event, EventBus, EventBusLive, EventBusSubscriptionOperations, SubscriptionSelector, createSubscriber } from "../../src/events/bus.js"

describe("EventBus", () => {
  describe("publish + subscribeAll", () => {
    it("delivers published events to subscribeAll", async () => {
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

          yield* _(bus.publish({ _tag: "WorkflowStarted", runId: "r1" }))
          yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "s1" }))
          yield* _(Effect.sleep("50 millis"))
        })
      )

      await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

      expect(collected).toHaveLength(2)
      expect(collected[0]._tag).toBe("WorkflowStarted")
      expect(collected[1]._tag).toBe("TaskStarted")
    })
  })

  describe("subscribeTo", () => {
    it("filters events by tag", async () => {
      const collected: Event[] = []

      const program = Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)

          yield* _(Effect.forkScoped(
            bus.subscribeTo("TokenUsage").pipe(
              Stream.tap((e) => Effect.sync(() => collected.push(e))),
              Stream.runDrain
            )
          ))

          yield* _(Effect.sleep("10 millis"))

          yield* _(bus.publish({ _tag: "WorkflowStarted", runId: "r1" }))
          yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", taskId: "s1", tokensIn: 100, tokensOut: 50 }))
          yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "s1" }))
          yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", taskId: "s1", tokensIn: 200, tokensOut: 100 }))
          yield* _(Effect.sleep("50 millis"))
        })
      )

      await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

      expect(collected).toHaveLength(2)
      expect(collected.every((e) => e._tag === "TokenUsage")).toBe(true)
      expect(collected[0]).toEqual({ _tag: "TokenUsage", runId: "r1", taskId: "s1", tokensIn: 100, tokensOut: 50 })
    })

    it("accepts TokenUsage without runId or taskId", async () => {
      const collected: Event[] = []

      const program = Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)

          yield* _(Effect.forkScoped(
            bus.subscribeTo("TokenUsage").pipe(
              Stream.tap((e) => Effect.sync(() => collected.push(e))),
              Stream.runDrain
            )
          ))

          yield* _(Effect.sleep("10 millis"))

          yield* _(bus.publish({ _tag: "TokenUsage", tokensIn: 50, tokensOut: 25 }))
          yield* _(Effect.sleep("50 millis"))
        })
      )

      await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

      expect(collected).toHaveLength(1)
      expect(collected[0]).toEqual({ _tag: "TokenUsage", tokensIn: 50, tokensOut: 25 })
    })
  })
})

describe("createSubscriber", () => {
  it("calls handler for each matching event", async () => {
    const collected: string[] = []

    const testSubscriber = createSubscriber(
      ((bus: EventBusSubscriptionOperations) => bus.subscribeTo("TaskStarted")) as SubscriptionSelector<Extract<Event, { _tag: "TaskStarted" }>>,
      (event) => Effect.sync(() => { collected.push(event.taskId) })
    )

    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* testSubscriber
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "task-a" }))
        yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "task-b" }))
        yield* _(bus.publish({ _tag: "TaskCompleted", runId: "r1", taskId: "task-a" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    expect(collected).toEqual(["task-a", "task-b"])
  })

  it("isolates handler errors so one failure does not stop the subscriber", async () => {
    const collected: string[] = []

    const testSubscriber = createSubscriber(
      (bus: EventBusSubscriptionOperations) => bus.subscribeAll,
      (event): Effect.Effect<void> => {
        if (event._tag === "TaskStarted" && event.taskId === "fail-here") {
          return Effect.fail(new Error("boom")) as unknown as Effect.Effect<void>
        }
        return Effect.sync(() => { collected.push(event._tag) })
      }
    )

    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* testSubscriber
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "fail-here" }))
        yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "task-b" }))
        yield* _(bus.publish({ _tag: "TaskCompleted", runId: "r1", taskId: "task-c" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    expect(collected).toEqual(["TaskStarted", "TaskCompleted"])
  })
})