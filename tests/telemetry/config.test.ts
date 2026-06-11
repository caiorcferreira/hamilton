import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { loadTelemetryConfig, saveTelemetryConfig } from "../../src/telemetry/config.js"

describe("telemetry config", () => {
  let origHome: string | undefined
  let tmpDir: string

  beforeEach(() => {
    origHome = process.env.HOME
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-tcfg-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loads default config when settings.yaml does not exist", async () => {
    const exit = await Effect.runPromiseExit(loadTelemetryConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.disableStores.has("file")).toBe(false)
      expect(exit.value.disableStores.has("db")).toBe(false)
      expect(exit.value.disableStores.size).toBe(0)
    }
  })

  it("loads config from settings.yaml", async () => {
    const yaml = "telemetry:\n  disableStores:\n    - file\n    - db\n"
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), yaml)

    const exit = await Effect.runPromiseExit(loadTelemetryConfig)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.disableStores.has("file")).toBe(true)
      expect(exit.value.disableStores.has("db")).toBe(true)
    }
  })

  it("saveTelemetryConfig writes and loadTelemetryConfig reads back", async () => {
    const config = { disableStores: new Set(["file"] as const) }
    const saveExit = await Effect.runPromiseExit(saveTelemetryConfig(config))
    expect(Exit.isSuccess(saveExit)).toBe(true)

    const loadExit = await Effect.runPromiseExit(loadTelemetryConfig)
    expect(Exit.isSuccess(loadExit)).toBe(true)
    if (Exit.isSuccess(loadExit)) {
      expect(loadExit.value.disableStores.has("file")).toBe(true)
      expect(loadExit.value.disableStores.has("db")).toBe(false)
    }
  })

  it("persists enable all (empty disableStores)", async () => {
    const yaml = "telemetry:\n  disableStores:\n    - file\n"
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), yaml)

    const config = { disableStores: new Set<"file" | "db">() }
    await Effect.runPromiseExit(saveTelemetryConfig(config))

    const content = Fs.readFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), "utf-8")
    expect(content).toContain("disableStores: []")
  })
})
