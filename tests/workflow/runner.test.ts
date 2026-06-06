import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow, WorkflowEvent } from "../../src/workflow/runner.js"
import type { WorkflowSpec } from "../../src/types.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

const testSpec: WorkflowSpec = {
  id: "test-flow",
  name: "Test Flow",
  version: 1,
  agents: [
    { id: "agent-a", role: "coding" as const, workspace: { baseDir: ".", files: {} } }
  ],
  steps: [
    { id: "step-1", agent: "agent-a", input: "Do something" },
    { id: "step-2", agent: "agent-a", input: "Do another thing" }
  ]
}

describe("runWorkflow", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-runner-"))
    process.env.HOME = tmpHome

    const agentDir = Path.join(tmpHome, ".hamilton", "agents", "agent-a")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "Test agent")
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes all steps and returns completed", async () => {
    const events: WorkflowEvent[] = []

    const result = await Effect.runPromiseExit(
      runWorkflow(testSpec, { task: "test" }, {
        onEvent: (e) => Effect.sync(() => events.push(e)),
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults["step-1"]).toBe("done")
      expect(result.value.stepResults["step-2"]).toBe("done")

      const types = events.map((e) => e.type)
      expect(types).toContain("workflow_started")
      expect(types).toContain("step_started")
      expect(types).toContain("step_completed")
      expect(types).toContain("workflow_completed")
    }
  })

  it("emits events in correct order", async () => {
    const events: WorkflowEvent[] = []

    await Effect.runPromise(
      runWorkflow(testSpec, { task: "test" }, {
        onEvent: (e) => Effect.sync(() => events.push(e)),
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(events[0].type).toBe("workflow_started")
    expect(events[1].type).toBe("step_started")
    expect(events[2].type).toBe("step_completed")
    expect(events[events.length - 1].type).toBe("workflow_completed")
  })
})