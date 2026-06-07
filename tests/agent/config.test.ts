import { describe, it, expect } from "vitest"
import { resolveAgentDefaults } from "../../src/agent/config.js"
import type { AgentSettings } from "../../src/types.js"

const baseSettings: AgentSettings = {
  systemPrompt: { agent: "a.md", soul: "s.md", identity: "i.md" }
}

describe("resolveAgentDefaults", () => {
  it("defaults model to 'default' when undefined", () => {
    const result = resolveAgentDefaults(baseSettings)
    expect(result.model).toBe("default")
  })

  it("preserves explicit model when set", () => {
    const result = resolveAgentDefaults({ ...baseSettings, model: "glm-5.1" })
    expect(result.model).toBe("glm-5.1")
  })

  it("defaults skills to null when undefined", () => {
    const result = resolveAgentDefaults(baseSettings)
    expect(result.skills).toBeNull()
  })

  it("preserves explicit skills when set", () => {
    const result = resolveAgentDefaults({ ...baseSettings, skills: ["debugging"] })
    expect(result.skills).toEqual(["debugging"])
  })
})