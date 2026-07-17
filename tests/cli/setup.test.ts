import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import * as Yaml from "yaml"
import { Effect, Exit } from "effect"
import { setupHamilton, parseModelAliasArgs, buildSettingsYaml, ingestSetupGuidelines } from "../../src/cli/commands/setup.js"

describe("setupHamilton", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-init-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("creates all required directories", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "agents"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "workflows"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "runs"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "executors", "pi", "agent"))).toBe(true)
  })

  it("creates the SQLite DB", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "hamilton.db"))).toBe(true)
  })

  it("copies shared agents from project root", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const agentsBase = Path.join(tmpHome, ".hamilton", "agents")
    expect(Fs.existsSync(Path.join(agentsBase, "pr", "INSTRUCTIONS.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(agentsBase, "setup", "INSTRUCTIONS.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(agentsBase, "verifier", "INSTRUCTIONS.md"))).toBe(true)
  })

  it("installs bundled workflows", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "workflows", "bug-fix", "workflow.yml"))).toBe(true)
  })

  it("does NOT copy per-workflow agents to shared agents dir", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const agentsBase = Path.join(tmpHome, ".hamilton", "agents")
    expect(Fs.existsSync(Path.join(agentsBase, "triager", "INSTRUCTIONS.md"))).toBe(false)
    expect(Fs.existsSync(Path.join(agentsBase, "investigator", "INSTRUCTIONS.md"))).toBe(false)
    expect(Fs.existsSync(Path.join(agentsBase, "fixer", "INSTRUCTIONS.md"))).toBe(false)
  })

  it("is idempotent", async () => {
    const exit1 = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit1)).toBe(true)

    const exit2 = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit2)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "hamilton.db"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "agents", "pr", "INSTRUCTIONS.md"))).toBe(true)
  })

  it("skips agent copy when already exists without --force", async () => {
    const exit1 = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit1)).toBe(true)

    const agentPath = Path.join(tmpHome, ".hamilton", "agents", "pr", "INSTRUCTIONS.md")
    const originalContent = Fs.readFileSync(agentPath, "utf-8")

    Fs.writeFileSync(agentPath, "modified")

    const exit2 = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit2)).toBe(true)

    const content = Fs.readFileSync(agentPath, "utf-8")
    expect(content).toBe("modified")
    expect(content).not.toBe(originalContent)
  })

  it("overwrites agents with --force", async () => {
    const exit1 = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit1)).toBe(true)

    const agentPath = Path.join(tmpHome, ".hamilton", "agents", "pr", "INSTRUCTIONS.md")
    Fs.writeFileSync(agentPath, "modified")

    const exit2 = await Effect.runPromiseExit(setupHamilton({ force: true }))
    expect(Exit.isSuccess(exit2)).toBe(true)

    const content = Fs.readFileSync(agentPath, "utf-8")
    expect(content).not.toBe("modified")
  })

  it("returns installed workflow IDs", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    if (Exit.isSuccess(exit)) {
      expect(Array.isArray(exit.value)).toBe(true)
      expect(exit.value.length).toBeGreaterThan(0)
      expect(exit.value).toContain("bug-fix")
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("creates default Pi config files", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const agentDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")

    const settings = JSON.parse(Fs.readFileSync(Path.join(agentDir, "settings.json"), "utf-8"))
    expect(settings.defaultProvider).toBe("openai")
    expect(settings.defaultModel).toBe("glm-5.1")

    const models = JSON.parse(Fs.readFileSync(Path.join(agentDir, "models.json"), "utf-8"))
    expect(models.providers).toEqual({})

    const auth = JSON.parse(Fs.readFileSync(Path.join(agentDir, "auth.json"), "utf-8"))
    expect(auth).toEqual({})
  })

  it("does not overwrite existing Pi configs on re-init", async () => {
    await Effect.runPromiseExit(setupHamilton())

    const agentDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")
    Fs.writeFileSync(Path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "custom" }))

    await Effect.runPromiseExit(setupHamilton())

    const settings = JSON.parse(Fs.readFileSync(Path.join(agentDir, "settings.json"), "utf-8"))
    expect(settings.defaultProvider).toBe("custom")
  })

  it("overwrites Pi configs with --force", async () => {
    await Effect.runPromiseExit(setupHamilton())

    const agentDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")
    Fs.writeFileSync(Path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "custom" }))

    await Effect.runPromiseExit(setupHamilton({ force: true }))

    const settings = JSON.parse(Fs.readFileSync(Path.join(agentDir, "settings.json"), "utf-8"))
    expect(settings.defaultProvider).toBe("openai")
  })

  it("copies Pi configs from ~/.pi/agent when --copy-pi-configs is set", async () => {
    const piSource = Path.join(tmpHome, ".pi", "agent")
    Fs.mkdirSync(piSource, { recursive: true })
    Fs.writeFileSync(Path.join(piSource, "settings.json"), JSON.stringify({ defaultProvider: "from-pi", defaultModel: "custom-model" }))
    Fs.writeFileSync(Path.join(piSource, "models.json"), JSON.stringify({ providers: { openai: {} } }))
    Fs.writeFileSync(Path.join(piSource, "auth.json"), JSON.stringify({ key: "secret" }))

    await Effect.runPromiseExit(setupHamilton({ copyPiConfigs: true }))

    const agentDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")

    const settings = JSON.parse(Fs.readFileSync(Path.join(agentDir, "settings.json"), "utf-8"))
    expect(settings.defaultProvider).toBe("from-pi")
    expect(settings.defaultModel).toBe("custom-model")

    const models = JSON.parse(Fs.readFileSync(Path.join(agentDir, "models.json"), "utf-8"))
    expect(models.providers).toEqual({ openai: {} })

    const auth = JSON.parse(Fs.readFileSync(Path.join(agentDir, "auth.json"), "utf-8"))
    expect(auth).toEqual({ key: "secret" })
  })

  it("creates default settings.yaml on init", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const settingsPath = Path.join(tmpHome, ".hamilton", "settings.yaml")
    expect(Fs.existsSync(settingsPath)).toBe(true)

    const content = Fs.readFileSync(settingsPath, "utf-8")
    expect(content).toContain("name: rtk")
    expect(content).toContain("name: lsp")
    expect(content).toContain("name: git")
  })

  it("does not overwrite existing settings.yaml on re-init", async () => {
    await Effect.runPromiseExit(setupHamilton())

    const settingsPath = Path.join(tmpHome, ".hamilton", "settings.yaml")
    Fs.writeFileSync(settingsPath, "extensions:\n  - name: rtk\n    enabled: false\n")

    await Effect.runPromiseExit(setupHamilton())

    const content = Fs.readFileSync(settingsPath, "utf-8")
    expect(content).toContain("enabled: false")
  })

  it("writes model aliases to settings.yaml when provided", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton({
      modelAliases: { cheap: "deepseek-v4", thinking: "o3-pro" }
    }))
    expect(Exit.isSuccess(exit)).toBe(true)

    const content = Fs.readFileSync(Path.join(tmpHome, ".hamilton", "settings.yaml"), "utf-8")
    const parsed = Yaml.parse(content)
    expect(parsed.models.aliases.cheap).toBe("deepseek-v4")
    expect(parsed.models.aliases.thinking).toBe("o3-pro")
  })

  it("omits models section when no aliases provided", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const content = Fs.readFileSync(Path.join(tmpHome, ".hamilton", "settings.yaml"), "utf-8")
    const parsed = Yaml.parse(content)
    expect(parsed.models).toBeUndefined()
  })

  it("skips model aliases on re-init even if provided", async () => {
    await Effect.runPromiseExit(setupHamilton())
    const settingsPath = Path.join(tmpHome, ".hamilton", "settings.yaml")
    Fs.writeFileSync(settingsPath, "extensions:\n  - name: rtk\n    enabled: false\n")

    await Effect.runPromiseExit(setupHamilton({ modelAliases: { cheap: "deepseek-v4" } }))

    const content = Fs.readFileSync(settingsPath, "utf-8")
    expect(content).toContain("enabled: false")
    expect(content).not.toContain("cheap")
  })

  describe("assisted mode", () => {
    it("runs the full bootstrap (templates, db, agents, workflows, settings)", async () => {
      const exit = await Effect.runPromiseExit(setupHamilton({ mode: "assisted" }))
      expect(Exit.isSuccess(exit)).toBe(true)

      const home = Path.join(tmpHome, ".hamilton")
      expect(Fs.existsSync(Path.join(home, "templates", "plan.md"))).toBe(true)
      expect(Fs.existsSync(Path.join(home, "hamilton.db"))).toBe(true)
      expect(Fs.existsSync(Path.join(home, "settings.yaml"))).toBe(true)
      expect(Fs.existsSync(Path.join(home, "agents", "pr", "INSTRUCTIONS.md"))).toBe(true)
    })

    it("still installs workflows", async () => {
      const exit = await Effect.runPromiseExit(setupHamilton({ mode: "assisted" }))
      if (Exit.isSuccess(exit)) {
        expect(exit.value.length).toBeGreaterThan(0)
      } else {
        expect.unreachable("Expected success")
      }
    })

    it("skips Pi SDK configs", async () => {
      const exit = await Effect.runPromiseExit(setupHamilton({ mode: "assisted" }))
      expect(Exit.isSuccess(exit)).toBe(true)

      const agentDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")
      expect(Fs.existsSync(Path.join(agentDir, "settings.json"))).toBe(false)
      expect(Fs.existsSync(Path.join(agentDir, "models.json"))).toBe(false)
      expect(Fs.existsSync(Path.join(agentDir, "auth.json"))).toBe(false)
    })

    it("does not copy Pi configs from ~/.pi even when copyPiConfigs is set", async () => {
      const piSource = Path.join(tmpHome, ".pi", "agent")
      Fs.mkdirSync(piSource, { recursive: true })
      Fs.writeFileSync(Path.join(piSource, "settings.json"), JSON.stringify({ defaultProvider: "from-pi" }))

      const exit = await Effect.runPromiseExit(setupHamilton({ mode: "assisted", copyPiConfigs: true }))
      expect(Exit.isSuccess(exit)).toBe(true)

      const agentDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")
      expect(Fs.existsSync(Path.join(agentDir, "settings.json"))).toBe(false)
    })
  })
})

