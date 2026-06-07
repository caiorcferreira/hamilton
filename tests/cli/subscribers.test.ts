import { describe, it, expect } from "vitest"
import { Effect, Console } from "effect"
import { EventBus, EventBusLive } from "../../src/events/bus.js"
import { CliRenderer } from "../../src/cli/subscribers.js"

describe("CliRenderer", () => {
  it("prints formatted events to console", async () => {
    const logs: string[] = []
    const testConsole: Console.Console = {
      [Console.TypeId]: Console.TypeId,
      assert: () => Effect.void,
      clear: Effect.void,
      count: () => Effect.void,
      countReset: () => Effect.void,
      debug: (...s: ReadonlyArray<any>) => Effect.sync(() => { logs.push(s.join(" ")) }),
      dir: () => Effect.void,
      dirxml: () => Effect.void,
      error: (...s: ReadonlyArray<any>) => Effect.sync(() => { logs.push(s.join(" ")) }),
      group: () => Effect.void,
      groupEnd: Effect.void,
      info: (...s: ReadonlyArray<any>) => Effect.sync(() => { logs.push(s.join(" ")) }),
      log: (...s: ReadonlyArray<any>) => Effect.sync(() => { logs.push(s.join(" ")) }),
      table: () => Effect.void,
      time: () => Effect.void,
      timeEnd: () => Effect.void,
      timeLog: () => Effect.void,
      trace: () => Effect.void,
      warn: (...s: ReadonlyArray<any>) => Effect.sync(() => { logs.push(s.join(" ")) }),
      unsafe: {
        assert: () => {},
        clear: () => {},
        count: () => {},
        countReset: () => {},
        debug: () => {},
        dir: () => {},
        dirxml: () => {},
        error: () => {},
        group: () => {},
        groupCollapsed: () => {},
        groupEnd: () => {},
        info: () => {},
        log: () => {},
        table: () => {},
        time: () => {},
        timeEnd: () => {},
        timeLog: () => {},
        trace: () => {},
        warn: () => {}
      }
    }

    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* CliRenderer
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "WorkflowStarted", runId: "r1" }))
        yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "s1" }))
        yield* _(bus.publish({ _tag: "StepCompleted", runId: "r1", stepId: "s1" }))
        yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: "r1" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(
      Console.withConsole(testConsole)(program).pipe(
        Effect.provide(EventBusLive)
      )
    )

    expect(logs[0]).toContain("r1")
    expect(logs[1]).toContain("s1")
    expect(logs.some((l) => l.includes("completed"))).toBe(true)
    expect(logs.some((l) => l.includes("finished"))).toBe(true)
  })
})