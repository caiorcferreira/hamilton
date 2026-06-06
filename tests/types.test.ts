import { describe, it, expect } from "vitest"
import type {
  WorkflowSpec,
  WorkflowAgent,
  WorkflowStep,
  AgentRole
} from "../src/types.js"

describe("types", () => {
  it("should exist as type-level exports", () => {
    const role: AgentRole = "analysis"
    expect(role).toBe("analysis")

    const agent: WorkflowAgent = {
      id: "test",
      role: "coding",
      workspace: { baseDir: "agents/test", files: {} }
    }
    expect(agent.id).toBe("test")

    const step: WorkflowStep = {
      id: "step1",
      agent: "test",
      input: "do something"
    }
    expect(step.agent).toBe("test")

    const spec: WorkflowSpec = {
      id: "test-wf",
      name: "Test",
      version: 1,
      agents: [agent],
      steps: [step]
    }
    expect(spec.id).toBe("test-wf")
  })
})