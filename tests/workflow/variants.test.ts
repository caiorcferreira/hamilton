import { describe, it, expect } from "vitest"
import { composeVariants, UnsupportedVariantError } from "../../src/workflow/variants.js"
import type { AgentManifest, WorkflowSpec, WorkflowTask } from "../../src/types.js"

function baseSpec(tasks: WorkflowTask[]): WorkflowSpec {
  const agent: AgentManifest = {
    metadata: { name: "setup" },
    dirPath: "/agents/setup",
    spec: { settings: { model: "default" }, systemPrompt: { agent: "INSTRUCTIONS.md", soul: "SOUL.md" } },
    systemPrompt: { agent: "INSTRUCTIONS.md", soul: "SOUL.md" }
  }
  const agentRegistry = new Map<string, AgentManifest>([["setup", agent]])
  return {
    metadata: { version: 1, name: "test-wf" },
    spec: {
      run: { entrypoint: "plan", timeout: "300s" },
      variants: { supported: ["branchout", "worktree", "merge"] },
      tasks
    },
    agentRegistry
  }
}

describe("composeVariants", () => {
  it("returns base spec unchanged when no variants active", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, spec.agentRegistry, [])
    expect(result.spec.tasks.map(t => t.name)).toEqual(["plan"])
  })

  it("injects start task before entrypoint", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, spec.agentRegistry, ["branchout"])
    expect(result.spec.tasks.map(t => t.name)).toEqual(["create-branch", "plan"])
  })

  it("injects end task after DAG leaves", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, spec.agentRegistry, ["merge"])
    expect(result.spec.tasks.map(t => t.name)).toEqual(["plan", "finalize-merge"])
  })

  it("applies replaces: worktree supersedes branchout", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, spec.agentRegistry, ["branchout", "worktree"])
    expect(result.spec.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree"])
  })

  it("chains multiple end tasks in supported order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, spec.agentRegistry, ["merge", "worktree"])
    expect(result.spec.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree", "finalize-merge"])
  })

  it("throws on unsupported variant", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    expect(() => composeVariants(spec, spec.agentRegistry, ["nope"])).toThrow(UnsupportedVariantError)
  })

  it("respects supported order, not CLI order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, spec.agentRegistry, ["worktree", "branchout"])
    expect(result.spec.tasks.map(t => t.name)).toEqual(["create-worktree", "plan", "cleanup-worktree"])
  })

  it("does not mutate input spec", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const originalTaskCount = spec.spec.tasks.length
    composeVariants(spec, spec.agentRegistry, ["merge"])
    expect(spec.spec.tasks.length).toBe(originalTaskCount)
  })

  it("handles DAG with branching leaves", () => {
    const spec = baseSpec([
      { name: "plan", agent: { executorRef: "setup", prompt: { content: "" } } },
      { name: "task-a", dependencies: ["plan"], agent: { executorRef: "setup", prompt: { content: "" } } },
      { name: "task-b", dependencies: ["plan"], agent: { executorRef: "setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, spec.agentRegistry, ["merge"])
    expect(result.spec.tasks.map(t => t.name)).toEqual(["plan", "task-a", "task-b", "finalize-merge"])
    const mergeTask = result.spec.tasks.find(t => t.name === "finalize-merge")
    expect(mergeTask!.dependencies).toEqual(["task-a", "task-b"])
  })
})