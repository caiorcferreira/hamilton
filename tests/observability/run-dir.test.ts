import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  createRunDir,
  writeInput,
  writeTaskOutput,
  appendTaskLog,
  writeSummary,
  ensureProgressFile
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
    expect(Fs.existsSync(Path.join(base, "task-outputs"))).toBe(true)
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

  it("writeTaskOutput writes task-outputs/<taskId>.json", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(Path.join(base, "task-outputs"), { recursive: true })

    const exit = await Effect.runPromiseExit(writeTaskOutput(testRunId, "triage", { status: "done" }))
    expect(Exit.isSuccess(exit)).toBe(true)

    const content = JSON.parse(Fs.readFileSync(Path.join(base, "task-outputs", "triage.json"), "utf-8"))
    expect(content).toEqual({ status: "done" })
  })

  it("appendTaskLog appends JSONL lines", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(Path.join(base, "logs"), { recursive: true })

    await Effect.runPromiseExit(appendTaskLog(testRunId, "triage", { event: "start" }))
    await Effect.runPromiseExit(appendTaskLog(testRunId, "triage", { event: "end" }))

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

  it("ensureProgressFile creates directory and seeds file", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(base, { recursive: true })

    const cwdSpy = process.cwd
    try {
      (process as any).cwd = () => tmpHome
      const exit = await Effect.runPromiseExit(ensureProgressFile(testRunId))
      expect(Exit.isSuccess(exit)).toBe(true)

      const pgDir = Path.join(tmpHome, ".hamilton", "workflows")
      expect(Fs.existsSync(pgDir)).toBe(true)

      const today = new Date().toISOString().slice(0, 10)
      const progressPath = Path.join(pgDir, `progress-${today}.txt`)
      expect(Fs.existsSync(progressPath)).toBe(true)

      const content = Fs.readFileSync(progressPath, "utf-8")
      expect(content).toContain(`# Progress Log — ${today}`)
      expect(content).toContain(testRunId)
    } finally {
      process.cwd = cwdSpy
    }
  })

  it("ensureProgressFile returns file path", async () => {
    const base = Path.join(tmpHome, ".hamilton", "runs", testRunId)
    Fs.mkdirSync(base, { recursive: true })

    const cwdSpy = process.cwd
    try {
      (process as any).cwd = () => tmpHome
      const exit = await Effect.runPromiseExit(ensureProgressFile(testRunId))
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const today = new Date().toISOString().slice(0, 10)
        expect(exit.value).toContain(`progress-${today}.txt`)
      }
    } finally {
      process.cwd = cwdSpy
    }
  })
})