import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadAgentSettings } from "../../src/agent/config.js"

describe("loadAgentSettings", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-config-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns defaults when no settings.yaml exists", async () => {
    const agentDir = Path.join(tmpDir, "no-settings")
    Fs.mkdirSync(agentDir, { recursive: true })

    const exit = await Effect.runPromiseExit(loadAgentSettings(agentDir))
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({})
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("reads model from settings.yaml", async () => {
    const agentDir = Path.join(tmpDir, "model-agent")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(
      Path.join(agentDir, "settings.yaml"),
      "model: claude-3-opus"
    )

    const exit = await Effect.runPromiseExit(loadAgentSettings(agentDir))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.model).toBe("claude-3-opus")
      expect(exit.value.thinking).toBeUndefined()
      expect(exit.value.tools).toBeUndefined()
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("reads full settings (model, thinking, timeout, tools, skills)", async () => {
    const agentDir = Path.join(tmpDir, "full-agent")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(
      Path.join(agentDir, "settings.yaml"),
      [
        "model: gpt-4",
        "thinking: hybrid",
        "timeoutSeconds: 120",
        "tools:",
        "  - search",
        "  - code",
        "skills:",
        "  - debugging",
        "  - review"
      ].join("\n")
    )

    const exit = await Effect.runPromiseExit(loadAgentSettings(agentDir))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.model).toBe("gpt-4")
      expect(exit.value.thinking).toBe("hybrid")
      expect(exit.value.timeoutSeconds).toBe(120)
      expect(exit.value.tools).toEqual(["search", "code"])
      expect(exit.value.skills).toEqual(["debugging", "review"])
    } else {
      expect.unreachable("Expected success")
    }
  })
})