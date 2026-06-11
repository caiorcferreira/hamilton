import { describe, it, expect } from "vitest"
import type {
  WorkflowSpec,
  AgentManifest,
  WorkflowTask,
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
    const agent: AgentManifest = {
      metadata: { name: "planner" },
      dirPath: "/agents/planner",
      spec: {
        settings: {
          model: "deepseek-v4-pro-official",
          skills: ["hamilton-agents"]
        },
        systemPrompt: {
          agent: "agents/planner/AGENTS.md",
          soul: "agents/planner/SOUL.md"
        }
      },
      systemPrompt: {
        agent: "agents/planner/AGENTS.md",
        soul: "agents/planner/SOUL.md"
      }
    }
    expect(agent.metadata.name).toBe("planner")

    const onFailure: OnFailure = {
      max_retries: 4,
      escalate_to: "human"
    }
    expect(onFailure.max_retries).toBe(4)

    const task: WorkflowTask = {
      name: "plan",
      dependencies: [],
      agent: {
        executorRef: "planner",
        timeout: { fixed: "300s" },
        on_failure: onFailure,
        output: { schema: { content: { type: "object", properties: {} } } },
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
      metadata: { version: 1, name: "feature-dev" },
      spec: {
        run: runConfig,
        tasks: [task]
      },
      agentRegistry: new Map()
    }
    expect(spec.metadata.version).toBe(1)
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
        { name: "implement", agent: { executorRef: "developer", prompt: { content: "Implement" } } },
        { name: "test", dependencies: ["implement"], agent: { executorRef: "tester", prompt: { content: "Test" } } }
      ]
    }
    expect(task.tasks).toHaveLength(2)
    expect(task.tasks![0].name).toBe("implement")
  })
})