import { describe, it, expect, vi } from "vitest"
import { Effect } from "effect"
import { determineChangeId, makeCuratorPrompt, CURATOR_SYSTEM_PROMPT } from "../../src/curator/change-id.js"
import { EventBus, EventBusLive } from "../../src/events/bus.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ change_id: "fix-login-timeout" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/agent/config.js", () => ({
  resolveAgentDefaults: vi.fn(() => ({ model: "glm-5.1", skills: [] })),
  loadModelAliases: vi.fn(() => ({})),
  resolveModelAlias: vi.fn((model: string, _aliases: unknown) => model)
}))

vi.mock("../../src/prompts/persona.js", () => ({
  resolvePersona: vi.fn(() => Effect.succeed({ agent: "curator", soul: undefined })),
  PersonaNotFoundError: class PersonaNotFoundError extends Error {}
}))

vi.mock("../../src/paths.js", () => ({
  piAgentDir: () => "/fake/agent",
  taskOutputFile: () => "/fake/output.json"
}))

describe("curator change-id", () => {
  it("makeCuratorPrompt wraps the user prompt", () => {
    const prompt = makeCuratorPrompt("Fix the login timeout issue")
    expect(prompt).toContain("Fix the login timeout issue")
    expect(prompt).toContain("kebab-case")
  })

  it("CURATOR_SYSTEM_PROMPT is non-empty", () => {
    expect(CURATOR_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })

  it("determineChangeId returns resolved change-id title", async () => {
    const result = await Effect.runPromise(
      determineChangeId("Fix the login timeout", "run-123").pipe(
        Effect.provide(EventBusLive)
      )
    )
    expect(result).toBe("fix-login-timeout")
  })

  it("falls back to untitled-timestamp on null result", async () => {
    const { executeWithPi } = await import("../../src/executors/pi/pi-executor.js")
    vi.mocked(executeWithPi).mockImplementationOnce(() => Effect.succeed(null as any))

    const result = await Effect.runPromise(
      determineChangeId("vague request", "run-456").pipe(
        Effect.provide(EventBusLive)
      )
    )
    expect(result).toContain("untitled-")
  })

  it("falls back to untitled-timestamp on missing change_id field", async () => {
    const { executeWithPi } = await import("../../src/executors/pi/pi-executor.js")
    vi.mocked(executeWithPi).mockImplementationOnce(() => Effect.succeed({ other: "data" }))

    const result = await Effect.runPromise(
      determineChangeId("another vague request", "run-789").pipe(
        Effect.provide(EventBusLive)
      )
    )
    expect(result).toContain("untitled-")
  })
})