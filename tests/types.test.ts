import { describe, it, expect } from "vitest"
import type {
  WorkflowSpec,
  WorkflowAgent,
  WorkflowTask,
  AgentRole,
  AgentName,
  TaskName,
  RunId,
  TaskId,
  OnFailure,
  Timeout,
  Prompt,
  OutputConfig,
  ForEach,
  ContextFields,
  RunConfig
} from "../src/types.js"

describe("types", () => {
  it("should exist as type-level exports", () => {
    const role: AgentRole = "analysis"
    expect(role).toBe("analysis")

    const agent: WorkflowAgent = {
      name: "planner",
      role: "analysis",
      description: "Decomposes tasks",
      settings: {
        model: "deepseek-v4-pro-official",
        systemPrompt: {
          agent: "agents/planner/AGENTS.md",
          soul: "agents/planner/SOUL.md",
          identity: "agents/planner/IDENTITY.md"
        },
        skills: ["hamilton-agents"]
      }
    }
    expect(agent.name).toBe("planner")

    const onFailure: OnFailure = {
      max_retries: 4,
      escalate_to: "human"
    }
    expect(onFailure.max_retries).toBe(4)

    const task: WorkflowTask = {
      name: "plan",
      dependencies: [],
      agent: {
        ref: "agents.planner",
        timeout: { fixed: "300s" },
        on_failure: onFailure,
        output: { schema: { type: "object", properties: {} } },
        prompt: { content: "Do the thing {{task}}" }
      }
    }
    expect(task.name).toBe("plan")

    const runConfig: RunConfig = {
      entrypoint: "plan",
      timeout: "300s"
    }
    expect(runConfig.entrypoint).toBe("plan")

    const spec: WorkflowSpec = {
      version: 1,
      name: "feature-dev",
      run: runConfig,
      agents: [agent],
      tasks: [task]
    }
    expect(spec.version).toBe(1)
  })

  it("WorkflowTask with template and forEach", () => {
    const task: WorkflowTask = {
      name: "codify",
      dependencies: ["setup"],
      template: "develop",
      forEach: {
        valueFrom: { ref: "tasks.plan.outputs.user_stories" },
        as: "user_story"
      },
      context: {
        fields: [
          { name: "setup", valueFrom: { ref: "tasks.setup.outputs" } }
        ]
      }
    }
    expect(task.template).toBe("develop")
    expect(task.forEach?.as).toBe("user_story")
  })

  it("WorkflowTask with nested sub-tasks (template)", () => {
    const task: WorkflowTask = {
      name: "develop",
      tasks: [
        { name: "implement", agent: { ref: "agents.developer", prompt: { content: "Implement" } } },
        { name: "test", dependencies: ["implement"], agent: { ref: "agents.tester", prompt: { content: "Test" } } }
      ]
    }
    expect(task.tasks).toHaveLength(2)
    expect(task.tasks![0].name).toBe("implement")
  })
})