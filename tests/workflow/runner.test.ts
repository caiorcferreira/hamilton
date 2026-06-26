import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Stream, Scope } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"
import { collectReachableTasks, topologicalSort } from "../../src/workflow/engine.js"

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
          systemPrompt: "mock-system-prompt",
          taskPrompt: `mock-task: ${config.taskId}`,
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
        }))
        return { status: "done" }
      })
    ),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})

vi.mock("node:child_process", () => {
  return {
    execSync: vi.fn((cmd: string) => {
      if (cmd === "echo hello") return "hello\n"
      if (cmd === "exit 1") throw Object.assign(new Error("Command failed"), { status: 1, stdout: "", stderr: "error" })
      if (cmd === "pwd") return "/test/workdir\n"
      if (cmd === "echo test-value") return "test-value\n"
      if (cmd === "slow-command") {
        throw Object.assign(new Error("ETIMEDOUT"), { status: null, stdout: "", stderr: "timeout" })
      }
      if (cmd === "flaky-cmd") {
        const callCount = ((vi as any).flakyCount ?? 0) + 1
        ;(vi as any).flakyCount = callCount
        if (callCount < 2) throw Object.assign(new Error("Flaky fail"), { status: 1, stdout: "", stderr: "flaky" })
        return "success\n"
      }
      if (cmd === "always-fail") throw Object.assign(new Error("Always fails"), { status: 1, stdout: "", stderr: "fail" })
      if (cmd.startsWith("large-output")) {
        return "x".repeat(100000)
      }
      return "ok\n"
    })
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

const makeSpec = (overrides?: Partial<WorkflowSpec>): WorkflowSpec => ({
  metadata: { version: 1, name: "test-flow" },
  spec: {
    run: { entrypoint: "plan", timeout: "300s" },
    tasks: [
      { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan the feature" } } },
      { name: "implement", dependencies: ["plan"], agent: { executorRef: "coder", prompt: { content: "Implement it" } } }
    ]
  },
  agentRegistry: new Map([
    ["planner", makeAgentManifest("planner")],
    ["coder", makeAgentManifest("coder")]
  ]),
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

  it("executes tasks in topological order", async () => {
    const spec = makeSpec()
    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(2)

    const planIdx = started.findIndex(e => e._tag === "TaskStarted" && e.taskId.includes("plan"))
    const implIdx = started.findIndex(e => e._tag === "TaskStarted" && e.taskId.includes("implement"))
    expect(planIdx).toBeLessThan(implIdx)
  })

  it("accumulates task outputs in env under tasks.<name>.outputs", async () => {
    const spec = makeSpec()
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.status).toBe("completed")
    expect(result.env.tasks).toBeDefined()
    expect((result.env.tasks as Record<string, unknown>)["plan"]).toEqual({ outputs: { status: "done" } })
    expect((result.env.tasks as Record<string, unknown>)["implement"]).toEqual({ outputs: { status: "done" } })
  })

  it("resolves agent refs correctly", async () => {
    const events = await collectEvents(
      runWorkflow(makeSpec(), {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const completed = events.filter(e => e._tag === "TaskCompleted")
    expect(completed.length).toBe(2)
  })

  it("publishes WorkflowStarted and WorkflowCompleted events", async () => {
    const events = await collectEvents(
      runWorkflow(makeSpec(), {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    expect(events[0]._tag).toBe("WorkflowStarted")
    expect(events[events.length - 1]._tag).toBe("WorkflowCompleted")
  })

  it("handles linear chain with 3 tasks", async () => {
    const spec: WorkflowSpec = {
      ...makeSpec(),
      spec: {
        ...makeSpec().spec,
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan" } } },
          { name: "code", dependencies: ["plan"], agent: { executorRef: "coder", prompt: { content: "Code" } } },
          { name: "verify", dependencies: ["code"], agent: { executorRef: "planner", prompt: { content: "Verify" } } }
        ]
      }
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(3)
    const names = started.map(e => {
      const id = (e as any).taskId as string
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
    const spec: WorkflowSpec = {
      ...makeSpec(),
      spec: {
        run: { entrypoint: "a", timeout: "300s" },
        tasks: [
          { name: "a", agent: { executorRef: "planner", prompt: { content: "A" } } },
          { name: "b", agent: { executorRef: "coder", prompt: { content: "B" } } },
          { name: "c", dependencies: ["a", "b"], agent: { executorRef: "planner", prompt: { content: "C" } } }
        ]
      }
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(3)

    const cStarted = started.find(e => (e as any).taskId.includes("-c-"))
    const aCompleted = events.find(e => e._tag === "TaskCompleted" && (e as any).taskId.includes("-a-"))
    const bCompleted = events.find(e => e._tag === "TaskCompleted" && (e as any).taskId.includes("-b-"))
    expect(cStarted).toBeDefined()
    expect(aCompleted).toBeDefined()
    expect(bCompleted).toBeDefined()
  })

  it("only executes reachable tasks from entrypoint", async () => {
    const spec: WorkflowSpec = {
      ...makeSpec(),
      spec: {
        run: { entrypoint: "plan", timeout: "300s" },
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan" } } },
          { name: "implement", dependencies: ["plan"], agent: { executorRef: "coder", prompt: { content: "Code" } } },
          { name: "orphan", agent: { executorRef: "coder", prompt: { content: "Orphan" } } }
        ]
      }
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(2)
    expect(started.some(e => (e as any).taskId.includes("orphan"))).toBe(false)
  })

  it("stores taskResults for each executed task", async () => {
    const spec = makeSpec()
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.taskResults["plan"]).toBe("done")
    expect(result.taskResults["implement"]).toBe("done")
  })

  it("writes summary file on completion", async () => {
    const spec = makeSpec()
    await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
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
      runWorkflow(makeSpec(), {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const promptBuilt = events.filter(e => e._tag === "PromptBuilt")
    expect(promptBuilt.length).toBe(2)
  })

  it("injects output schema into task prompt when schema is present", async () => {
    const schemaContent = { type: "object", properties: { status: { type: "string" }, repo: { type: "string" } }, required: ["status"] }
    const spec = makeSpec({
      spec: {
        ...makeSpec().spec,
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan the feature" }, output: { schema: { content: schemaContent } } } },
          { name: "implement", dependencies: ["plan"], agent: { executorRef: "coder", prompt: { content: "Implement it" } } }
        ]
      }
    })

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const promptBuilt = events.filter(e => e._tag === "PromptBuilt")
    expect(promptBuilt.length).toBe(2)
  })
})

describe("topological sort + env integration", () => {
  it("topological sort produces valid execution order for DAG with multiple paths", () => {
    const tasks: WorkflowSpec["spec"]["tasks"] = [
      { name: "setup", agent: { executorRef: "a", prompt: { content: "" } } },
      { name: "plan", dependencies: ["setup"], agent: { executorRef: "b", prompt: { content: "" } } },
      { name: "test", dependencies: ["setup"], agent: { executorRef: "c", prompt: { content: "" } } },
      { name: "deploy", dependencies: ["plan", "test"], agent: { executorRef: "d", prompt: { content: "" } } }
    ]

    const sorted = topologicalSort(tasks)
    const names = sorted.map(t => t.name)

    expect(names.indexOf("setup")).toBeLessThan(names.indexOf("plan"))
    expect(names.indexOf("setup")).toBeLessThan(names.indexOf("test"))
    expect(names.indexOf("plan")).toBeLessThan(names.indexOf("deploy"))
    expect(names.indexOf("test")).toBeLessThan(names.indexOf("deploy"))
  })

  it("collectReachableTasks excludes unreachable branches", () => {
    const tasks: WorkflowSpec["spec"]["tasks"] = [
      { name: "a", agent: { executorRef: "x", prompt: { content: "" } } },
      { name: "b", dependencies: ["a"], agent: { executorRef: "x", prompt: { content: "" } } },
      { name: "c", agent: { executorRef: "x", prompt: { content: "" } } },
      { name: "d", dependencies: ["c"], agent: { executorRef: "x", prompt: { content: "" } } }
    ]

    const reachable = collectReachableTasks(tasks, "a")
    expect(reachable.map(t => t.name)).toEqual(["a", "b"])
  })

  it("collectReachableTasks includes both dependencies and dependents", () => {
    const tasks: WorkflowSpec["spec"]["tasks"] = [
      { name: "a", agent: { executorRef: "x", prompt: { content: "" } } },
      { name: "b", dependencies: ["a"], agent: { executorRef: "x", prompt: { content: "" } } },
      { name: "c", dependencies: ["b"], agent: { executorRef: "x", prompt: { content: "" } } }
    ]

    const reachable = collectReachableTasks(tasks, "b")
    expect(reachable.map(t => t.name).sort()).toEqual(["a", "b", "c"])
  })
})

describe("script task execution", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-script-"))
    process.env.HOME = tmpHome
    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "agents"), { recursive: true })
    const piDir = Path.join(hh, "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }));
    (vi as any).flakyCount = 0
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  const runSpec = (overrides?: Partial<WorkflowSpec>) => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "script-test" },
      spec: {
        run: { entrypoint: "hello", timeout: "300s" },
        tasks: [
          { name: "hello", script: { command: "echo hello" } }
        ]
      },
      agentRegistry: new Map(),
      ...overrides
    }
    return Effect.scoped(runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false }))
      .pipe(Effect.provide(EventBusLive))
  }

  it("executes a simple script command", async () => {
    const result = await Effect.runPromise(runSpec())
    expect(result.status).toBe("completed")
    expect(result.taskResults["hello"]).toBe("done")
  })

  it("captures script output in env.tasks", async () => {
    const result = await Effect.runPromise(runSpec())
    const outputs = (result.env.tasks as Record<string, unknown>)["hello"] as { outputs: Record<string, unknown> }
    expect(outputs.outputs.status).toBe("done")
    expect(outputs.outputs.exitCode).toBe(0)
    expect(outputs.outputs.stdout).toBe("hello")
    expect(outputs.outputs.stderr).toBe("")
  })

  it("handles failed script command", async () => {
    const result = await Effect.runPromise(runSpec({
      spec: {
        run: { entrypoint: "failer", timeout: "300s" },
        tasks: [{ name: "failer", script: { command: "exit 1" } }]
      }
    }))
    expect(result.status).toBe("failed")
  })

  it("runs script in specified workdir", async () => {
    const workdir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "script-wd-"))
    const result = await Effect.runPromise(runSpec({
      spec: {
        run: { entrypoint: "pwd-task", timeout: "300s" },
        tasks: [{ name: "pwd-task", script: { command: "pwd", workdir } }]
      }
    }))
    expect(result.status).toBe("completed")
    const outputs = (result.env.tasks as Record<string, unknown>)["pwd-task"] as { outputs: Record<string, unknown> }
    expect(outputs.outputs.stdout).toContain("workdir")
  })

  it("publishes TaskStarted and TaskCompleted events for scripts", async () => {
    const events: Event[] = []
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "script-test" },
      spec: {
        run: { entrypoint: "hello", timeout: "300s" },
        tasks: [{ name: "hello", script: { command: "echo hello" } }]
      },
      agentRegistry: new Map()
    }
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
          yield* _(runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false }))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    const completed = events.filter(e => e._tag === "TaskCompleted")
    expect(started.length).toBe(1)
    expect(completed.length).toBe(1)
    expect(started[0]!.taskName).toBe("hello")
  })

  it("does not publish PromptBuilt event for script tasks", async () => {
    const events: Event[] = []
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "script-test" },
      spec: {
        run: { entrypoint: "hello", timeout: "300s" },
        tasks: [{ name: "hello", script: { command: "echo hello" } }]
      },
      agentRegistry: new Map()
    }
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
          yield* _(runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false }))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    const promptBuilt = events.filter(e => e._tag === "PromptBuilt")
    expect(promptBuilt.length).toBe(0)
  })

  it("retries script on failure up to max_retries", async () => {
    const result = await Effect.runPromise(runSpec({
      spec: {
        run: { entrypoint: "flaky", timeout: "300s" },
        tasks: [{ name: "flaky", script: { command: "flaky-cmd", on_failure: { max_retries: 3 } } }]
      }
    }))
    expect(result.status).toBe("completed")
    expect(result.taskResults["flaky"]).toBe("done")
  })

  it("fails script after exhausting retries", async () => {
    const result = await Effect.runPromise(runSpec({
      spec: {
        run: { entrypoint: "always-fail", timeout: "300s" },
        tasks: [{ name: "always-fail", script: { command: "always-fail", on_failure: { max_retries: 2 } } }]
      }
    }))
    expect(result.status).toBe("failed")
  })

  it("renders template variables in script command", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "template-test" },
      spec: {
        run: { entrypoint: "echo-task", timeout: "300s" },
        tasks: [
          { name: "setup", script: { command: "echo test-value" } },
          { name: "echo-task", dependencies: ["setup"], script: { command: "echo {{inputs.tasks.setup.outputs.stdout}}" } }
        ]
      },
      agentRegistry: new Map()
    }
    const result = await Effect.runPromise(
      Effect.scoped(runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false }))
        .pipe(Effect.provide(EventBusLive))
    )
    expect(result.status).toBe("completed")
  })

  it("script task can depend on agent task", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "mixed-dag" },
      spec: {
        run: { entrypoint: "plan", timeout: "300s" },
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan" } } },
          { name: "build", dependencies: ["plan"], script: { command: "echo hello" } }
        ]
      },
      agentRegistry: new Map([
        ["planner", makeAgentManifest("planner")]
      ])
    }
    const result = await Effect.runPromise(
      Effect.scoped(runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false }))
        .pipe(Effect.provide(EventBusLive))
    )
    expect(result.status).toBe("completed")
    expect(result.taskResults["plan"]).toBe("done")
    expect(result.taskResults["build"]).toBe("done")
  })

  it("agent task can depend on script task", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "mixed-dag-reverse" },
      spec: {
        run: { entrypoint: "setup", timeout: "300s" },
        tasks: [
          { name: "setup", script: { command: "echo hello" } },
          { name: "plan", dependencies: ["setup"], agent: { executorRef: "planner", prompt: { content: "Plan" } } }
        ]
      },
      agentRegistry: new Map([
        ["planner", makeAgentManifest("planner")]
      ])
    }
    const result = await Effect.runPromise(
      Effect.scoped(runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false }))
        .pipe(Effect.provide(EventBusLive))
    )
    expect(result.status).toBe("completed")
    expect(result.taskResults["setup"]).toBe("done")
    expect(result.taskResults["plan"]).toBe("done")
  })

  it("executes template with nested subtasks and populates env.tasks with instance names", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "template-subtasks" },
      spec: {
        run: { entrypoint: "process", timeout: "300s" },
        tasks: [
          {
            name: "process",
            template: "step",
            arguments: {
              forEach: {
                valueFrom: { ref: "inputs.parameters.items" },
                as: "item"
              }
            }
          },
          {
            name: "step",
            tasks: [
              { name: "build", agent: { executorRef: "builder", prompt: { content: "Build {{inputs.parameters.item}}" } } },
              { name: "check", dependencies: ["build"], agent: { executorRef: "checker", prompt: { content: "Check {{inputs.parameters.item}}" } } }
            ]
          }
        ]
      },
      agentRegistry: new Map([
        ["builder", makeAgentManifest("builder")],
        ["checker", makeAgentManifest("checker")]
      ])
    }
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, { parameters: { items: ["a", "b"] } }, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )
    expect(result.status).toBe("completed")
    expect(result.taskResults["process/0-build"]).toBe("done")
    expect(result.taskResults["process/0-check"]).toBe("done")
    expect(result.taskResults["process/1-build"]).toBe("done")
    expect(result.taskResults["process/1-check"]).toBe("done")
    expect((result.env.tasks as Record<string, unknown>)["process/0-build"]).toBeDefined()
    expect((result.env.tasks as Record<string, unknown>)["process/1-build"]).toBeDefined()
  })

  it("cleans up currentIteration after template iteration completes", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "currentiteration-cleanup" },
      spec: {
        run: { entrypoint: "process", timeout: "300s" },
        tasks: [
          {
            name: "process",
            template: "step",
            arguments: {
              forEach: {
                valueFrom: { ref: "inputs.parameters.items" },
                as: "item"
              }
            }
          },
          {
            name: "step",
            tasks: [
              { name: "build", agent: { executorRef: "builder", prompt: { content: "Build" } } },
              { name: "verify", dependencies: ["build"], agent: { executorRef: "verifier", prompt: { content: "Verify" } } }
            ]
          }
        ]
      },
      agentRegistry: new Map([
        ["builder", makeAgentManifest("builder")],
        ["verifier", makeAgentManifest("verifier")]
      ])
    }
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, { parameters: { items: ["a", "b"] } }, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )
    expect(result.status).toBe("completed")
    expect(result.env.currentIteration).toBeUndefined()
  })

  it("does not leak currentIteration between forEach iterations", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "no-leak-currentiteration" },
      spec: {
        run: { entrypoint: "process", timeout: "300s" },
        tasks: [
          {
            name: "process",
            template: "step",
            arguments: {
              forEach: {
                valueFrom: { ref: "inputs.parameters.items" },
                as: "item"
              }
            }
          },
          {
            name: "step",
            tasks: [
              { name: "build", agent: { executorRef: "builder", prompt: { content: "Build {{inputs.parameters.item}}" } } }
            ]
          }
        ]
      },
      agentRegistry: new Map([
        ["builder", makeAgentManifest("builder")]
      ])
    }
    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, { parameters: { items: ["x", "y", "z"] } }, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )
    expect(result.status).toBe("completed")
    expect(result.taskResults["process/0-build"]).toBe("done")
    expect(result.taskResults["process/1-build"]).toBe("done")
    expect(result.taskResults["process/2-build"]).toBe("done")
    expect(result.env.currentIteration).toBeUndefined()
  })

  it("collectReachableTasks works with script tasks", () => {
    const tasks: WorkflowSpec["spec"]["tasks"] = [
      { name: "a", script: { command: "echo a" } },
      { name: "b", dependencies: ["a"], script: { command: "echo b" } }
    ]
    const reachable = collectReachableTasks(tasks, "a")
    expect(reachable.map(t => t.name)).toEqual(["a", "b"])
  })

  it("topologicalSort works with script tasks", () => {
    const tasks: WorkflowSpec["spec"]["tasks"] = [
      { name: "setup", script: { command: "echo setup" } },
      { name: "build", dependencies: ["setup"], script: { command: "echo build" } }
    ]
    const sorted = topologicalSort(tasks)
    expect(sorted[0]!.name).toBe("setup")
    expect(sorted[1]!.name).toBe("build")
  })
})