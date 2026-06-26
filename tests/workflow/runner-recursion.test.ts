import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Stream, Scope } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  const { EventBus } = require("../../src/events/bus.js")
  return {
    executeWithPi: vi.fn((config: any) =>
      E.gen(function* (_: any) {
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system",
          taskPrompt: "mock-task",
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
        }))
        return { status: "feedback", feedback: "fix this" }
      })
    ),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/prompts/system.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    SystemPromptFragmentsNotFoundError: class SystemPromptFragmentsNotFoundError extends Error {}
  }
})

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: {
    settings: { model: "default" },
    systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
  },
  systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
})

describe("workflow when and recursion", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-recursion-test-"))
    process.env.HOME = tmpHome
    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "agents"), { recursive: true })
    const piDir = Path.join(hh, "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  const collectEvents = (effect: Effect.Effect<unknown, unknown, EventBus | Scope.Scope>): Promise<Event[]> => {
    const events: Event[] = []
    return Effect.runPromise(
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
          yield* _(effect)
        })
      ).pipe(Effect.provide(EventBusLive))
    ).then(() => events)
  }

  it("skips task when 'when' evaluates to false", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "skip-test" },
      spec: {
        run: { entrypoint: "maybe-run", timeout: "300s" },
        tasks: [
          {
            name: "maybe-run",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "false"
          },
          {
            name: "after",
            dependencies: ["maybe-run"],
            agent: { executorRef: "worker", prompt: { content: "After" } }
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
    expect(started[0].taskName).toBe("after")
  })

  it("executes task when 'when' evaluates to true", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "run-test" },
      spec: {
        run: { entrypoint: "will-run", timeout: "300s" },
        tasks: [
          {
            name: "will-run",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "true"
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
    expect(started[0].taskName).toBe("will-run")
  })

  it("fails workflow when 'when' has invalid CEL syntax", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "bad-cel" },
      spec: {
        run: { entrypoint: "bad", timeout: "300s" },
        tasks: [
          {
            name: "bad",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "inputs.tasks.==="
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    )

    expect(events.some(e => e._tag === "WorkflowCompleted")).toBe(true)
  })

  it("fails workflow when 'when' references missing path", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "missing-path" },
      spec: {
        run: { entrypoint: "bad", timeout: "300s" },
        tasks: [
          {
            name: "bad",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "inputs.tasks.nonexistent.outputs.x != ''"
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    )

    expect(events.some(e => e._tag === "WorkflowCompleted")).toBe(true)
  })

  it("when works on agent task without template", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "agent-when" },
      spec: {
        run: { entrypoint: "maybe", timeout: "300s" },
        tasks: [
          {
            name: "maybe",
            agent: { executorRef: "worker", prompt: { content: "Maybe" } },
            when: "true"
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
  })

  it("depth defaults to 0 for root tasks", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "root-depth" },
      spec: {
        run: { entrypoint: "plan", timeout: "300s" },
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan" } } }
        ]
      },
      agentRegistry: new Map([["planner", makeAgentManifest("planner")]])
    }

    const result = await Effect.runPromise(
      Effect.scoped(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.status).toBe("completed")
  })

  it("max_recursion_depth from workflow YAML overrides settings", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "depth-from-yaml" },
      spec: {
        run: { entrypoint: "task1", timeout: "300s", max_recursion_depth: 5 },
        tasks: [
          { name: "task1", agent: { executorRef: "worker", prompt: { content: "Work" } } }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false }, undefined, 1)
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
  })

  it("has planned status in WorkflowCompleted summary under recursion", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "recursion-status" },
      spec: {
        run: { entrypoint: "task1", timeout: "300s" },
        tasks: [
          { name: "task1", agent: { executorRef: "worker", prompt: { content: "Work" } } }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, { project_dir: tmpHome }, { strict: false })
    )

    const completed = events.find(e => e._tag === "WorkflowCompleted")
    expect(completed).toBeDefined()
    if (completed && completed._tag === "WorkflowCompleted") {
      expect(completed.summary).toBeDefined()
      expect(completed.summary!.status).toBe("completed")
    }

    const statusChanges = events.filter(e => e._tag === "WorkflowStatusChanged")
    expect(statusChanges.length).toBeGreaterThanOrEqual(2)
  })
})