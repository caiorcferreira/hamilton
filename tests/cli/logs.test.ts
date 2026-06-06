import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { getRunLogs, followLogs } from "../../src/cli/commands/logs.js"

describe("getRunLogs", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-logs-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("reads all log events from a run", async () => {
    const logsDir = Path.join(tmpHome, ".hamilton", "runs", "run-1", "logs")
    Fs.mkdirSync(logsDir, { recursive: true })
    Fs.writeFileSync(Path.join(logsDir, "step-a.jsonl"), [
      JSON.stringify({ event: "started", step_id: "step-a", timestamp: "2026-01-01T00:00:00Z" }),
      JSON.stringify({ event: "completed", step_id: "step-a", timestamp: "2026-01-01T00:01:00Z" })
    ].join("\n") + "\n")
    Fs.writeFileSync(Path.join(logsDir, "step-b.jsonl"), [
      JSON.stringify({ event: "started", step_id: "step-b", timestamp: "2026-01-01T00:02:00Z" })
    ].join("\n") + "\n")

    const exit = await Effect.runPromiseExit(getRunLogs({ runId: "run-1" }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(3)
      expect(exit.value[0].event).toBe("started")
      expect(exit.value[2].step_id).toBe("step-b")
    }
  })

  it("filters events by stepId", async () => {
    const logsDir = Path.join(tmpHome, ".hamilton", "runs", "run-2", "logs")
    Fs.mkdirSync(logsDir, { recursive: true })
    Fs.writeFileSync(Path.join(logsDir, "step-a.jsonl"), [
      JSON.stringify({ event: "started", step_id: "step-a", timestamp: "2026-01-01T00:00:00Z" })
    ].join("\n") + "\n")
    Fs.writeFileSync(Path.join(logsDir, "step-b.jsonl"), [
      JSON.stringify({ event: "started", step_id: "step-b", timestamp: "2026-01-01T00:01:00Z" })
    ].join("\n") + "\n")

    const exit = await Effect.runPromiseExit(getRunLogs({ runId: "run-2", stepId: "step-a" }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].step_id).toBe("step-a")
    }
  })

  it("returns empty array when logs dir does not exist", async () => {
    const exit = await Effect.runPromiseExit(getRunLogs({ runId: "nonexistent" }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })
})

describe("followLogs", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-follow-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("returns an object with a stop function", () => {
    const controller = followLogs({ runId: "follow-test" })
    expect(typeof controller.stop).toBe("function")
    controller.stop()
  })
})