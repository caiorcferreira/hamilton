import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { getRunStatus } from "../../src/cli/commands/status.js"

describe("getRunStatus", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-status-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("reads run status from summary.json", async () => {
    const runBase = Path.join(tmpHome, ".hamilton", "runs", "test-run-001")
    Fs.mkdirSync(runBase, { recursive: true })
    const summary = {
      runId: "test-run-001",
      workflow: "test-wf",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      stepResults: { "step-1": "done" },
      context: { task: "fix bug" }
    }
    Fs.writeFileSync(Path.join(runBase, "summary.json"), JSON.stringify(summary))

    const exit = await Effect.runPromiseExit(getRunStatus("test-run-001"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const s = exit.value
      expect(s.runId).toBe("test-run-001")
      expect(s.workflow).toBe("test-wf")
      expect(s.status).toBe("completed")
      expect(s.startedAt).toBe("2026-01-01T00:00:00.000Z")
      expect(s.completedAt).toBe("2026-01-01T00:01:00.000Z")
      expect(s.stepResults).toEqual({ "step-1": "done" })
    }
  })

  it("returns failure for missing run", async () => {
    const exit = await Effect.runPromiseExit(getRunStatus("nonexistent-run"))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})