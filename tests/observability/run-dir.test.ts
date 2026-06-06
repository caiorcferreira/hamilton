import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  createRunDir,
  writeInput,
  writeStepOutput,
  appendStepLog,
  writeSummary
} from "../../src/observability/run-dir.js"

const testRunId = "test-run-001"

describe("run directory management", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-rundir-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("createRunDir creates full directory tree", async () => {
    const exit = await Effect.runPromiseExit(createRunDir(testRunId))
    expect(Exit.isSuccess(exit)).toBe(true)

    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    expect(Fs.existsSync(base)).toBe(true)
    expect(Fs.existsSync(Path.join(base, "step-outputs"))).toBe(true)
    expect(Fs.existsSync(Path.join(base, "logs"))).toBe(true)
  })

  it("writeInput writes input.json", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(base, { recursive: true })

    const exit = await Effect.runPromiseExit(writeInput(testRunId, { task: "fix bug" }))
    expect(Exit.isSuccess(exit)).toBe(true)

    const content = JSON.parse(Fs.readFileSync(Path.join(base, "input.json"), "utf-8"))
    expect(content).toEqual({ task: "fix bug" })
  })

  it("writeStepOutput writes step-outputs/<step>.json", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(Path.join(base, "step-outputs"), { recursive: true })

    const exit = await Effect.runPromiseExit(writeStepOutput(testRunId, "triage", { status: "done" }))
    expect(Exit.isSuccess(exit)).toBe(true)

    const content = JSON.parse(Fs.readFileSync(Path.join(base, "step-outputs", "triage.json"), "utf-8"))
    expect(content).toEqual({ status: "done" })
  })

  it("appendStepLog appends JSONL lines", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(Path.join(base, "logs"), { recursive: true })

    await Effect.runPromiseExit(appendStepLog(testRunId, "triage", { event: "start" }))
    await Effect.runPromiseExit(appendStepLog(testRunId, "triage", { event: "end" }))

    const logPath = Path.join(base, "logs", "triage.jsonl")
    const lines = Fs.readFileSync(logPath, "utf-8").trim().split("\n")
    expect(lines).toHaveLength(2)

    const first = JSON.parse(lines[0])
    expect(first.event).toBe("start")
    expect(typeof first.timestamp).toBe("string")
  })

  it("writeSummary writes summary.json", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(base, { recursive: true })

    const exit = await Effect.runPromiseExit(writeSummary(testRunId, { result: "success" }))
    expect(Exit.isSuccess(exit)).toBe(true)

    const content = JSON.parse(Fs.readFileSync(Path.join(base, "summary.json"), "utf-8"))
    expect(content).toEqual({ result: "success" })
  })
})