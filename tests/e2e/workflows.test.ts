import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { EventBusLive } from "../../src/events/bus.js"
import { workflowsDir, runDir } from "../../src/paths.js"

const stepResponses: Record<string, Record<string, unknown>> = {
  triage: { status: "done", repo: "/tmp/test-repo", branch: "bugfix-login", severity: "high", affected_area: "src/auth.ts", reproduction: "open /login", problem_statement: "race condition in session" },
  investigate: { status: "done", root_cause: "session expiry race condition", fix_approach: "add mutex around session update" },
  setup: { status: "done", build_cmd: "npm run build", test_cmd: "npm test", baseline: "all pass" },
  fix: { status: "done", changes: "added mutex", regression_test: "test/session-race.test.ts" },
  verify: { status: "done", verified: "fix confirmed correct" }
}

vi.mock("../../src/executors/pi/pi-executor.js", () => ({
  executeWithPi: vi.fn((config: { stepId: string }) => {
    const slug = Object.keys(stepResponses).find((k) => config.stepId.includes(k)) ?? config.stepId
    return Effect.succeed(stepResponses[slug] ?? { status: "done" })
  }),
  PiExecutionError: class PiExecutionError extends Error {}
}))

vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolvePersona: vi.fn(() => E.succeed({ agent: "test-agent", soul: "test-soul", identity: "test-identity" })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})

describe("end-to-end workflow execution", () => {
  let testHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-e2e-" + Date.now())
    process.env.HOME = testHome
    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })
    const piDir = Path.join(testHome, ".hamilton", "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("completes the bug-fix workflow with mock agents", async () => {
    const spec = {
      version: 1,
      name: "bug-fix",
      description: "Bug fix pipeline",
      run: { entrypoint: "triage", timeout: "300s" },
      agents: [
        { name: "triager", role: "analysis" as const, settings: { systemPrompt: { agent: "a.md", soul: "s.md", identity: "i.md" } } },
        { name: "investigator", role: "analysis" as const, settings: { systemPrompt: { agent: "a.md", soul: "s.md", identity: "i.md" } } },
        { name: "setup", role: "coding" as const, settings: { systemPrompt: { agent: "a.md", soul: "s.md", identity: "i.md" } } },
        { name: "fixer", role: "coding" as const, settings: { systemPrompt: { agent: "a.md", soul: "s.md", identity: "i.md" } } },
        { name: "verifier", role: "verification" as const, settings: { systemPrompt: { agent: "a.md", soul: "s.md", identity: "i.md" } } }
      ],
      tasks: [
        { name: "triage", agent: { ref: "agents.triager", prompt: { content: "Triage the bug" } } },
        { name: "investigate", dependencies: ["triage"], agent: { ref: "agents.investigator", prompt: { content: "Investigate" } } },
        { name: "setup", dependencies: ["investigate"], agent: { ref: "agents.setup", prompt: { content: "Setup" } } },
        { name: "fix", dependencies: ["setup"], agent: { ref: "agents.fixer", prompt: { content: "Fix the bug" } } },
        { name: "verify", dependencies: ["fix"], agent: { ref: "agents.verifier", prompt: { content: "Verify" } } }
      ]
    }

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(spec, { task: "fix login bug" }, {
          workflowsDir: Path.join(testHome, ".hamilton", "workflows")
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const r = result.value
      expect(r.status).toBe("completed")
      expect(r.taskResults).toHaveProperty("triage")
      expect(r.taskResults).toHaveProperty("investigate")
      expect(r.taskResults).toHaveProperty("setup")
      expect(r.taskResults).toHaveProperty("fix")
      expect(r.taskResults).toHaveProperty("verify")

      const rd = runDir(r.runId)
      expect(Fs.existsSync(Path.join(rd, "input.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "summary.json"))).toBe(true)
    }
  })
})