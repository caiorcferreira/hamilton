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
    const exit = await Effect.runPromiseExit(installWorkflow("bug-fix"))
    if (Exit.isSuccess(exit)) {
      const destDir = Path.join(tmpHome, ".hamilton", "workflows", "bug-fix")
      expect(Fs.existsSync(destDir)).toBe(true)
      expect(Fs.existsSync(Path.join(destDir, "workflow.yml"))).toBe(true)
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("uninstalls a workflow", async () => {
    await Effect.runPromiseExit(installWorkflow("bug-fix"))
    const destDir = Path.join(tmpHome, ".hamilton", "workflows", "bug-fix")
    expect(Fs.existsSync(destDir)).toBe(true)

    const exit = await Effect.runPromiseExit(uninstallWorkflow("bug-fix"))
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