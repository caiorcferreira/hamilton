import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec } from "../../src/workflow/loader.js"
import { runWorkflow, WorkflowEvent } from "../../src/workflow/runner.js"
import { workflowsDir, runDir } from "../../src/paths.js"

const stepResponses: Record<string, Record<string, unknown>> = {
  triage: { status: "done", repo: "/tmp/test-repo", branch: "bugfix-login", severity: "high", affected_area: "src/auth.ts", reproduction: "open /login", problem_statement: "race condition in session" },
  investigate: { status: "done", root_cause: "session expiry race condition", fix_approach: "add mutex around session update" },
  setup: { status: "done", build_cmd: "npm run build", test_cmd: "npm test", baseline: "all pass" },
  fix: { status: "done", changes: "added mutex", regression_test: "test/session-race.test.ts" },
  verify: { status: "done", verified: "fix confirmed correct" }
}

vi.mock("../../src/agent/pi-executor.js", () => ({
  executeWithPi: vi.fn((config: { stepId: string }) =>
    Effect.succeed(stepResponses[config.stepId] ?? { status: "done" })
  ),
  PiExecutionError: class PiExecutionError extends Error {}
}))

describe("end-to-end workflow execution", () => {
  let testHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-e2e-" + Date.now())
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("completes the bug-fix workflow with mock agents", async () => {
    const wfSrc = Path.join(process.cwd(), "workflows", "bug-fix")
    const wfDest = Path.join(workflowsDir(), "bug-fix")
    Fs.mkdirSync(wfDest, { recursive: true })
    Fs.cpSync(wfSrc, wfDest, { recursive: true })

    const spec = await Effect.runPromise(loadWorkflowSpec(workflowsDir(), "bug-fix"))

    for (const agent of spec.agents) {
      const agentDir = Path.join(testHome, ".hamilton", "agents", agent.id)
      Fs.mkdirSync(agentDir, { recursive: true })
      Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "You are a " + agent.role + " agent")
      Fs.writeFileSync(Path.join(agentDir, "IDENTITY.md"), "Name: " + agent.id)
      Fs.writeFileSync(Path.join(agentDir, "SOUL.md"), "Professional")
    }

    const events: WorkflowEvent[] = []

    const result = await Effect.runPromiseExit(
      runWorkflow(spec, { task: "fix login bug" }, {
        onEvent: (event) =>
          Effect.sync(() => { events.push(event) }),
        workflowsDir: wfDest
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const r = result.value
      expect(r.status).toBe("completed")
      expect(r.stepResults).toHaveProperty("triage")
      expect(r.stepResults).toHaveProperty("investigate")
      expect(r.stepResults).toHaveProperty("setup")
      expect(r.stepResults).toHaveProperty("fix")
      expect(r.stepResults).toHaveProperty("verify")

      expect(r.context).toHaveProperty("repo")
      expect(r.context).toHaveProperty("root_cause")

      const rd = runDir(r.runId)
      expect(Fs.existsSync(Path.join(rd, "input.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "summary.json"))).toBe(true)

      const types = events.map((e) => e.type)
      expect(types).toContain("workflow_started")
      expect(types).toContain("workflow_completed")
    }
  })
})