import { describe, it, expect } from "vitest"
import { resolveWorkflowSlug } from "../../src/workflow/resolver.js"

describe("resolveWorkflowSlug", () => {
  it("returns input on exact match", () => {
    const available = new Set(["bug-fix", "feature"])
    expect(resolveWorkflowSlug("bug-fix", available)).toBe("bug-fix")
  })

  it("strips --variants suffix and matches base", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowSlug("bug-fix--variants", available)).toBe("bug-fix")
  })

  it("returns input unchanged when no match", () => {
    const available = new Set(["feature"])
    expect(resolveWorkflowSlug("unknown", available)).toBe("unknown")
  })

  it("handles input without double-dash", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowSlug("bug-fix", available)).toBe("bug-fix")
  })
})
