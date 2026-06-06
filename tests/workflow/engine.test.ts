import { describe, it, expect } from "vitest"
import { computeStepOrder, buildRunId, resolveStepTimeout } from "../../src/workflow/engine.js"
import { WorkflowSpec, WorkflowAgent, WorkflowStep } from "../../src/types.js"

const makeAgent = (overrides: Partial<WorkflowAgent> = {}): WorkflowAgent => ({
  id: "agent-1",
  role: "coding",
  workspace: { baseDir: "/tmp", files: {} },
  ...overrides
})

const makeStep = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: "step-1",
  agent: "agent-1",
  input: "do stuff",
  ...overrides
})

const makeSpec = (overrides: Partial<WorkflowSpec> = {}): WorkflowSpec => ({
  id: "wf-1",
  name: "Test Workflow",
  version: 1,
  agents: [makeAgent()],
  steps: [makeStep()],
  ...overrides
})

describe("computeStepOrder", () => {
  it("returns step IDs in definition order", () => {
    const spec = makeSpec({
      steps: [
        makeStep({ id: "first", agent: "agent-1" }),
        makeStep({ id: "second", agent: "agent-1" }),
        makeStep({ id: "third", agent: "agent-1" })
      ]
    })
    expect(computeStepOrder(spec)).toEqual(["first", "second", "third"])
  })
})

describe("buildRunId", () => {
  it("generates a run ID with workflow ID prefix and UUID", () => {
    const runId = buildRunId("my-workflow")
    expect(runId).toMatch(/^my-workflow-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe("resolveStepTimeout", () => {
  it("uses agent timeout when available", () => {
    const spec = makeSpec({
      agents: [makeAgent({ id: "agent-1", timeoutSeconds: 120 })],
      polling: { timeoutSeconds: 60 }
    })
    expect(resolveStepTimeout(spec, "agent-1")).toBe(120)
  })

  it("falls back to polling timeout when agent has no timeout", () => {
    const spec = makeSpec({
      agents: [makeAgent({ id: "agent-1" })],
      polling: { timeoutSeconds: 60 }
    })
    expect(resolveStepTimeout(spec, "agent-1")).toBe(60)
  })

  it("defaults to 300 when neither is set", () => {
    const spec = makeSpec({
      agents: [makeAgent({ id: "agent-1" })]
    })
    expect(resolveStepTimeout(spec, "agent-1")).toBe(300)
  })
})