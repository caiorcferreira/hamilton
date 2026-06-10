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
      constructor(props: { stepId: string; message: string }) {
        super(props.message)
        this.name = "PiExecutionError"
      }
    }
  }
})

vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolvePersona: vi.fn(() => E.succeed({ agent: "test-agent", soul: "test-soul", identity: "test-identity" })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})

const validYaml = `name: test-wf
version: 1
run:
  entrypoint: step-1
  timeout: 300s
variants:
  supported: [branchout]
agents:
  - name: agent-1
    role: coding
    settings:
      systemPrompt:
        agent: agents/agent-1/AGENTS.md
        soul: agents/agent-1/soul.md
        identity: agents/agent-1/identity.md
tasks:
  - name: step-1
    agent:
      ref: agents.agent-1
      prompt:
        content: "Do the thing"
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
    const piDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
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
      expect(r.taskResults["step-1"]).toBe("done")
      expect(typeof r.runId).toBe("string")
      expect(r.runId).toContain("test-wf")
    }
  })

  it("returns failed status when executeWithPi fails", async () => {
    const { executeWithPi } = await import("../../src/executors/pi/pi-executor.js")
    vi.mocked(executeWithPi).mockImplementationOnce(
      () => Effect.fail(new PiExecutionError({ stepId: "step-1", message: "agent error" }))
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