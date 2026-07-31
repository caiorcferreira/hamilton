import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import * as Yaml from "yaml"
import { Effect, Exit } from "effect"
import { setupHamilton, buildSettingsYaml } from "../../src/cli/commands/setup.js"

const TEMPLATE_FILES = [
  "critique.md",
  "design.md",
  "plan.md",
  "progress.md",
  "proposal.md",
  "README.md",
  "requirements-change.md",
  "requirements-spec.md",
  "review.md"
]

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

  it("creates required directories", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const home = Path.join(tmpHome, ".hamilton")
    expect(Fs.existsSync(home)).toBe(true)
    expect(Fs.existsSync(Path.join(home, "templates"))).toBe(true)
    expect(Fs.existsSync(Path.join(home, "guidelines"))).toBe(true)
  })

  it("copies artifact templates", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const templatesBase = Path.join(tmpHome, ".hamilton", "templates")
    for (const file of TEMPLATE_FILES) {
      expect(Fs.existsSync(Path.join(templatesBase, file))).toBe(true)
    }
  })

  it("copies guideline manifests", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const guidelinesBase = Path.join(tmpHome, ".hamilton", "guidelines")
    expect(Fs.existsSync(Path.join(guidelinesBase, "general", "01-code-style.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(guidelinesBase, "typescript", "01-setup.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(guidelinesBase, "golang", "code_style.md"))).toBe(true)
  })

  it("returns installed template filenames", async () => {
    const exit = await Effect.runPromiseExit(setupHamilton())
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toContain("plan.md")
      expect(exit.value.length).toBeGreaterThan(0)
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("is idempotent", async () => {
    const exit1 = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit1)).toBe(true)

    const exit2 = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit2)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "templates", "plan.md"))).toBe(true)
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
    const bundleTemplatesDir = Path.join(tmpBundleDir, "templates")
    Fs.mkdirSync(bundleTemplatesDir, { recursive: true })
    Fs.writeFileSync(Path.join(bundleTemplatesDir, "plan.md"), "# Plan Template")

    process.env.HAMILTON_BUNDLE_DIR = tmpBundleDir
    const exit = await Effect.runPromiseExit(setupHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const copiedTemplate = Path.join(tmpHome, ".hamilton", "templates", "plan.md")
    expect(Fs.existsSync(copiedTemplate)).toBe(true)
    const content = Fs.readFileSync(copiedTemplate, "utf-8")
    expect(content).toBe("# Plan Template")
  })
})
