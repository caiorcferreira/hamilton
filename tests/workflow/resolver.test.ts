import { describe, it, expect } from "vitest"
import { resolveWorkflowSlug } from "../../src/workflow/resolver.js"

describe("resolveWorkflowSlug", () => {
  it("returns input on exact match", () => {
    const available = new Set(["bug-fix", "feature"])
    expect(resolveWorkflowSlug("bug-fix", available)).toBe("bug-fix")
  })

  it("resolves --merge-worktree to -merge-worktree variant", () => {
    const available = new Set(["bug-fix-merge-worktree"])
    expect(resolveWorkflowSlug("bug-fix--merge-worktree", available)).toBe("bug-fix-merge-worktree")
  })

  it("resolves --github-pr to -github-pr variant", () => {
    const available = new Set(["bug-fix-github-pr"])
    expect(resolveWorkflowSlug("bug-fix--github-pr", available)).toBe("bug-fix-github-pr")
  })

  it("falls back to base workflow when no variant matches", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowSlug("bug-fix--merge", available)).toBe("bug-fix")
  })

  it("returns input unchanged when no -- separator", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowSlug("bug-fix", available)).toBe("bug-fix")
  })

  it("returns original input when nothing matches", () => {
    const available = new Set(["feature"])
    expect(resolveWorkflowSlug("unknown-workflow", available)).toBe("unknown-workflow")
  })
})