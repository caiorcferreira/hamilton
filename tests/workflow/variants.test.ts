import { describe, it, expect } from "vitest"
import { composeVariants, UnsupportedVariantError } from "../../src/workflow/variants.js"
import type { WorkflowSpec, WorkflowTask } from "../../src/types.js"

function baseSpec(tasks: WorkflowTask[]): WorkflowSpec {
  return {
    version: 1,
    name: "test-wf",
    run: { entrypoint: "plan", timeout: "300s" },
    variants: { supported: ["branchout", "worktree", "merge"] },
    agents: [{ name: "setup", role: "coding", settings: { systemPrompt: { agent: "a", soul: "s", identity: "i" } } }],
    tasks
  }
}

describe("composeVariants", () => {
  it("returns base spec unchanged when no variants active", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, [])
    expect(result.tasks.map(t => t.name)).toEqual(["plan"])
  })

  it("injects start task before entrypoint", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["branchout"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-branch", "plan"])
  })

  it("injects end task after DAG leaves", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["merge"])
    expect(result.tasks.map(t => t.name)).toEqual(["plan", "finalize-merge"])
  })

  it("applies replaces: worktree supersedes branchout", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["branchout", "worktree"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree"])
  })

  it("chains multiple end tasks in supported order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["merge", "worktree"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree", "finalize-merge"])
  })

  it("throws on unsupported variant", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    expect(() => composeVariants(spec, ["nope"])).toThrow(UnsupportedVariantError)
  })

  it("respects supported order, not CLI order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["worktree", "branchout"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree"])
  })

  it("merges variant agents without duplicates", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["merge"])
    const agentNames = result.agents.map(a => a.name)
    expect(agentNames).toContain("setup")
    expect(agentNames).toContain("merger")
  })

  it("does not mutate input spec", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const originalAgentCount = spec.agents.length
    const originalTaskCount = spec.tasks.length
    composeVariants(spec, ["merge"])
    expect(spec.agents.length).toBe(originalAgentCount)
    expect(spec.tasks.length).toBe(originalTaskCount)
  })

  it("handles DAG with branching leaves", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } },
      { name: "task-a", dependencies: ["plan"], agent: { ref: "agents.setup", prompt: { content: "" } } },
      { name: "task-b", dependencies: ["plan"], agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["merge"])
    expect(result.tasks.map(t => t.name)).toEqual(["plan", "task-a", "task-b", "finalize-merge"])
    const mergeTask = result.tasks.find(t => t.name === "finalize-merge")
    expect(mergeTask!.dependencies).toEqual(["task-a", "task-b"])
  })
})
