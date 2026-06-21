import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { loadScriptConfig } from "../../src/workflow/script-config.js"

describe("script config", () => {
  let origHome: string | undefined
  let tmpDir: string

  beforeEach(() => {
    origHome = process.env.HOME
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-scfg-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns default config when settings.yaml does not exist", async () => {
    const exit = await Effect.runPromiseExit(loadScriptConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.maxOutputBytes).toBe(65536)
    }
  })

  it("loads maxOutputBytes from settings.yaml", async () => {
    const yaml = "script:\n  maxOutputBytes: 32768\n"
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), yaml)

    const exit = await Effect.runPromiseExit(loadScriptConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.maxOutputBytes).toBe(32768)
    }
  })

  it("returns default when script section is missing", async () => {
    const yaml = "telemetry:\n  disableStores: []\n"
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), yaml)

    const exit = await Effect.runPromiseExit(loadScriptConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.maxOutputBytes).toBe(65536)
    }
  })

  it("returns default when maxOutputBytes is not a number", async () => {
    const yaml = "script:\n  maxOutputBytes: broken\n"
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), yaml)

    const exit = await Effect.runPromiseExit(loadScriptConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.maxOutputBytes).toBe(65536)
    }
  })
})
