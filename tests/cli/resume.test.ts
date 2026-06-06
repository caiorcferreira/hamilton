import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resumeWorkflow } from "../../src/cli/commands/resume.js"

describe("resumeWorkflow", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-resume-test-${Date.now()}`)
    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("fails when run is not paused", async () => {
    const result = await Effect.runPromiseExit(resumeWorkflow("nonexistent"))
    expect(Exit.isFailure(result)).toBe(true)
  })
})