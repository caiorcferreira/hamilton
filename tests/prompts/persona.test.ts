import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resolveSystemPromptFragments, PersonaNotFoundError } from "../../src/prompts/persona.js"

describe("resolveSystemPromptFragments", () => {
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

    const paths = {
      agent: "agent.md",
      soul: "soul.md"
    }

    const exit = await Effect.runPromiseExit(resolveSystemPromptFragments(paths, tmpDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent.content).toBe("agent instructions")
      expect(exit.value.soul.content).toBe("soul content")
    }
  })

  it("returns empty string for missing soul file", async () => {
    Fs.writeFileSync(Path.join(tmpDir, "agent.md"), "agent instructions")

    const paths = {
      agent: "agent.md",
      soul: "no-soul.md"
    }

    const exit = await Effect.runPromiseExit(resolveSystemPromptFragments(paths, tmpDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent.content).toBe("agent instructions")
      expect(exit.value.soul.content).toBe("")
    }
  })

  it("fails with PersonaNotFoundError for missing agent file", async () => {
    const paths = {
      agent: "nonexistent.md",
      soul: "soul.md"
    }

    const exit = await Effect.runPromiseExit(resolveSystemPromptFragments(paths, tmpDir))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("resolves shared agent through symlink", async () => {
    const sharedAgentsDir = Path.join(tmpDir, "agents")
    Fs.mkdirSync(Path.join(sharedAgentsDir, "setup"), { recursive: true })
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "INSTRUCTIONS.md"), "shared setup agent")
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "SOUL.md"), "shared setup soul")

    const workflowDir = Path.join(tmpDir, "workflows", "test-wf")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.symlinkSync(sharedAgentsDir, Path.join(sharedDir, "agents"), "dir")

    const paths = {
      agent: "shared/agents/setup/INSTRUCTIONS.md",
      soul: "shared/agents/setup/SOUL.md"
    }

    const exit = await Effect.runPromiseExit(resolveSystemPromptFragments(paths, workflowDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent.content).toBe("shared setup agent")
      expect(exit.value.soul.content).toBe("shared setup soul")
    }
  })
})