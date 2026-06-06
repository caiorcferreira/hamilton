import { describe, it, expect } from "vitest"
import type {
  WorkflowSpec,
  WorkflowAgent,
  WorkflowStep,
  AgentRole,
  AgentSlug,
  StepSlug,
  WorkflowSlug
} from "../src/types.js"

describe("types", () => {
  it("should exist as type-level exports", () => {
    const role: AgentRole = "analysis"
    expect(role).toBe("analysis")

    const agent: WorkflowAgent = {
      slug: "test" as AgentSlug,
      role: "coding",
      workspace: { baseDir: "agents/test", files: {} }
    }
    expect(agent.slug).toBe("test")

    const step: WorkflowStep = {
      slug: "step1" as StepSlug,
      agent: "test" as AgentSlug,
      input: "do something"
    }
    expect(step.agent).toBe("test")

    const spec: WorkflowSpec = {
      slug: "test-wf" as WorkflowSlug,
      name: "Test",
      version: 1,
      agents: [agent],
      steps: [step]
    }
    expect(spec.slug).toBe("test-wf")
  })
})