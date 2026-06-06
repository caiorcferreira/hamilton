import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec, WorkflowNotFoundError, WorkflowParseError } from "../../src/workflow/loader.js"

const validYaml = `slug: bug-fix
name: Bug Fix Workflow
version: 1
description: Triage and fix bugs
agents:
  - slug: triager
    role: analysis
    workspace:
      baseDir: agents/triager
      files:
        AGENTS.md: agents/triager/AGENTS.md
steps:
  - slug: triage
    agent: triager
    input: "Triage this bug"
`

const invalidYaml = `slug: bad
name: Bad
version: not-a-number
agents: []
steps: []
`

describe("loadWorkflowSpec", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
    const wfDir = Path.join(tmpDir, "bug-fix")
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

  it("loads a valid workflow YAML", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "bug-fix"))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.slug).toBe("bug-fix")
      expect(exit.value.name).toBe("Bug Fix Workflow")
      expect(exit.value.version).toBe(1)
    } else {
      expect.unreachable("Expected success but got failure")
    }
  })

  it("fails with WorkflowNotFoundError for nonexistent workflow", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "nonexistent"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defects = cause._tag === "Fail" ? cause.error : undefined
      expect(defects?._tag).toBe("WorkflowNotFoundError")
    }
  })

  it("fails with WorkflowParseError for invalid YAML", async () => {
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(tmpDir, "bad-wf"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defects = cause._tag === "Fail" ? cause.error : undefined
      expect(defects?._tag).toBe("WorkflowParseError")
    }
  })
})