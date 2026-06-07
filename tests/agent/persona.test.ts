import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resolvePersona, PersonaNotFoundError } from "../../src/agent/persona.js"

describe("resolvePersona", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-persona-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("resolves persona from paths", async () => {
    Fs.writeFileSync(Path.join(tmpDir, "agent.md"), "agent instructions")
    Fs.writeFileSync(Path.join(tmpDir, "soul.md"), "soul content")
    Fs.writeFileSync(Path.join(tmpDir, "identity.md"), "identity content")

    const paths = {
      agent: "agent.md",
      soul: "soul.md",
      identity: "identity.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, tmpDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent).toBe("agent instructions")
      expect(exit.value.soul).toBe("soul content")
      expect(exit.value.identity).toBe("identity content")
    }
  })

  it("returns empty string for missing soul and identity files", async () => {
    Fs.writeFileSync(Path.join(tmpDir, "agent.md"), "agent instructions")

    const paths = {
      agent: "agent.md",
      soul: "no-soul.md",
      identity: "no-identity.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, tmpDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent).toBe("agent instructions")
      expect(exit.value.soul).toBe("")
      expect(exit.value.identity).toBe("")
    }
  })

  it("fails with PersonaNotFoundError for missing agent file", async () => {
    const paths = {
      agent: "nonexistent.md",
      soul: "soul.md",
      identity: "identity.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, tmpDir))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})