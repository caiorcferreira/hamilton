import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Stream, Scope } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import type { WorkflowSpec } from "../../src/types.js"
import { collectReachableTasks, topologicalSort } from "../../src/workflow/engine.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done", result: "ok" })),
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

const makeAgentFile = (dir: string, name: string): void => {
  const agentDir = Path.join(dir, name)
  Fs.mkdirSync(agentDir, { recursive: true })
  Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), `Agent ${name}`)
  Fs.writeFileSync(Path.join(agentDir, "soul.md"), `Soul for ${name}`)
  Fs.writeFileSync(Path.join(agentDir, "identity.md"), `Identity for ${name}`)
}

const makeSpec = (overrides?: Partial<WorkflowSpec>): WorkflowSpec => ({
  version: 1,
  name: "test-flow",
  run: { entrypoint: "plan", timeout: "300s" },
  agents: [
    { name: "planner", role: "analysis", settings: { systemPrompt: { agent: "agents/planner/AGENTS.md", soul: "agents/planner/soul.md", identity: "agents/planner/identity.md" } } },
    { name: "coder", role: "coding", settings: { systemPrompt: { agent: "agents/coder/AGENTS.md", soul: "agents/coder/soul.md", identity: "agents/coder/identity.md" } } }
  ],
  tasks: [
    { name: "plan", agent: { ref: "agents.planner", prompt: { content: "Plan the feature" } } },
    { name: "implement", dependencies: ["plan"], agent: { ref: "agents.coder", prompt: { content: "Implement it" } } }
  ],
  ...overrides
})

