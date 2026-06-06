import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { pauseWorkflow } from "../../src/cli/commands/pause.js"
import { createWorkflowRuntime } from "../../src/workflow/run-state-machine.js"
import type { WorkflowSpec } from "../../src/types.js"

const makeSpec = (): WorkflowSpec => ({
  id: "test-wf", name: "Test", version: 1,
  agents: [{ id: "a", role: "coding", workspace: { baseDir: "x", files: {} } }],
  steps: [{ id: "step1", agent: "a", input: "do it" }]
})

describe("pauseWorkflow", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-pause-test-${Date.now()}`)
    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("sets pause signal for a running workflow", async () => {
    const ctx = await Effect.runPromise(
      createWorkflowRuntime(makeSpec(), { task: "test" })
    )
    await Effect.runPromise(ctx.close())

    const result = await Effect.runPromiseExit(pauseWorkflow(ctx.runId))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toContain("Paused")
    }
  })
})