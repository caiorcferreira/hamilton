import { describe, it, expect } from "vitest"
import { resolveWorkflowSlug, findNearestSlugs } from "../../src/workflow/resolver.js"

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

describe("findNearestSlugs", () => {
it("findNearestSlugs returns top 3 nearest matches sorted by distance", () => {
    const available = new Set(["feature-dev", "feature-review", "bug-fix", "hotfix", "deploy"])
    expect(findNearestSlugs("featuer-dev", available)).toEqual(["feature-dev", "feature-review", "bug-fix"])
  })

it("findNearestSlugs returns empty array when available set is empty", () => {
    expect(findNearestSlugs("anything", new Set())).toEqual([])
  })

  it("findNearestSlugs returns exact match first with distance 0", () => {
    const available = new Set(["bug-fix", "feature"])
    expect(findNearestSlugs("bug-fix", available)).toEqual(["bug-fix", "feature"])
  })

it("findNearestSlugs handles case where available has fewer than 3 entries", () => {
    const available = new Set(["abc"])
    expect(findNearestSlugs("xyz", available)).toEqual(["abc"])
  })
})
