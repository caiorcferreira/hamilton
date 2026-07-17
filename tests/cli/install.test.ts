import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { installWorkflow, uninstallWorkflow, installAllWorkflows } from "../../src/cli/commands/install-logic.js"

describe("installWorkflow", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-install-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "agents"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("installs a workflow from bundled to ~/.hamilton/workflows", async () => {
    const exit = await Effect.runPromiseExit(installWorkflow("bugfix"))
    if (Exit.isSuccess(exit)) {
      const destDir = Path.join(tmpHome, ".hamilton", "workflows", "bugfix")
      expect(Fs.existsSync(destDir)).toBe(true)
      expect(Fs.existsSync(Path.join(destDir, "workflow.yml"))).toBe(true)
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("uninstalls a workflow", async () => {
    await Effect.runPromiseExit(installWorkflow("bugfix"))
    const destDir = Path.join(tmpHome, ".hamilton", "workflows", "bugfix")
    expect(Fs.existsSync(destDir)).toBe(true)

    const exit = await Effect.runPromiseExit(uninstallWorkflow("bugfix"))
    if (Exit.isSuccess(exit)) {
      expect(Fs.existsSync(destDir)).toBe(false)
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("installAllWorkflows installs all bundled workflows", async () => {
    const exit = await Effect.runPromiseExit(installAllWorkflows())
    if (Exit.isSuccess(exit)) {
      expect(exit.value.length).toBeGreaterThan(0)
      const wfDir = Path.join(tmpHome, ".hamilton", "workflows")
      const installed = Fs.readdirSync(wfDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
      expect(installed.length).toBe(exit.value.length)
      for (const id of exit.value) {
        expect(Fs.existsSync(Path.join(wfDir, id, "workflow.yml"))).toBe(true)
      }
    } else {
      expect.unreachable("Expected success")
    }
  })
})

describe("bundle root resolution", () => {
  let tmpHome: string
  let tmpBundleDir: string
  const originalHome = process.env.HOME
  const originalBundleDir = process.env.HAMILTON_BUNDLE_DIR

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-install-"))
    tmpBundleDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-bundle-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "agents"), { recursive: true })
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

  it("uses HAMILTON_BUNDLE_DIR env var to locate bundled workflows", async () => {
    // Create a fake bundle structure with a demo workflow
    const bundleWorkflowsDir = Path.join(tmpBundleDir, "workflows", "demo-flow")
    Fs.mkdirSync(bundleWorkflowsDir, { recursive: true })
    Fs.writeFileSync(Path.join(bundleWorkflowsDir, "workflow.yml"), "# Demo Workflow\nFake workflow")

    // Set env var and run installWorkflow
    process.env.HAMILTON_BUNDLE_DIR = tmpBundleDir
    const exit = await Effect.runPromiseExit(installWorkflow("demo-flow"))
    expect(Exit.isSuccess(exit)).toBe(true)

    // Assert the workflow was installed from the temp bundle dir
    const copiedWorkflow = Path.join(tmpHome, ".hamilton", "workflows", "demo-flow", "workflow.yml")
    expect(Fs.existsSync(copiedWorkflow)).toBe(true)
    const content = Fs.readFileSync(copiedWorkflow, "utf-8")
    expect(content).toBe("# Demo Workflow\nFake workflow")
  })
})