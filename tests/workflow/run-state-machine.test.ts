import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect } from "effect"
import { createWorkflowRuntime, EngineError } from "../../src/workflow/run-state-machine.js"
import { getRunById, getStepsByRunId, updateStepCompleted } from "../../src/db/queries.js"
import type { WorkflowSpec } from "../../src/types.js"
import { WorkflowSlug, AgentSlug, StepSlug } from "../../src/types.js"

const makeSpec = (): WorkflowSpec => ({
  slug: "test-wf" as WorkflowSlug,
  name: "Test",
  version: 1,
  agents: [
    { slug: "a" as AgentSlug, role: "coding", workspace: { baseDir: "x", files: {} } },
    { slug: "b" as AgentSlug, role: "verification", workspace: { baseDir: "y", files: {} } }
  ],
  steps: [
    { slug: "step-1" as StepSlug, agent: "a" as AgentSlug, input: "do it" },
    { slug: "step-2" as StepSlug, agent: "b" as AgentSlug, input: "check it" }
  ]
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
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    expect(rt.state).toBe("running")
    expect(rt.runId).toContain("test-wf-")

    const run = getRunById(rt.db, rt.runId)
    expect(run).not.toBeNull()
    expect(run!.status).toBe("running")

    const steps = getStepsByRunId(rt.db, rt.runId)
    expect(steps).toHaveLength(2)
    expect(steps[0].status).toBe("pending")
    expect(steps[1].status).toBe("pending")

    await Effect.runPromise(rt.close())
  })

  it("shouldExecuteStep returns true for pending steps", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    const should = await Effect.runPromise(rt.shouldExecuteStep("step-1"))
    expect(should).toBe(true)

    await Effect.runPromise(rt.close())
  })

  it("shouldExecuteStep returns false for completed steps", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    await Effect.runPromise(rt.transitionStep("step-1", "start"))
    await Effect.runPromise(rt.transitionStep("step-1", "complete"))

    const should = await Effect.runPromise(rt.shouldExecuteStep("step-1"))
    expect(should).toBe(false)

    await Effect.runPromise(rt.close())
  })

  it("pause transitions run to paused", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    await Effect.runPromise(rt.pause())
    expect(rt.state).toBe("paused")

    const run = getRunById(rt.db, rt.runId)
    expect(run!.status).toBe("paused")

    await Effect.runPromise(rt.close())
  })

  it("resume from existing paused run skips completed steps", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    await Effect.runPromise(rt.transitionStep("step-1", "start"))
    await Effect.runPromise(rt.transitionStep("step-1", "complete"))
    await Effect.runPromise(rt.pause())

    const runId = rt.runId
    await Effect.runPromise(rt.close())

    const resumed = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }, runId))
    expect(resumed.state).toBe("running")

    const should1 = await Effect.runPromise(resumed.shouldExecuteStep("step-1"))
    expect(should1).toBe(false)

    const should2 = await Effect.runPromise(resumed.shouldExecuteStep("step-2"))
    expect(should2).toBe(true)

    await Effect.runPromise(resumed.close())
  })

  it("complete transitions run to completed", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    await Effect.runPromise(rt.transitionStep("step-1", "start"))
    await Effect.runPromise(rt.transitionStep("step-1", "complete"))
    await Effect.runPromise(rt.transitionStep("step-2", "start"))
    await Effect.runPromise(rt.transitionStep("step-2", "complete"))
    await Effect.runPromise(rt.complete())

    expect(rt.state).toBe("completed")

    const run = getRunById(rt.db, rt.runId)
    expect(run!.status).toBe("completed")

    await Effect.runPromise(rt.close())
  })

  it("fail transitions run to failed", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    await Effect.runPromise(rt.transitionStep("step-1", "start"))
    await Effect.runPromise(rt.transitionStep("step-1", "fail"))
    await Effect.runPromise(rt.fail("step blew up"))

    expect(rt.state).toBe("failed")

    const run = getRunById(rt.db, rt.runId)
    expect(run!.status).toBe("failed")

    await Effect.runPromise(rt.close())
  })

  it("rejects invalid step transitions", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    const result = await Effect.runPromiseExit(rt.transitionStep("step-1", "complete"))
    expect(result._tag).toBe("Failure")

    await Effect.runPromise(rt.close())
  })

  it("rejects invalid run transitions", async () => {
    const spec = makeSpec()
    const rt = await Effect.runPromise(createWorkflowRuntime(spec, { env: "test" }))

    await Effect.runPromise(rt.complete())

    const result = await Effect.runPromiseExit(rt.pause())
    expect(result._tag).toBe("Failure")

    await Effect.runPromise(rt.close())
  })
})