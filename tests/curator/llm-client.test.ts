import { describe, it, expect } from "vitest"
import { createLLMClient } from "../../src/curator/llm-client.js"

describe("createLLMClient", () => {
  it("creates a client with complete method", () => {
    const client = createLLMClient()
    expect(client).toHaveProperty("complete")
    expect(typeof client.complete).toBe("function")
  })

  it("complete throws when model not found", async () => {
    const client = createLLMClient()
    await expect(
      client.complete("nonexistent", "model", [] as unknown as any)
    ).rejects.toThrow()
  })
})