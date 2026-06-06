import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resolvePersona, PersonaLoadError } from "../../src/agent/persona.js"

describe("resolvePersona", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-persona-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("loads from shared agents dir when workflow-local doesn't exist", async () => {
    const sharedDir = Path.join(tmpHome, ".hamilton", "agents", "agent-a")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(sharedDir, "AGENTS.md"), "shared instructions")
    Fs.writeFileSync(Path.join(sharedDir, "IDENTITY.md"), "shared identity")
    Fs.writeFileSync(Path.join(sharedDir, "SOUL.md"), "shared soul")

    const exit = await Effect.runPromiseExit(resolvePersona("agent-a", "no-such-workflow"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("shared instructions")
      expect(exit.value.identity).toBe("shared identity")
      expect(exit.value.soul).toBe("shared soul")
    }
  })

  it("prefers workflow-local agents over shared agents", async () => {
    const sharedDir = Path.join(tmpHome, ".hamilton", "agents", "agent-a")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(sharedDir, "AGENTS.md"), "shared instructions")

    const localDir = Path.join(tmpHome, ".hamilton", "workflows", "my-wf", "agents", "agent-a")
    Fs.mkdirSync(localDir, { recursive: true })
    Fs.writeFileSync(Path.join(localDir, "AGENTS.md"), "local instructions")

    const exit = await Effect.runPromiseExit(resolvePersona("agent-a", "my-wf"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("local instructions")
    }
  })

  it("fails when agent not found in either location", async () => {
    const exit = await Effect.runPromiseExit(resolvePersona("no-such", "no-wf"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("uses empty strings for missing optional files", async () => {
    const sharedDir = Path.join(tmpHome, ".hamilton", "agents", "minimal")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(sharedDir, "AGENTS.md"), "only agents")

    const exit = await Effect.runPromiseExit(resolvePersona("minimal", "no-wf"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("only agents")
      expect(exit.value.identity).toBe("")
      expect(exit.value.soul).toBe("")
    }
  })
})