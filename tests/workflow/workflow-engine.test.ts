import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  initializeRun,
  checkpointStepStart,
  checkpointStepComplete,
  checkpointStepFailed,
  checkpointTokenEvent,
  markRunCompleted,
  markRunFailed,
  closeEngine,
  writeDurableState,
  readDurableState,
  setDeferredState,
  getDeferredState
} from "../../src/workflow/workflow-engine.js"
import type { WorkflowSpec } from "../../src/types.js"
import { getRunById, getStepsByRunId } from "../../src/db/queries.js"

const makeSpec = (): WorkflowSpec => ({
  id: "test-wf",
  name: "Test",
  version: 1,
  agents: [{ id: "a", role: "coding", workspace: { baseDir: "x", files: {} } }],
  steps: [{ id: "step1", agent: "a", input: "do it" }]
})

describe("workflow-engine", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-engine-"))
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

  it("initializes a run and checkpoints steps", async () => {
    const spec = makeSpec()
    const runId = "run-init-1"
    const ctx = await Effect.runPromise(
      initializeRun(spec, runId, { env: "test" })
    )

    await Effect.runPromise(checkpointStepStart(ctx, "step1"))
    await Effect.runPromise(checkpointStepComplete(ctx, "step1", { tokensIn: 10, tokensOut: 5 }))
    await Effect.runPromise(markRunCompleted(ctx))

    const run = getRunById(ctx.db, runId)
    expect(run).not.toBeNull()
    expect(run!.status).toBe("completed")
    expect(run!.completed_at).not.toBeNull()

    const steps = getStepsByRunId(ctx.db, runId)
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe("completed")
    expect(steps[0].tokens_in).toBe(10)
    expect(steps[0].tokens_out).toBe(5)

    await Effect.runPromise(closeEngine(ctx))
  })

  it("handles step failure and run failure", async () => {
    const spec = makeSpec()
    const runId = "run-fail-1"
    const ctx = await Effect.runPromise(
      initializeRun(spec, runId, { env: "test" })
    )

    await Effect.runPromise(checkpointStepStart(ctx, "step1"))
    await Effect.runPromise(checkpointStepFailed(ctx, "step1", "boom"))
    await Effect.runPromise(markRunFailed(ctx, "step failed"))

    const run = getRunById(ctx.db, runId)
    expect(run).not.toBeNull()
    expect(run!.status).toBe("failed")
    expect(run!.error_message).toBe("step failed")

    const steps = getStepsByRunId(ctx.db, runId)
    expect(steps[0].status).toBe("failed")
    expect(steps[0].error_message).toBe("boom")

    await Effect.runPromise(closeEngine(ctx))
  })

  it("reads and writes durable state", async () => {
    const spec = makeSpec()
    const runId = "run-state-1"
    const ctx = await Effect.runPromise(
      initializeRun(spec, runId, { env: "test" })
    )

    await Effect.runPromise(writeDurableState(ctx, "cursor", "42"))
    const val = await Effect.runPromise(readDurableState(ctx, "cursor"))
    expect(val).toBe("42")

    const missing = await Effect.runPromise(readDurableState(ctx, "nonexistent"))
    expect(missing).toBeNull()

    await Effect.runPromise(checkpointTokenEvent(ctx, "step1", "completion", 100, 50))
    await Effect.runPromise(markRunCompleted(ctx))
    await Effect.runPromise(closeEngine(ctx))
  })

  it("manages deferred state", async () => {
    const spec = makeSpec()
    const runId = "run-deferred-1"
    const ctx = await Effect.runPromise(
      initializeRun(spec, runId, { env: "test" })
    )

    await Effect.runPromise(setDeferredState(ctx, "def-1", "pending"))
    let result = await Effect.runPromise(getDeferredState(ctx, "def-1"))
    expect(result).not.toBeNull()
    expect(result!.state).toBe("pending")
    expect(result!.value).toBeNull()

    await Effect.runPromise(setDeferredState(ctx, "def-1", "resolved", "output"))
    result = await Effect.runPromise(getDeferredState(ctx, "def-1"))
    expect(result!.state).toBe("resolved")
    expect(result!.value).toBe("output")

    const missing = await Effect.runPromise(getDeferredState(ctx, "no-such-def"))
    expect(missing).toBeNull()

    await Effect.runPromise(markRunCompleted(ctx))
    await Effect.runPromise(closeEngine(ctx))
  })
})