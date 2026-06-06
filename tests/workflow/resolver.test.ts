import { describe, it, expect } from "vitest"
import { resolveWorkflowId } from "../../src/workflow/resolver.js"

describe("resolveWorkflowId", () => {
  it("returns input on exact match", () => {
    const available = new Set(["bug-fix", "feature"])
    expect(resolveWorkflowId("bug-fix", available)).toBe("bug-fix")
  })

  it("resolves --merge-worktree to -merge-worktree variant", () => {
    const available = new Set(["bug-fix-merge-worktree"])
    expect(resolveWorkflowId("bug-fix--merge-worktree", available)).toBe("bug-fix-merge-worktree")
  })

  it("resolves --github-pr to -github-pr variant", () => {
    const available = new Set(["bug-fix-github-pr"])
    expect(resolveWorkflowId("bug-fix--github-pr", available)).toBe("bug-fix-github-pr")
  })

  it("falls back to base workflow when no variant matches", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowId("bug-fix--merge", available)).toBe("bug-fix")
  })

  it("returns input unchanged when no -- separator", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowId("bug-fix", available)).toBe("bug-fix")
  })

  it("returns original input when nothing matches", () => {
    const available = new Set(["feature"])
    expect(resolveWorkflowId("unknown-workflow", available)).toBe("unknown-workflow")
  })
})