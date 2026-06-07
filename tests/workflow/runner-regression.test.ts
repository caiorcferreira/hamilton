import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow, WorkflowEvent } from "../../src/workflow/runner.js"
import type { WorkflowSpec } from "../../src/types.js"
import { WorkflowSlug, AgentSlug, StepSlug } from "../../src/types.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

const testSpec: WorkflowSpec = {
  slug: "test-flow" as WorkflowSlug,
  name: "Test Flow",
  version: 1,
  agents: [
    { slug: "agent-a" as AgentSlug, role: "coding" as const, workspace: { baseDir: ".", files: {} } }
  ],
  steps: [
    { slug: "step-1" as StepSlug, agent: "agent-a" as AgentSlug, input: "Do something" },
    { slug: "step-2" as StepSlug, agent: "agent-a" as AgentSlug, input: "Do another thing" }
  ]
}

describe("runWorkflow regression tests", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-regression-"))
    process.env.HOME = tmpHome

    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "agents", "agent-a"), { recursive: true })
    Fs.writeFileSync(Path.join(hh, "agents", "agent-a", "AGENTS.md"), "Test agent")

    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("emits prompt_built event with system_prompt and task_prompt", async () => {
    const collectedEvents: Array<Record<string, unknown>> = []

    const result = await Effect.runPromiseExit(
      runWorkflow(testSpec, { task: "test" }, {
        onEvent: (e) => Effect.sync(() => collectedEvents.push(e as unknown as Record<string, unknown>)),
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)

    const logDir = Path.join(tmpHome, ".hamilton", "runs")
    const runDirs = Fs.readdirSync(logDir)
    expect(runDirs.length).toBeGreaterThan(0)

    const runId = runDirs[0]!
    const logsDir = Path.join(logDir, runId, "logs")
    const logFiles = Fs.readdirSync(logsDir).filter(f => f.endsWith(".jsonl"))
    expect(logFiles.length).toBeGreaterThan(0)

    for (const lf of logFiles) {
      const content = Fs.readFileSync(Path.join(logsDir, lf), "utf-8")
      for (const line of content.trim().split("\n")) {
        if (!line.trim()) continue
        const parsed = JSON.parse(line)
        if (parsed.event === "prompt_built") {
          expect(parsed).toHaveProperty("system_prompt")
          expect(parsed).toHaveProperty("task_prompt")
          expect(typeof parsed.system_prompt).toBe("string")
          expect(typeof parsed.task_prompt).toBe("string")
          expect(parsed.system_prompt.length).toBeGreaterThan(0)
          return
        }
      }
    }
  })

  it("emits workflow_started as first event", async () => {
    const events: WorkflowEvent[] = []

    await Effect.runPromise(
      runWorkflow(testSpec, { task: "test" }, {
        onEvent: (e) => Effect.sync(() => events.push(e)),
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(events[0].type).toBe("workflow_started")
  })

  it("records token events in the database", async () => {
    const events: Array<WorkflowEvent> = []

    const result = await Effect.runPromiseExit(
      runWorkflow(testSpec, { task: "test" }, {
        onEvent: (e) => Effect.sync(() => events.push(e)),
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const { Database } = require("bun:sqlite")
      const db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
      const rows = db.prepare("SELECT * FROM token_events WHERE run_id = ?").all(result.value.runId)
      db.close()
      expect(rows.length).toBeGreaterThan(0)
    }
  })
})