describe("runWorkflow DAG-aware executor", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-runner-dag-"))
    process.env.HOME = tmpHome
    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "agents"), { recursive: true })
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

  it("executes tasks in topological order", async () => {
    const spec = makeSpec()
    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    const started = events.filter(e => e._tag === "StepStarted")
    expect(started.length).toBe(2)

    const planIdx = started.findIndex(e => e._tag === "StepStarted" && e.stepId.includes("plan"))
    const implIdx = started.findIndex(e => e._tag === "StepStarted" && e.stepId.includes("implement"))
    expect(planIdx).toBeLessThan(implIdx)
  })

  it("accumulates task outputs in context under tasks.<name>.outputs", async () => {
    const spec = makeSpec()
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.status).toBe("completed")
    expect(result.context.tasks).toBeDefined()
    expect((result.context.tasks as Record<string, unknown>)["plan"]).toEqual({ outputs: { status: "done", result: "ok" } })
    expect((result.context.tasks as Record<string, unknown>)["implement"]).toEqual({ outputs: { status: "done", result: "ok" } })
  })

  it("resolves agent refs correctly", async () => {
    const events = await collectEvents(
      runWorkflow(makeSpec(), {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    const completed = events.filter(e => e._tag === "StepCompleted")
    expect(completed.length).toBe(2)
  })

  it("publishes WorkflowStarted and WorkflowCompleted events", async () => {
    const events = await collectEvents(
      runWorkflow(makeSpec(), {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    expect(events[0]._tag).toBe("WorkflowStarted")
    expect(events[events.length - 1]._tag).toBe("WorkflowCompleted")
  })

  it("handles linear chain with 3 tasks", async () => {
    const spec = makeSpec({
      tasks: [
        { name: "plan", agent: { ref: "agents.planner", prompt: { content: "Plan" } } },
        { name: "code", dependencies: ["plan"], agent: { ref: "agents.coder", prompt: { content: "Code" } } },
        { name: "verify", dependencies: ["code"], agent: { ref: "agents.planner", prompt: { content: "Verify" } } }
      ]
    } as Partial<WorkflowSpec>)

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    const started = events.filter(e => e._tag === "StepStarted")
    expect(started.length).toBe(3)
    const names = started.map(e => {
      const id = (e as any).stepId as string
      if (id.includes("plan")) return "plan"
      if (id.includes("code")) return "code"
      if (id.includes("verify")) return "verify"
      return "unknown"
    })
    const planIdx = names.indexOf("plan")
    const codeIdx = names.indexOf("code")
    const verifyIdx = names.indexOf("verify")
    expect(planIdx).toBeLessThan(codeIdx)
    expect(codeIdx).toBeLessThan(verifyIdx)
  })

  it("handles fan-out pattern (one task depends on two)", async () => {
    const spec = makeSpec({
      run: { entrypoint: "a", timeout: "300s" },
      tasks: [
        { name: "a", agent: { ref: "agents.planner", prompt: { content: "A" } } },
        { name: "b", agent: { ref: "agents.coder", prompt: { content: "B" } } },
        { name: "c", dependencies: ["a", "b"], agent: { ref: "agents.planner", prompt: { content: "C" } } }
      ]
    } as Partial<WorkflowSpec>)

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    const started = events.filter(e => e._tag === "StepStarted")
    expect(started.length).toBe(3)

    const cStarted = started.find(e => (e as any).stepId.includes("-c-"))
    const aCompleted = events.find(e => e._tag === "StepCompleted" && (e as any).stepId.includes("-a-"))
    const bCompleted = events.find(e => e._tag === "StepCompleted" && (e as any).stepId.includes("-b-"))
    expect(cStarted).toBeDefined()
    expect(aCompleted).toBeDefined()
    expect(bCompleted).toBeDefined()
  })

  it("only executes reachable tasks from entrypoint", async () => {
    const spec = makeSpec({
      run: { entrypoint: "plan", timeout: "300s" },
      tasks: [
        { name: "plan", agent: { ref: "agents.planner", prompt: { content: "Plan" } } },
        { name: "implement", dependencies: ["plan"], agent: { ref: "agents.coder", prompt: { content: "Code" } } },
        { name: "orphan", agent: { ref: "agents.coder", prompt: { content: "Orphan" } } }
      ]
    } as Partial<WorkflowSpec>)

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    const started = events.filter(e => e._tag === "StepStarted")
    expect(started.length).toBe(2)
    expect(started.some(e => (e as any).stepId.includes("orphan"))).toBe(false)
  })

  it("stores taskResults for each executed task", async () => {
    const spec = makeSpec()
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.taskResults["plan"]).toBe("done")
    expect(result.taskResults["implement"]).toBe("done")
  })

  it("writes summary file on completion", async () => {
    const spec = makeSpec()
    await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    const runsDir = Path.join(tmpHome, ".hamilton", "runs")
    const runDirs = Fs.readdirSync(runsDir)
    expect(runDirs.length).toBeGreaterThan(0)

    const summaryPath = Path.join(runsDir, runDirs[0]!, "summary.json")
    expect(Fs.existsSync(summaryPath)).toBe(true)
    const summary = JSON.parse(Fs.readFileSync(summaryPath, "utf-8"))
    expect(summary.status).toBe("completed")
    expect(summary.taskResults).toBeDefined()
  })

  it("publishes PromptBuilt events for agent tasks", async () => {
    const events = await collectEvents(
      runWorkflow(makeSpec(), {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    const promptBuilt = events.filter(e => e._tag === "PromptBuilt")
    expect(promptBuilt.length).toBe(2)
  })
})

describe("topological sort + context integration", () => {
  it("topological sort produces valid execution order for DAG with multiple paths", () => {
    const tasks: WorkflowSpec["tasks"] = [
      { name: "setup", agent: { ref: "agents.a", prompt: { content: "" } } },
      { name: "plan", dependencies: ["setup"], agent: { ref: "agents.b", prompt: { content: "" } } },
      { name: "test", dependencies: ["setup"], agent: { ref: "agents.c", prompt: { content: "" } } },
      { name: "deploy", dependencies: ["plan", "test"], agent: { ref: "agents.d", prompt: { content: "" } } }
    ]

    const sorted = topologicalSort(tasks)
    const names = sorted.map(t => t.name)

    expect(names.indexOf("setup")).toBeLessThan(names.indexOf("plan"))
    expect(names.indexOf("setup")).toBeLessThan(names.indexOf("test"))
    expect(names.indexOf("plan")).toBeLessThan(names.indexOf("deploy"))
    expect(names.indexOf("test")).toBeLessThan(names.indexOf("deploy"))
  })

  it("collectReachableTasks excludes unreachable branches", () => {
    const tasks: WorkflowSpec["tasks"] = [
      { name: "a", agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "b", dependencies: ["a"], agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "c", agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "d", dependencies: ["c"], agent: { ref: "agents.x", prompt: { content: "" } } }
    ]

    const reachable = collectReachableTasks(tasks, "a")
    expect(reachable.map(t => t.name)).toEqual(["a", "b"])
  })

  it("collectReachableTasks includes both dependencies and dependents", () => {
    const tasks: WorkflowSpec["tasks"] = [
      { name: "a", agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "b", dependencies: ["a"], agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "c", dependencies: ["b"], agent: { ref: "agents.x", prompt: { content: "" } } }
    ]

    const reachable = collectReachableTasks(tasks, "b")
    expect(reachable.map(t => t.name).sort()).toEqual(["a", "b", "c"])
  })
})

describe("shared/agents symlink verification", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-symlink-runner-"))
    process.env.HOME = tmpHome
    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "agents"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("creates shared/agents symlink when missing before execution", async () => {
    const spec = makeSpec()
    const wfDir = Path.join(tmpHome, ".hamilton", "workflows", spec.name)
    Fs.mkdirSync(wfDir, { recursive: true })

    await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    const linkPath = Path.join(wfDir, "shared", "agents")
    expect(Fs.existsSync(linkPath)).toBe(true)
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
  })

  it("fixes broken shared/agents symlink before execution", async () => {
    const spec = makeSpec()
    const wfDir = Path.join(tmpHome, ".hamilton", "workflows", spec.name)
    Fs.mkdirSync(wfDir, { recursive: true })
    const sharedDir = Path.join(wfDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    const wrongDir = Path.join(tmpHome, "wrong")
    Fs.mkdirSync(wrongDir, { recursive: true })
    Fs.symlinkSync(wrongDir, Path.join(sharedDir, "agents"), "dir")

    await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    const linkPath = Path.join(wfDir, "shared", "agents")
    expect(Fs.readlinkSync(linkPath)).not.toBe(wrongDir)
  })
})