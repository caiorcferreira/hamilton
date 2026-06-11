import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { EventBus, EventBusLive } from "../../src/events/bus.js"
import { FileLogger } from "../../src/observability/subscribers.js"

describe("FileLogger", () => {
  it("writes task-scoped events to appendTaskLog via JSONL", async () => {
    const tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-filelogger-"))
    const origHome = process.env.HOME
    process.env.HOME = tmpHome

    try {
      Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "runs", "r1", "logs"), { recursive: true })

      const program = Effect.scoped(
        Effect.gen(function* (_) {
          yield* FileLogger
          yield* _(Effect.sleep("10 millis"))
          const bus = yield* _(EventBus)
          yield* _(bus.publish({ _tag: "LlmMessage", runId: "r1", taskId: "s1", text: "hello" }))
          yield* _(bus.publish({ _tag: "ToolCall", runId: "r1", taskId: "s1", tool: "bash", input: { cmd: "ls" } }))
          yield* _(Effect.sleep("50 millis"))
        })
      )

      await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

      const logPath = Path.join(tmpHome, ".hamilton", "runs", "r1", "logs", "s1.jsonl")
      const content = Fs.readFileSync(logPath, "utf-8").trim().split("\n")
      expect(content).toHaveLength(2)

      const e1 = JSON.parse(content[0]!)
      expect(e1.event).toBe("llm_message")
      expect(e1.text).toBe("hello")

      const e2 = JSON.parse(content[1]!)
      expect(e2.event).toBe("tool_call")
      expect(e2.tool).toBe("bash")
    } finally {
      process.env.HOME = origHome
      Fs.rmSync(tmpHome, { recursive: true, force: true })
    }
  })
})