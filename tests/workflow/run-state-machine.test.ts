import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect } from "effect"
import { createWorkflowRuntime, EngineError } from "../../src/workflow/run-state-machine.js"
import { getRunById, getTasksByRunId } from "../../src/db/queries.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: {
    settings: { model: "default" },
    systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
  },
  systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
})

const makeSpec = (): WorkflowSpec => ({
  metadata: { name: "test-wf", version: 1 },
  spec: {
    run: { entrypoint: "task-1", timeout: "300s" },
    tasks: [
      { name: "task-1", agent: { executorRef: "agent-a", prompt: { content: "do it" } } },
      { name: "task-2", agent: { executorRef: "agent-b", prompt: { content: "check it" } } }
    ]
  },
  agentRegistry: new Map([
    ["agent-a", makeAgentManifest("agent-a")],
    ["agent-b", makeAgentManifest("agent-b")]
  ])
})

describe("WorkflowRuntime state machine", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-runtime-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
  })

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("starts a new run in running state", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    expect(rt.state).toBe("running")
    expect(rt.runId).toContain("test-wf-")

    const run = getRunById(rt.db, rt.runId)
    expect(run).not.toBeNull()
    expect(run!.status).toBe("running")

    const tasks = getTasksByRunId(rt.db, rt.runId)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].status).toBe("pending")
    expect(tasks[1].status).toBe("pending")
    expect(tasks[0].execution_index).toBeGreaterThanOrEqual(0)
    expect(tasks[1].execution_index).toBeGreaterThanOrEqual(0)
    expect(tasks[0].execution_index).not.toBe(tasks[1].execution_index)

    await Effect.runPromise(rt.close())
  })

  it("shouldExecuteTask returns true for pending tasks", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    const should = await Effect.runPromise(rt.shouldExecuteTask("task-1"))
    expect(should).toBe(true)

    await Effect.runPromise(rt.close())
  })

  it("shouldExecuteTask returns false for completed tasks", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.transitionTask("task-1", "start"))
    await Effect.runPromise(rt.transitionTask("task-1", "complete"))

    const should = await Effect.runPromise(rt.shouldExecuteTask("task-1"))
    expect(should).toBe(false)

    await Effect.runPromise(rt.close())
  })

  it("pause transitions run to paused", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.pause())
    expect(rt.state).toBe("paused")

    const run = getRunById(rt.db, rt.runId)
    expect(run!.status).toBe("paused")

    await Effect.runPromise(rt.close())
  })

  it("resume from existing paused run skips completed tasks", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.transitionTask("task-1", "start"))
    await Effect.runPromise(rt.transitionTask("task-1", "complete"))
    await Effect.runPromise(rt.pause())

    const runId = rt.runId
    await Effect.runPromise(rt.close())

    const resumed = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }, runId))
    expect(resumed.state).toBe("running")

    const resumedTasks = getTasksByRunId(resumed.db, runId)
    expect(resumedTasks).toHaveLength(2)
    for (const t of resumedTasks) {
      expect(t.task_name).not.toBe("")
    }

    const should1 = await Effect.runPromise(resumed.shouldExecuteTask("task-1"))
    expect(should1).toBe(false)

    const should2 = await Effect.runPromise(resumed.shouldExecuteTask("task-2"))
    expect(should2).toBe(true)

    await Effect.runPromise(resumed.close())
  })

  it("complete transitions run to completed", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.transitionTask("task-1", "start"))
    await Effect.runPromise(rt.transitionTask("task-1", "complete"))
    await Effect.runPromise(rt.transitionTask("task-2", "start"))
    await Effect.runPromise(rt.transitionTask("task-2", "complete"))
    await Effect.runPromise(rt.complete())

    expect(rt.state).toBe("completed")

    const run = getRunById(rt.db, rt.runId)
    expect(run!.status).toBe("completed")

    await Effect.runPromise(rt.close())
  })

  it("fail transitions run to failed", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.transitionTask("task-1", "start"))
    await Effect.runPromise(rt.transitionTask("task-1", "fail"))
    await Effect.runPromise(rt.fail("task blew up"))

    expect(rt.state).toBe("failed")

    const run = getRunById(rt.db, rt.runId)
    expect(run!.status).toBe("failed")

    await Effect.runPromise(rt.close())
  })

  it("rejects invalid task transitions", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.transitionTask("task-1", "start"))
    await Effect.runPromise(rt.transitionTask("task-1", "complete"))

    const result = await Effect.runPromiseExit(rt.transitionTask("task-1", "start"))
    expect(result._tag).toBe("Failure")

    await Effect.runPromise(rt.close())
  })

  it("rejects invalid run transitions", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.complete())

    const result = await Effect.runPromiseExit(rt.pause())
    expect(result._tag).toBe("Failure")

    await Effect.runPromise(rt.close())
  })

  it("insertDynamicTask adds a new task at runtime", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { tasks: {} }))

    await Effect.runPromise(rt.insertDynamicTask("dynamic-task", "agent-a", 0))

    const should = await Effect.runPromise(rt.shouldExecuteTask("dynamic-task"))
    expect(should).toBe(true)

    const tasks = getTasksByRunId(rt.db, rt.runId)
    expect(tasks).toHaveLength(3)
    expect(tasks[2].task_name).toBe("dynamic-task")
    expect(tasks[2].execution_index).toBeGreaterThanOrEqual(0)

    await Effect.runPromise(rt.close())
  })
})