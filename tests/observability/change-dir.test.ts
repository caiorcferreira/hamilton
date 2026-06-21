import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  readNextId,
  writeNextId,
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

  it("readNextId returns 0 when next-id.txt does not exist", async () => {
    const exit = await Effect.runPromiseExit(readNextId())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(0)
    }
  })

  it("readNextId reads existing value", async () => {
    const file = Path.join(tmpCwd, ".hamilton", "changes", "next-id.txt")
    Fs.mkdirSync(Path.dirname(file), { recursive: true })
    Fs.writeFileSync(file, "42")

    const exit = await Effect.runPromiseExit(readNextId())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(42)
    }
  })

  it("readNextId returns 0 when next-id.txt is empty", async () => {
    const file = Path.join(tmpCwd, ".hamilton", "changes", "next-id.txt")
    Fs.mkdirSync(Path.dirname(file), { recursive: true })
    Fs.writeFileSync(file, "")

    const exit = await Effect.runPromiseExit(readNextId())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(0)
    }
  })

  it("writeNextId writes value to next-id.txt", async () => {
    const exit = await Effect.runPromiseExit(writeNextId(7))
    expect(Exit.isSuccess(exit)).toBe(true)

    const file = Path.join(tmpCwd, ".hamilton", "changes", "next-id.txt")
    const content = Fs.readFileSync(file, "utf-8")
    expect(content).toBe("7")
  })

  it("writeNextId creates parent directories", async () => {
    const exit = await Effect.runPromiseExit(writeNextId(3))
    expect(Exit.isSuccess(exit)).toBe(true)

    const dir = Path.join(tmpCwd, ".hamilton", "changes")
    expect(Fs.existsSync(dir)).toBe(true)
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