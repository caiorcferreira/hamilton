import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { memoryDir, userMemoryDir, userMemoryDBPath } from "../src/paths.js"

describe("memory paths", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-memory-paths-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("memoryDir returns ~/.hamilton/memory", () => {
    expect(memoryDir()).toBe(Path.join(tmpHome, ".hamilton", "memory"))
  })

  it("userMemoryDir returns ~/.hamilton/memory/user", () => {
    expect(userMemoryDir()).toBe(Path.join(tmpHome, ".hamilton", "memory", "user"))
  })

  it("userMemoryDBPath returns ~/.hamilton/memory/user/qmd.db", () => {
    expect(userMemoryDBPath()).toBe(Path.join(tmpHome, ".hamilton", "memory", "user", "qmd.db"))
  })
})