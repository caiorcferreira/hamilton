import { describe, it, expect } from "vitest"
import { computeStepOrder, buildRunId, buildStepId, resolveStepTimeout } from "../../src/workflow/engine.js"
import { WorkflowSpec, WorkflowAgent, WorkflowStep, WorkflowSlug, AgentSlug, StepSlug } from "../../src/types.js"

const makeAgent = (overrides: Partial<WorkflowAgent> = {}): WorkflowAgent => ({
  slug: "agent-1" as AgentSlug,
  role: "coding",
  workspace: { baseDir: "/tmp", files: {} },
  ...overrides
})

const makeStep = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  slug: "step-1" as StepSlug,
  agent: "agent-1" as AgentSlug,
  input: "do stuff",
  ...overrides
})

const makeSpec = (overrides: Partial<WorkflowSpec> = {}): WorkflowSpec => ({
  slug: "wf-1" as WorkflowSlug,
  name: "Test Workflow",
  version: 1,
  agents: [makeAgent()],
  steps: [makeStep()],
  ...overrides
})

describe("computeStepOrder", () => {
  it("returns step slugs in definition order", () => {
    const spec = makeSpec({
      steps: [
        makeStep({ slug: "first" as StepSlug, agent: "agent-1" as AgentSlug }),
        makeStep({ slug: "second" as StepSlug, agent: "agent-1" as AgentSlug }),
        makeStep({ slug: "third" as StepSlug, agent: "agent-1" as AgentSlug })
      ]
    })
    expect(computeStepOrder(spec)).toEqual(["first", "second", "third"])
  })
})

describe("buildRunId", () => {
  it("generates a run ID with workflow slug prefix and 5-char nanoid", () => {
    const runId = buildRunId("my-workflow")
    expect(runId).toMatch(/^my-workflow-[A-Za-z0-9_-]{5}$/)
  })
})

describe("buildStepId", () => {
  it("generates a compound step ID with runId, step slug, and 5-char nanoid", () => {
    const stepId = buildStepId("my-workflow-abcde", "plan")
    expect(stepId).toMatch(/^my-workflow-abcde-plan-[A-Za-z0-9_-]{5}$/)
  })

  it("generates unique IDs on successive calls", () => {
    const runId = "test-wf-x1y2z"
    const a = buildStepId(runId, "step-a")
    const b = buildStepId(runId, "step-a")
    expect(a).not.toBe(b)
  })
})

describe("resolveStepTimeout", () => {
  it("uses step timeout when available", () => {
    const spec = makeSpec({
      agents: [makeAgent({ slug: "agent-1" as AgentSlug, timeoutSeconds: 120 })],
      steps: [makeStep({ slug: "step-1" as StepSlug, agent: "agent-1" as AgentSlug, timeoutSeconds: 45 })],
      polling: { timeoutSeconds: 60 }
    })
    expect(resolveStepTimeout(spec, "step-1")).toBe(45)
  })

  it("falls back to agent timeout when step has no timeout", () => {
    const spec = makeSpec({
      agents: [makeAgent({ slug: "agent-1" as AgentSlug, timeoutSeconds: 120 })],
      polling: { timeoutSeconds: 60 }
    })
    expect(resolveStepTimeout(spec, "step-1")).toBe(120)
  })

  it("falls back to polling timeout when agent has no timeout", () => {
    const spec = makeSpec({
      agents: [makeAgent({ slug: "agent-1" as AgentSlug })],
      polling: { timeoutSeconds: 60 }
    })
    expect(resolveStepTimeout(spec, "step-1")).toBe(60)
  })

  it("defaults to 300 when nothing is set", () => {
    const spec = makeSpec({
      agents: [makeAgent({ slug: "agent-1" as AgentSlug })]
    })
    expect(resolveStepTimeout(spec, "step-1")).toBe(300)
  })

  it("step timeout takes priority over agent and polling", () => {
    const spec = makeSpec({
      agents: [makeAgent({ slug: "agent-1" as AgentSlug, timeoutSeconds: 200 })],
      steps: [makeStep({ slug: "step-1" as StepSlug, agent: "agent-1" as AgentSlug, timeoutSeconds: 50 })],
      polling: { timeoutSeconds: 100 }
    })
    expect(resolveStepTimeout(spec, "step-1")).toBe(50)
  })

  it("resolves per-step with different timeouts", () => {
    const spec = makeSpec({
      agents: [makeAgent({ slug: "agent-1" as AgentSlug, timeoutSeconds: 200 })],
      steps: [
        makeStep({ slug: "step-a" as StepSlug, agent: "agent-1" as AgentSlug, timeoutSeconds: 30 }),
        makeStep({ slug: "step-b" as StepSlug, agent: "agent-1" as AgentSlug })
      ]
    })
    expect(resolveStepTimeout(spec, "step-a")).toBe(30)
    expect(resolveStepTimeout(spec, "step-b")).toBe(200)
  })

  it("returns 300 for unknown step slug", () => {
    const spec = makeSpec()
    expect(resolveStepTimeout(spec, "nonexistent")).toBe(300)
  })
})