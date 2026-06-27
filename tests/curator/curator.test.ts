import { describe, it, expect } from "vitest"
import { createCurator } from "../../src/curator/curator.js"
import type { LLMClient } from "../../src/curator/llm-client.js"

describe("createCurator", () => {
  it("creates a curator with suggestMemoryFilters", () => {
    const mockClient: LLMClient = {
      complete: async () => { throw new Error("unused") }
    }
    const curator = createCurator(mockClient)
    expect(curator).toHaveProperty("suggestMemoryFilters")
    expect(curator).toHaveProperty("findRelevantAtoms")
  })

  it("suggestMemoryFilters returns valid structure even on LLM failure", async () => {
    const mockClient: LLMClient = {
      complete: async () => {
        throw new Error("LLM unavailable")
      },
    }
    const curator = createCurator(mockClient)
    const result = await curator.suggestMemoryFilters("Fix the build", ["src/index.ts"])
    expect(result).toHaveProperty("tags")
    expect(result).toHaveProperty("languages")
    expect(result).toHaveProperty("filePaths")
    expect(Array.isArray(result.tags)).toBe(true)
    expect(Array.isArray(result.languages)).toBe(true)
    expect(Array.isArray(result.filePaths)).toBe(true)
  })

  it("suggestMemoryFilters returns parsed results on success", async () => {
    const mockClient: LLMClient = {
      complete: async () => ({
        role: "assistant" as const,
        content: [{ type: "text" as const, text: JSON.stringify({ tags: ["testing"], languages: ["lang:typescript"], filePaths: ["src/test.ts"] }) }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop" as const,
        timestamp: Date.now(),
        api: "openai" as const,
        provider: "openai" as const,
        model: "gpt-4",
      }),
    }
    const curator = createCurator(mockClient)
    const result = await curator.suggestMemoryFilters("Write unit tests", ["src/test.ts"])
    expect(result.tags).toContain("testing")
    expect(result.languages).toContain("lang:typescript")
    expect(result.filePaths).toContain("src/test.ts")
  })
})