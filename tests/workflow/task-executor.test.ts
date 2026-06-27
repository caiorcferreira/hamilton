import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Ref, Scope, Stream } from "effect"
import { dispatchTask, type TaskExecutionState } from "../../src/workflow/task-executor.js"
import { makeHookRuntime } from "../../src/hook/integration.js"
import { createWorkflowRuntime } from "../../src/workflow/run-state-machine.js"
import { EventBus, EventBusLive, type Event } from "../../src/events/bus.js"
import type { WorkflowSpec, AgentManifest, WorkflowTask } from "../../src/types.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"
import { executeWithPi } from "../../src/executors/pi/pi-executor.js"

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
          guidelineFiles: []
        }))
        return { status: "done" }
      })
    ),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/prompts/system.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() =>
      E.succeed({
        agent: { content: "test-agent", file: "agent.md" },
        soul: { content: "test-soul", file: "soul.md" },
        context: { content: "", file: "context.md" }
      })
    ),
    SystemPromptFragmentsNotFoundError: class SystemPromptFragmentsNotFoundError extends Error {}
  }
})

vi.mock("node:child_process", () => {
  return {
    execSync: vi.fn((cmd: string) => {
      if (cmd === "echo hello") return "hello\n"
      throw Object.assign(new Error("Command failed"), { status: 1, stdout: "", stderr: "error" })
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

const makeSpec = (tasks: WorkflowSpec["spec"]["tasks"]): WorkflowSpec => ({
  metadata: { version: 1, name: "test-task-exec" },
  spec: {
    run: { entrypoint: tasks[0]!.name, timeout: "300s" },
    tasks
  },
  agentRegistry: new Map([
    ["test-agent", makeAgentManifest("test-agent")],
    ["fail-agent", makeAgentManifest("fail-agent")],
    ["timeout-agent", makeAgentManifest("timeout-agent")],
    ["retry-agent", makeAgentManifest("retry-agent")]
  ])
})

const collectEvents = (
  effect: Effect.Effect<unknown, unknown, EventBus | Scope.Scope>
): Promise<Event[]> => {
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

describe("dispatchTask / withTaskLifecycle", () => {
  const stubHookRuntime = makeHookRuntime([])
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-task-exec-"))
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
    vi.mocked(executeWithPi).mockRestore()
  })

  const runDispatch = async (
    task: WorkflowTask,
    spec: WorkflowSpec,
    taskEnv: WorkflowEnv = { tasks: {} },
    stateOverrides: Partial<TaskExecutionState> = {}
  ) => {
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, taskEnv))
    const workflowStatus = await Effect.runPromise(Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("in-progress"))
    const state: TaskExecutionState = {
      workflowStatus,
      taskResults: {},
      workflowEnv: { ...taskEnv },
      fileEnabled: false,
      ...stateOverrides
    }

    const effect = dispatchTask(
      task,
      taskEnv,
      task.name,
      rt,
      spec,
      "",
      [],
      new Map(),
      { strict: false },
      { maxOutputBytes: 1024 * 1024 },
      state,
      stubHookRuntime
    )

    const events = await collectEvents(effect)
    await Effect.runPromise(rt.close())
    return { events, state, rt }
  }

  it("agent task success: TaskStarted then TaskCompleted", async () => {
    const task: WorkflowTask = {
      name: "success-task",
      agent: { executorRef: "test-agent", prompt: { content: "Do something" } }
    }
    const spec = makeSpec([task])

    const { events, state } = await runDispatch(task, spec)

    const tags = events.map(e => e._tag)
    expect(tags).toContain("TaskStarted")
    expect(tags).toContain("TaskCompleted")
    expect(tags).not.toContain("TaskFailed")
    expect(tags).not.toContain("TaskTimedOut")
    expect(state.taskResults["success-task"]).toBe("done")
  })

  it("agent task failure: TaskStarted then TaskFailed", async () => {
    const task: WorkflowTask = {
      name: "fail-task",
      agent: { executorRef: "fail-agent", prompt: { content: "Fail" } }
    }
    const spec = makeSpec([task])

    vi.mocked(executeWithPi).mockImplementation(((config: any) =>
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system",
          taskPrompt: "mock-task",
          guidelineFiles: []
        }))
        return yield* _(Effect.fail(new Error("execution failed")))
      })) as any)

    const { events } = await runDispatch(task, spec)

    const tags = events.map(e => e._tag)
    expect(tags).toContain("TaskStarted")
    expect(tags).toContain("TaskFailed")
    expect(tags).not.toContain("TaskCompleted")

    const failed = events.find(e => e._tag === "TaskFailed")!
    expect(failed._tag).toBe("TaskFailed")
    if (failed._tag === "TaskFailed") {
      expect(failed.message).toContain("execution failed")
    }
  })

  it("agent task timeout: TaskStarted then TaskTimedOut", async () => {
    const task: WorkflowTask = {
      name: "timeout-task",
      agent: { executorRef: "timeout-agent", prompt: { content: "Timeout" } }
    }
    const spec = makeSpec([task])

    vi.mocked(executeWithPi).mockImplementation(((config: any) =>
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system",
          taskPrompt: "mock-task",
          guidelineFiles: []
        }))
        return undefined as any
      })) as any)

    const { events, state } = await runDispatch(task, spec)

    const tags = events.map(e => e._tag)
    expect(tags).toContain("TaskStarted")
    expect(tags).toContain("TaskTimedOut")
    expect(tags).not.toContain("TaskCompleted")
    expect(tags).not.toContain("TaskFailed")

    const ws = await Effect.runPromise(Ref.get(state.workflowStatus))
    expect(ws).toBe("failed")
  })

  it("script task success: TaskStarted then TaskCompleted", async () => {
    const task: WorkflowTask = {
      name: "hello-task",
      script: { command: "echo hello" }
    }
    const spec = makeSpec([task])

    const { events, state } = await runDispatch(task, spec)

    const tags = events.map(e => e._tag)
    expect(tags).toContain("TaskStarted")
    expect(tags).toContain("TaskCompleted")
    expect(tags).not.toContain("TaskFailed")

    expect(state.taskResults["hello-task"]).toBe("done")
  })

  it("script task failure: TaskStarted then TaskFailed", async () => {
    const task: WorkflowTask = {
      name: "fail-script",
      script: { command: "exit 1" }
    }
    const spec = makeSpec([task])

    const { events } = await runDispatch(task, spec)

    const tags = events.map(e => e._tag)
    expect(tags).toContain("TaskStarted")
    expect(tags).toContain("TaskFailed")
    expect(tags).not.toContain("TaskCompleted")
  })

  it("task retry events: TaskRetrying published on each retry", async () => {
    let callCount = 0
    vi.mocked(executeWithPi).mockImplementation(((config: any) =>
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        callCount++
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system",
          taskPrompt: "mock-task",
          guidelineFiles: []
        }))
        if (callCount < 3) {
          return yield* _(Effect.fail(new Error("transient failure")))
        }
        return { status: "done" }
      })) as any)

    const task: WorkflowTask = {
      name: "retry-task",
      agent: { executorRef: "retry-agent", prompt: { content: "Retry me" }, on_failure: { max_retries: 3 } }
    }
    const spec = makeSpec([task])

    const { events, state } = await runDispatch(task, spec)

    const tags = events.map(e => e._tag)
    expect(tags).toContain("TaskStarted")
    expect(tags).toContain("TaskRetrying")
    expect(tags).toContain("TaskCompleted")

    const retrying = events.filter(e => e._tag === "TaskRetrying")
    expect(retrying.length).toBeGreaterThanOrEqual(1)

    expect(state.taskResults["retry-task"]).toBe("done")
  })
})