describe("parseModelAliasArgs", () => {
  it("parses NAME=VALUE entries", () => {
    expect(parseModelAliasArgs(["cheap=deepseek-v4", "thinking=o3-pro"])).toEqual({
      cheap: "deepseek-v4",
      thinking: "o3-pro"
    })
  })

  it("skips entries without =", () => {
    expect(parseModelAliasArgs(["invalid", "ok=value"])).toEqual({ ok: "value" })
  })

  it("returns empty object for empty array", () => {
    expect(parseModelAliasArgs([])).toEqual({})
  })

  it("handles value containing =", () => {
    expect(parseModelAliasArgs(["model=a=b"])).toEqual({ model: "a=b" })
  })
})

describe("buildSettingsYaml", () => {
  it("produces valid YAML with extensions only", () => {
    const yaml = buildSettingsYaml()
    const parsed = Yaml.parse(yaml)
    expect(parsed.extensions).toHaveLength(3)
    expect(parsed.models).toBeUndefined()
  })

  it("produces valid YAML with extensions and model aliases", () => {
    const yaml = buildSettingsYaml({ cheap: "deepseek-v4" })
    const parsed = Yaml.parse(yaml)
    expect(parsed.extensions).toHaveLength(3)
    expect(parsed.models.aliases.cheap).toBe("deepseek-v4")
  })

  it("omits models section when aliases is empty", () => {
    const yaml = buildSettingsYaml({})
    const parsed = Yaml.parse(yaml)
    expect(parsed.models).toBeUndefined()
  })
})

