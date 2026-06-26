import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { executeRun } from "../../src/cli/commands/run.js"
import { PiExecutionError } from "../../src/executors/pi/pi-executor.js"
import { EventBusLive } from "../../src/events/bus.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {
      constructor(props: { taskId: string; message: string }) {
        super(props.message)
        this.name = "PiExecutionError"
      }
    }
  }
})

vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error { }
  }
})

const validYaml = `apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Workflow
metadata:
  name: test-wf
  version: 1
spec:
  run:
    entrypoint: task-1
    timeout: 300s
  variants:
    supported: [branchout]
  tasks:
    - name: task-1
      agent:
        executorRef: agent-1
        prompt:
          content: "Do the thing"
`

function makeAgentDir(agentsDir: string, name: string): void {
  const dir = Path.join(agentsDir, name)
  Fs.mkdirSync(dir, { recursive: true })
  Fs.writeFileSync(Path.join(dir, "INSTRUCTIONS.md"), `Agent ${name}`)
  Fs.writeFileSync(Path.join(dir, "agent.yml"), `apiVersion: dag.hamiltonai.dev/v1alpha1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  settings:\n    model: default\n`)
}

describe("executeRun", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-run-"))
    process.env.HOME = tmpHome

    const wfDir = Path.join(tmpHome, ".hamilton", "workflows", "test-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), validYaml)
    const piDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))

    const agentsDir = Path.join(tmpHome, ".hamilton", "agents")
    makeAgentDir(agentsDir, "agent-1")
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes a workflow and returns completed result", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        executeRun({
          workflowSlug: "test-wf",
          prompt: "Fix the bug"
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const r = result.value
      expect(r.status).toBe("completed")
      expect(r.taskResults["task-1"]).toBe("done")
      expect(typeof r.runId).toBe("string")
      expect(r.runId).toContain("test-wf")
    }
  })

  it("returns failed status when executeWithPi fails", async () => {
    const { executeWithPi } = await import("../../src/executors/pi/pi-executor.js")
    vi.mocked(executeWithPi).mockImplementationOnce(
      () => Effect.fail(new PiExecutionError({ taskId: "task-1", message: "agent error" }))
    )

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        executeRun({
          workflowSlug: "test-wf",
          prompt: "Fix the bug"
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("failed")
    }
  })

  it("fails when workflow slug does not exist", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        executeRun({
          workflowSlug: "nonexistent",
          prompt: "Fix the bug"
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})