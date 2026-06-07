import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec, WorkflowNotFoundError, WorkflowParseError } from "../../src/workflow/loader.js"

const validYaml = `version: 1
name: test-wf
run:
  entrypoint: t1
  timeout: 300s
agents:
  - name: a1
    role: analysis
    settings:
      systemPrompt:
        agent: agents/a1/AGENTS.md
        soul: agents/a1/SOUL.md
        identity: agents/a1/IDENTITY.md
tasks:
  - name: t1
    agent:
      ref: agents.a1
      prompt:
        content: do it
`

const invalidYaml = `version: not-a-number
name: bad
run:
  entrypoint: t1
  timeout: 300s
agents:
  - name: a1
    role: analysis
    settings:
      systemPrompt:
        agent: agents/a1/AGENTS.md
        soul: agents/a1/SOUL.md
        identity: agents/a1/IDENTITY.md
tasks:
  - name: t1
    agent:
      ref: agents.a1
      prompt:
        content: do it
`

describe("loadWorkflowSpec", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
    const wfDir = Path.join(tmpDir, "test-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), validYaml)

    const badDir = Path.join(tmpDir, "bad-wf")
    Fs.mkdirSync(badDir, { recursive: true })
    Fs.writeFileSync(Path.join(badDir, "workflow.yml"), invalidYaml)
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  })

  it("loads a valid DAG workflow YAML", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "test-wf"))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.name).toBe("test-wf")
      expect(exit.value.version).toBe(1)
      expect(exit.value.run.entrypoint).toBe("t1")
      expect(exit.value.run.timeout).toBe("300s")
      expect(exit.value.agents).toHaveLength(1)
      expect(exit.value.agents[0].name).toBe("a1")
      expect(exit.value.tasks).toHaveLength(1)
      expect(exit.value.tasks[0].name).toBe("t1")
    } else {
      expect.unreachable("Expected success but got failure")
    }
  })

  it("fails with WorkflowNotFoundError for nonexistent workflow", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "nonexistent"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("WorkflowNotFoundError")
    }
  })

  it("fails with WorkflowParseError for invalid YAML", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "bad-wf"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("WorkflowParseError")
    }
  })
})