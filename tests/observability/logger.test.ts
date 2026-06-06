import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Logger } from "effect"
import { createHamiltonLogger } from "../../src/observability/logger.js"

describe("createHamiltonLogger", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-logger-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("returns a valid Logger", () => {
    const logger = createHamiltonLogger("test-run")
    expect(Logger.isLogger(logger)).toBe(true)
  })

  it("writes log entries to the events JSONL file", async () => {
    const runId = "logger-test-run"
    const base = Path.join(tmpHome, ".hamilton", "runs", runId)
    Fs.mkdirSync(base, { recursive: true })

    const logger = createHamiltonLogger(runId)
    const layer = Logger.replace(Logger.defaultLogger, logger)

    await Effect.runPromise(
      Effect.log("hello world").pipe(Effect.provide(layer))
    )

    const eventsPath = Path.join(base, "events.jsonl")
    expect(Fs.existsSync(eventsPath)).toBe(true)

    const content = Fs.readFileSync(eventsPath, "utf-8").trim()
    const lines = content.split("\n")
    expect(lines.length).toBeGreaterThanOrEqual(1)

    const entry = JSON.parse(lines[0])
    expect(entry.message).toContain("hello world")
    expect(entry.service).toBe("hamilton")
    expect(entry.run_id).toBe(runId)
    expect(entry.timestamp).toBeDefined()
  })
})