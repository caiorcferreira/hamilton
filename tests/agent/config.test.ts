import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Path from "node:path"
import * as Os from "node:os"
import * as Fs from "node:fs"
import { resolveAgentDefaults, loadModelAliases, resolveModelAlias, CircularModelAliasError } from "../../src/agent/config.js"
import type { AgentSettings } from "../../src/types.js"

const baseSettings: AgentSettings = {
  systemPrompt: { agent: "a.md", soul: "s.md" }
}

describe("resolveAgentDefaults", () => {
  it("defaults model to 'default' when undefined", () => {
    const result = resolveAgentDefaults(baseSettings)
    expect(result.model).toBe("default")
  })

  it("preserves explicit model when set", () => {
    const result = resolveAgentDefaults({ ...baseSettings, model: "glm-5.1" })
    expect(result.model).toBe("glm-5.1")
  })

  it("defaults skills to null when undefined", () => {
    const result = resolveAgentDefaults(baseSettings)
    expect(result.skills).toBeNull()
  })

  it("preserves explicit skills when set", () => {
    const result = resolveAgentDefaults({ ...baseSettings, skills: ["debugging"] })
    expect(result.skills).toEqual(["debugging"])
  })
})

describe("loadModelAliases", () => {
  let origHome: string | undefined
  let tmpDir: string

  beforeEach(() => {
    origHome = process.env.HOME
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-alias-test-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton", "executors", "pi", "agent"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns default-only registry using fallback when no pi settings", () => {
    const registry = loadModelAliases()
    expect(registry.default).toBe("glm-5.1")
  })

  it("reads default from pi settings.json when present", () => {
    Fs.writeFileSync(
      Path.join(tmpDir, ".hamilton", "executors", "pi", "agent", "settings.json"),
      JSON.stringify({ defaultProvider: "openai", defaultModel: "deepseek-v4" })
    )
    const registry = loadModelAliases()
    expect(registry.default).toBe("deepseek-v4")
  })

  it("returns default-only registry when settings.yaml has no models.aliases", () => {
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "settings.yaml"), "other:\n  key: val\n")
    const registry = loadModelAliases()
    expect(registry.default).toBe("glm-5.1")
  })

  it("loads aliases from settings.yaml", () => {
    Fs.writeFileSync(
      Path.join(tmpDir, ".hamilton", "settings.yaml"),
      "models:\n  aliases:\n    cheap: deepseek-v4\n    thinking: o3-pro\n"
    )
    const registry = loadModelAliases()
    expect(registry).toEqual({
      default: "glm-5.1",
      cheap: "deepseek-v4",
      thinking: "o3-pro"
    })
  })

  it("always overrides default alias from pi settings even if YAML defines it", () => {
    Fs.writeFileSync(
      Path.join(tmpDir, ".hamilton", "settings.yaml"),
      "models:\n  aliases:\n    default: deepseek-v4\n"
    )
    Fs.writeFileSync(
      Path.join(tmpDir, ".hamilton", "executors", "pi", "agent", "settings.json"),
      JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" })
    )
    const registry = loadModelAliases()
    expect(registry.default).toBe("glm-5.1")
  })

  it("ignores invalid YAML gracefully", () => {
    Fs.writeFileSync(
      Path.join(tmpDir, ".hamilton", "settings.yaml"),
      ":::invalid:::\n"
    )
    const registry = loadModelAliases()
    expect(registry.default).toBe("glm-5.1")
  })

  it("accepts explicit defaultModel override", () => {
    const registry = loadModelAliases("explicit-model")
    expect(registry.default).toBe("explicit-model")
  })
})

describe("resolveModelAlias", () => {
  it("resolves a known alias", () => {
    const aliases = { default: "glm-5.1", cheap: "deepseek-v4" }
    expect(resolveModelAlias("cheap", aliases)).toBe("deepseek-v4")
  })

  it("returns model as-is when not an alias", () => {
    const aliases = { default: "glm-5.1" }
    expect(resolveModelAlias("openai/gpt-4o", aliases)).toBe("openai/gpt-4o")
  })

  it("resolves 'default' alias", () => {
    const aliases = { default: "glm-5.1" }
    expect(resolveModelAlias("default", aliases)).toBe("glm-5.1")
  })

  it("throws CircularModelAliasError when alias maps to itself", () => {
    const aliases = { oops: "oops" }
    expect(() => resolveModelAlias("oops", aliases)).toThrow(CircularModelAliasError)
  })
})