import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Stream, Scope } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import { FileLogger } from "../../src/observability/subscribers.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolvePersona: vi.fn(() => E.succeed({ agent: "test-agent", soul: "test-soul", identity: "test-identity" })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: {
    settings: { model: "default" },
    systemPrompt: { agent: `${name}/AGENTS.md`, soul: `${name}/SOUL.md`, identity: `${name}/IDENTITY.md` }
  },
  systemPrompt: { agent: `${name}/AGENTS.md`, soul: `${name}/SOUL.md`, identity: `${name}/IDENTITY.md` }
})

const testSpec: WorkflowSpec = {
  metadata: { version: 1, name: "test-flow" },
  spec: {
    run: { entrypoint: "step-1", timeout: "300s" },
    tasks: [
      { name: "step-1", agent: { executorRef: "agent-a", prompt: { content: "Do something" } } },
      { name: "step-2", dependencies: ["step-1"], agent: { executorRef: "agent-a", prompt: { content: "Do another thing" } } }
    ]
  },
  agentRegistry: new Map([
    ["agent-a", makeAgentManifest("agent-a")]
  ])
}

describe("runWorkflow regression tests", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-regression-"))
    process.env.HOME = tmpHome

    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    const piDir = Path.join(hh, "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("publishes PromptBuilt event with systemPrompt and taskPrompt", async () => {
    const events: Event[] = []

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          return yield* _(runWorkflow(testSpec, { task: "test" }, {
            workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
          }))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)

    const promptBuilt = events.find((e) => e._tag === "PromptBuilt")
    expect(promptBuilt).toBeDefined()
    if (promptBuilt && promptBuilt._tag === "PromptBuilt") {
      expect(typeof promptBuilt.systemPrompt).toBe("string")
      expect(typeof promptBuilt.taskPrompt).toBe("string")
      expect(promptBuilt.systemPrompt.length).toBeGreaterThan(0)
    }
  })

  it("writes PromptBuilt event to step logs via FileLogger", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          return yield* runWorkflow(testSpec, { task: "test" }, {
            workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
          })
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)

    const logDir = Path.join(tmpHome, ".hamilton", "runs")
    const runDirs = Fs.readdirSync(logDir)
    expect(runDirs.length).toBeGreaterThan(0)

    const runId = runDirs[0]!
    const logsDir = Path.join(logDir, runId, "logs")
    const logFiles = Fs.readdirSync(logsDir).filter(f => f.endsWith(".jsonl"))
    expect(logFiles.length).toBeGreaterThan(0)

    for (const lf of logFiles) {
      const content = Fs.readFileSync(Path.join(logsDir, lf), "utf-8")
      for (const line of content.trim().split("\n")) {
        if (!line.trim()) continue
        const parsed = JSON.parse(line)
        if (parsed._tag === "PromptBuilt" || parsed.event === "prompt_built") {
          expect(parsed).toHaveProperty("systemPrompt")
          expect(parsed).toHaveProperty("taskPrompt")
          return
        }
      }
    }
  })

  it("emits WorkflowStarted as first event", async () => {
    const events: Event[] = []

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          return yield* _(runWorkflow(testSpec, { task: "test" }, {
            workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
          }))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(events[0]._tag).toBe("WorkflowStarted")
  })

  it("records token events via EventBus TokenUsage subscriber", async () => {
    const tokenEvents: Event[] = []

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeTo("TokenUsage").pipe(
              Stream.tap((e) => Effect.sync(() => tokenEvents.push(e as Event))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          return yield* _(runWorkflow(testSpec, { task: "test" }, {
            workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
          }))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
  })
})