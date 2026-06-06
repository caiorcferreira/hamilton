import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { executeRun } from "../../src/cli/commands/run.js"
import { PiExecutionError } from "../../src/agent/pi-executor.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {
      constructor(props: { stepId: string; message: string }) {
        super(props.message)
        this.name = "PiExecutionError"
      }
    }
  }
})

const validYaml = `slug: test-wf
name: Test Workflow
version: 1
agents:
  - slug: agent-1
    role: coding
    workspace:
      baseDir: .
      files: {}
steps:
  - slug: step-1
    agent: agent-1
    input: "Do the thing"
`

describe("executeRun", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-run-"))
    process.env.HOME = tmpHome

    const wfDir = Path.join(tmpHome, ".hamilton", "workflows", "test-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), validYaml)

    const agentDir = Path.join(tmpHome, ".hamilton", "agents", "agent-1")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "Test agent")
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes a workflow and returns completed result", async () => {
    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "test-wf",
        prompt: "Fix the bug"
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const r = result.value
      expect(r.status).toBe("completed")
      expect(r.stepResults["step-1"]).toBe("done")
      expect(typeof r.runId).toBe("string")
      expect(r.runId).toContain("test-wf")
    }
  })

  it("returns failed status when executeWithPi fails", async () => {
    const { executeWithPi } = await import("../../src/agent/pi-executor.js")
    vi.mocked(executeWithPi).mockImplementationOnce(
      () => Effect.fail(new PiExecutionError({ stepId: "step-1", message: "agent error" }))
    )

    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "test-wf",
        prompt: "Fix the bug"
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("failed")
    }
  })

  it("fails when workflow slug does not exist", async () => {
    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "nonexistent",
        prompt: "Fix the bug"
      })
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})