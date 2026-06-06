import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadPersona, PersonaLoadError } from "../../src/agent/persona.js"

describe("loadPersona", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-persona-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loads all three persona files", async () => {
    const personaDir = Path.join(tmpDir, "full-agent")
    Fs.mkdirSync(personaDir, { recursive: true })
    Fs.writeFileSync(Path.join(personaDir, "AGENTS.md"), "agent instructions")
    Fs.writeFileSync(Path.join(personaDir, "IDENTITY.md"), "identity info")
    Fs.writeFileSync(Path.join(personaDir, "SOUL.md"), "soul data")

    const exit = await Effect.runPromiseExit(loadPersona(personaDir))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("agent instructions")
      expect(exit.value.identity).toBe("identity info")
      expect(exit.value.soul).toBe("soul data")
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("fails for nonexistent directory", async () => {
    const exit = await Effect.runPromiseExit(loadPersona(Path.join(tmpDir, "no-such-dir")))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("uses empty strings for missing optional files", async () => {
    const personaDir = Path.join(tmpDir, "minimal-agent")
    Fs.mkdirSync(personaDir, { recursive: true })
    Fs.writeFileSync(Path.join(personaDir, "AGENTS.md"), "only agents")

    const exit = await Effect.runPromiseExit(loadPersona(personaDir))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("only agents")
      expect(exit.value.identity).toBe("")
      expect(exit.value.soul).toBe("")
    } else {
      expect.unreachable("Expected success")
    }
  })
})