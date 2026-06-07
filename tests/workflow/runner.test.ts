import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Stream } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import type { WorkflowSpec } from "../../src/types.js"
import { WorkflowSlug, AgentSlug, StepSlug } from "../../src/types.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

const testSpec: WorkflowSpec = {
  slug: "test-flow" as WorkflowSlug,
  name: "Test Flow",
  version: 1,
  agents: [
    { slug: "agent-a" as AgentSlug, role: "coding" as const, workspace: { baseDir: ".", files: {} } }
  ],
  steps: [
    { slug: "step-1" as StepSlug, agent: "agent-a" as AgentSlug, input: "Do something" },
    { slug: "step-2" as StepSlug, agent: "agent-a" as AgentSlug, input: "Do another thing" }
  ]
}

describe("runWorkflow", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-runner-"))
    process.env.HOME = tmpHome

    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "agents", "agent-a"), { recursive: true })
    Fs.writeFileSync(Path.join(hh, "agents", "agent-a", "AGENTS.md"), "Test agent")

    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes all steps and returns completed", async () => {
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
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults["step-1"]).toBe("done")
      expect(result.value.stepResults["step-2"]).toBe("done")

      const tags = events.map((e) => e._tag)
      expect(tags).toContain("WorkflowStarted")
      expect(tags).toContain("StepStarted")
      expect(tags).toContain("StepCompleted")
      expect(tags).toContain("WorkflowCompleted")
    }
  })

  it("emits events in correct order", async () => {
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
    expect(events[1]._tag).toBe("StepStarted")
    expect(events[2]._tag).toBe("PromptBuilt")
    expect(events[events.length - 1]._tag).toBe("WorkflowCompleted")
  })

  it("fails when persona not found", async () => {
    const specNoAgent: WorkflowSpec = {
      ...testSpec,
      agents: [
        { slug: "no-such-agent" as AgentSlug, role: "coding" as const, workspace: { baseDir: ".", files: {} } }
      ],
      steps: [
        { slug: "step-1" as StepSlug, agent: "no-such-agent" as AgentSlug, input: "Do something" }
      ]
    }

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(specNoAgent, { task: "test" }, {
          workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})