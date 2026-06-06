import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { initHamilton } from "../../src/cli/commands/init.js"

describe("initHamilton", () => {
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
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "agents"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "workflows"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "runs"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "executors", "pi", "agent"))).toBe(true)
  })

  it("creates the SQLite DB", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "hamilton.db"))).toBe(true)
  })

  it("copies shared agents from project root", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const agentsBase = Path.join(tmpHome, ".hamilton", "agents")
    expect(Fs.existsSync(Path.join(agentsBase, "pr", "AGENTS.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(agentsBase, "setup", "AGENTS.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(agentsBase, "verifier", "AGENTS.md"))).toBe(true)
  })

  it("installs bundled workflows", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "workflows", "bug-fix", "workflow.yml"))).toBe(true)
  })

  it("copies per-workflow agents to shared agents dir", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const agentsBase = Path.join(tmpHome, ".hamilton", "agents")
    expect(Fs.existsSync(Path.join(agentsBase, "triager", "AGENTS.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(agentsBase, "investigator", "AGENTS.md"))).toBe(true)
  })

  it("is idempotent", async () => {
    const exit1 = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit1)).toBe(true)

    const exit2 = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit2)).toBe(true)

    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "hamilton.db"))).toBe(true)
    expect(Fs.existsSync(Path.join(tmpHome, ".hamilton", "agents", "pr", "AGENTS.md"))).toBe(true)
  })

  it("skips agent copy when already exists without --force", async () => {
    const exit1 = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit1)).toBe(true)

    const agentPath = Path.join(tmpHome, ".hamilton", "agents", "pr", "AGENTS.md")
    const originalContent = Fs.readFileSync(agentPath, "utf-8")

    Fs.writeFileSync(agentPath, "modified")

    const exit2 = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit2)).toBe(true)

    const content = Fs.readFileSync(agentPath, "utf-8")
    expect(content).toBe("modified")
    expect(content).not.toBe(originalContent)
  })

  it("overwrites agents with --force", async () => {
    const exit1 = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit1)).toBe(true)

    const agentPath = Path.join(tmpHome, ".hamilton", "agents", "pr", "AGENTS.md")
    Fs.writeFileSync(agentPath, "modified")

    const exit2 = await Effect.runPromiseExit(initHamilton({ force: true }))
    expect(Exit.isSuccess(exit2)).toBe(true)

    const content = Fs.readFileSync(agentPath, "utf-8")
    expect(content).not.toBe("modified")
  })

  it("returns installed workflow IDs", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    if (Exit.isSuccess(exit)) {
      expect(Array.isArray(exit.value)).toBe(true)
      expect(exit.value.length).toBeGreaterThan(0)
      expect(exit.value).toContain("bug-fix")
    } else {
      expect.unreachable("Expected success")
    }
  })
})