import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  ensureChangeDir,
  writeWorkflowMetadata
} from "../../src/observability/change-dir.js"

describe("change directory management", () => {
  let tmpCwd: string
  const originalCwd = process.cwd

  beforeEach(() => {
    tmpCwd = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-changedir-"))
    process.cwd = () => tmpCwd
  })

  afterEach(() => {
    process.cwd = originalCwd
    Fs.rmSync(tmpCwd, { recursive: true, force: true })
  })

  it("ensureChangeDir creates the change directory", async () => {
    const exit = await Effect.runPromiseExit(ensureChangeDir("change-1"))
    expect(Exit.isSuccess(exit)).toBe(true)

    const dir = Path.join(tmpCwd, ".hamilton", "changes", "change-1")
    expect(Fs.existsSync(dir)).toBe(true)
  })

  it("ensureChangeDir returns error if directory already exists", async () => {
    const dir = Path.join(tmpCwd, ".hamilton", "changes", "change-1")
    Fs.mkdirSync(dir, { recursive: true })

    const exit = await Effect.runPromiseExit(ensureChangeDir("change-1"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("writeWorkflowMetadata writes metadata.json", async () => {
    Fs.mkdirSync(Path.join(tmpCwd, ".hamilton", "changes", "change-1"), { recursive: true })

    const exit = await Effect.runPromiseExit(writeWorkflowMetadata("change-1", { workflow: "plan", status: "running" }))
    expect(Exit.isSuccess(exit)).toBe(true)

    const file = Path.join(tmpCwd, ".hamilton", "changes", "change-1", "workflow.metadata.json")
    const content = JSON.parse(Fs.readFileSync(file, "utf-8"))
    expect(content).toEqual({ workflow: "plan", status: "running" })
  })
})