describe("bundle root resolution", () => {
  let tmpHome: string
  let tmpBundleDir: string
  const originalHome = process.env.HOME
  const originalBundleDir = process.env.HAMILTON_BUNDLE_DIR

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-setup-"))
    tmpBundleDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-bundle-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    delete process.env.HAMILTON_BUNDLE_DIR
    if (originalBundleDir) {
      process.env.HAMILTON_BUNDLE_DIR = originalBundleDir
    }
    Fs.rmSync(tmpHome, { recursive: true, force: true })
    Fs.rmSync(tmpBundleDir, { recursive: true, force: true })
  })

  it("uses HAMILTON_BUNDLE_DIR env var to locate bundle assets", async () => {
    // Create a fake bundle structure
    const bundleAgentsDir = Path.join(tmpBundleDir, "agents", "demo")
    Fs.mkdirSync(bundleAgentsDir, { recursive: true })
    Fs.writeFileSync(Path.join(bundleAgentsDir, "INSTRUCTIONS.md"), "# Demo Agent\nFake instructions")

    // Set env var and run setup
    process.env.HAMILTON_BUNDLE_DIR = tmpBundleDir
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    // Assert the agent was copied from the temp bundle dir
    const copiedAgent = Path.join(tmpHome, ".hamilton", "agents", "demo", "INSTRUCTIONS.md")
    expect(Fs.existsSync(copiedAgent)).toBe(true)
    const content = Fs.readFileSync(copiedAgent, "utf-8")
    expect(content).toBe("# Demo Agent\nFake instructions")
  })
})

describe("ingestSetupGuidelines", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-ingest-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("ingests guidelines into qmd.db after setupHamilton", { timeout: 30000 }, async () => {
    await Effect.runPromiseExit(setupHamilton())

    const exit = await Effect.runPromiseExit(ingestSetupGuidelines())
    expect(Exit.isSuccess(exit)).toBe(true)

    const qmdDbPath = Path.join(tmpHome, ".hamilton", "memory", "user", "qmd.db")
    expect(Fs.existsSync(qmdDbPath)).toBe(true)

    const canonicalDir = Path.join(tmpHome, ".hamilton", "memory", "user", "canonical")
    const files = Fs.readdirSync(canonicalDir)
    expect(files.length).toBeGreaterThan(0)
  })

  it("succeeds gracefully when guidelines directory is empty", async () => {
    const exit = await Effect.runPromiseExit(ingestSetupGuidelines())
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})