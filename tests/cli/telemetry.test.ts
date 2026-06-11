import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

describe("telemetry CLI", () => {
  let origHome: string | undefined
  let tmpDir: string

  beforeEach(() => {
    origHome = process.env.HOME
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-tcli-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton"), { recursive: true })
    Fs.writeFileSync(
      Path.join(tmpDir, ".hamilton", "settings.yaml"),
      "extensions: []\ntelemetry:\n  disableStores: []\n"
    )
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("telemetry status command succeeds", async () => {
    const { telemetryStatus } = await import("../../src/cli/commands/telemetry.js")
    const exit = await Effect.runPromiseExit(telemetryStatus)
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("telemetry enable command succeeds", async () => {
    const { telemetryEnable } = await import("../../src/cli/commands/telemetry.js")
    const exit = await Effect.runPromiseExit(telemetryEnable())
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("disable file then enable file round-trips", async () => {
    const { telemetryDisable, telemetryEnable } = await import("../../src/cli/commands/telemetry.js")
    const { loadTelemetryConfig } = await import("../../src/telemetry/config.js")

    await Effect.runPromiseExit(telemetryDisable("file"))
    let cfg = await Effect.runPromise(loadTelemetryConfig)
    expect(cfg.disableStores.has("file")).toBe(true)

    await Effect.runPromiseExit(telemetryEnable("file"))
    cfg = await Effect.runPromise(loadTelemetryConfig)
    expect(cfg.disableStores.has("file")).toBe(false)
  })
})
