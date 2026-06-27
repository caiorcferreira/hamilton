import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { EventBusLive } from "../../src/events/bus.js"
import { workflowsDir, runDir } from "../../src/paths.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"

const taskResponses: Record<string, Record<string, unknown>> = {
  triage: { status: "done", repo: "/tmp/test-repo", branch: "bugfix-login", severity: "high", affected_area: "src/auth.ts", reproduction: "open /login", problem_statement: "race condition in session" },
  investigate: { status: "done", root_cause: "session expiry race condition", fix_approach: "add mutex around session update" },
  setup: { status: "done", build_cmd: "npm run build", test_cmd: "npm test", baseline: "all pass" },
  fix: { status: "done", changes: "added mutex", regression_test: "test/session-race.test.ts" },
  verify: { status: "done", verified: "fix confirmed correct" }
}

vi.mock("../../src/executors/pi/pi-executor.js", () => ({
  executeWithPi: vi.fn((config: { taskId: string }) => {
    const slug = Object.keys(taskResponses).find((k) => config.taskId.includes(k)) ?? config.taskId
    return Effect.succeed(taskResponses[slug] ?? { status: "done" })
  }),
  PiExecutionError: class PiExecutionError extends Error {}
}))

vi.mock("../../src/prompts/system.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    SystemPromptFragmentsNotFoundError: class SystemPromptFragmentsNotFoundError extends Error {}
  }
})

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: {
    settings: { model: "default" },
    systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
  },
  systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
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
    const agentRegistry = new Map<string, AgentManifest>([
      ["triager", makeAgentManifest("triager")],
      ["investigator", makeAgentManifest("investigator")],
      ["setup", makeAgentManifest("setup")],
      ["fixer", makeAgentManifest("fixer")],
      ["verifier", makeAgentManifest("verifier")]
    ])

    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "bug-fix", description: "Bug fix pipeline" },
      spec: {
        run: { entrypoint: "triage", timeout: "300s" },
        tasks: [
          { name: "triage", agent: { executorRef: "triager", prompt: { content: "Triage the bug" } } },
          { name: "investigate", dependencies: ["triage"], agent: { executorRef: "investigator", prompt: { content: "Investigate" } } },
          { name: "setup", dependencies: ["investigate"], agent: { executorRef: "setup", prompt: { content: "Setup" } } },
          { name: "fix", dependencies: ["setup"], agent: { executorRef: "fixer", prompt: { content: "Fix the bug" } } },
          { name: "verify", dependencies: ["fix"], agent: { executorRef: "verifier", prompt: { content: "Verify" } } }
        ]
      },
      agentRegistry
    }

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(spec, { task: "fix login bug", project_dir: testHome }, { strict: false }, [], null)
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const r = result.value
      expect(r.status).toBe("completed")
      expect(typeof r.env).toBe("object")
      expect(r.env).toHaveProperty("run_id")
      expect(r.env).toHaveProperty("tasks")
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