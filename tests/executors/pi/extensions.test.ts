import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import * as Yaml from "yaml"
import { readExtensionSettings, buildExtensions } from "../../../src/executors/pi/extensions/extensions.js"
import { settingsPath } from "../../../src/paths.js"

let tmpHome: string
let origHome: string | undefined

beforeEach(() => {
  origHome = process.env.HOME
  tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-ext-test-"))
  process.env.HOME = tmpHome
})

afterEach(() => {
  process.env.HOME = origHome
  Fs.rmSync(tmpHome, { recursive: true, force: true })
})

function writeSettings(content: string): void {
  const dir = Path.dirname(settingsPath())
  Fs.mkdirSync(dir, { recursive: true })
  Fs.writeFileSync(settingsPath(), content, "utf-8")
}

describe("readExtensionSettings", () => {
  it("returns empty object when settings.yaml does not exist", () => {
    const result = readExtensionSettings()
    expect(result).toEqual({})
  })

  it("parses valid settings.yaml", () => {
    const settings = { extensions: [{ name: "rtk", enabled: true }] }
    writeSettings(Yaml.stringify(settings))
    const result = readExtensionSettings()
    expect(result.extensions).toEqual([{ name: "rtk", enabled: true }])
  })

  it("returns empty object for invalid YAML", () => {
    writeSettings(": : invalid: [")
    const result = readExtensionSettings()
    expect(result).toEqual({})
  })

  it("returns empty object when file exists but has no extensions key", () => {
    const settings = { other: true }
    writeSettings(Yaml.stringify(settings))
    const result = readExtensionSettings()
    expect(result).toEqual({ other: true })
    expect(result.extensions).toBeUndefined()
  })
})

describe("buildExtensions", () => {
  it("returns empty array for empty settings", () => {
    const result = buildExtensions({})
    expect(result).toEqual([])
  })

  it("includes enabled extensions", () => {
    const result = buildExtensions({
      extensions: [{ name: "rtk", enabled: true }]
    })
    expect(result).toHaveLength(1)
    expect(typeof result[0]).toBe("function")
  })

  it("excludes disabled extensions", () => {
    const result = buildExtensions({
      extensions: [{ name: "rtk", enabled: false }]
    })
    expect(result).toHaveLength(0)
  })

  it("includes both when both enabled", () => {
    const result = buildExtensions({
      extensions: [
        { name: "rtk", enabled: true },
        { name: "lsp", enabled: true }
      ]
    })
    expect(result).toHaveLength(2)
    expect(typeof result[0]).toBe("function")
    expect(typeof result[1]).toBe("function")
  })

  it("skips unknown extension names", () => {
    const result = buildExtensions({
      extensions: [{ name: "unknown", enabled: true }]
    })
    expect(result).toHaveLength(0)
  })
})