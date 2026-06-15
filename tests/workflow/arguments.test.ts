import { describe, it, expect } from "vitest"
import { resolveArguments } from "../../src/workflow/arguments.js"
import type { WorkflowTask, Arguments } from "../../src/types.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

function makeTask(args: Arguments): WorkflowTask {
  return { name: "test-task", arguments: args }
}

const baseEnv: WorkflowEnv = { tasks: {} }

describe("resolveArguments", () => {
  it("returns empty params and itemsCount 1 when no arguments", () => {
    const task: WorkflowTask = { name: "simple" }
    expect(resolveArguments(task, baseEnv)).toEqual({ parameters: {}, itemsCount: 1 })
  })

  it("resolves forEach items and exposes as parameters", () => {
    const env: WorkflowEnv = {
      tasks: { plan: { outputs: { tasks: [{ title: "A" }, { title: "B" }] } } }
    }
    const task = makeTask({
      forEach: { valueFrom: { ref: "inputs.tasks.plan.outputs.tasks" }, as: "current_task" }
    })
    const r = resolveArguments(task, env)
    expect(r.itemsCount).toBe(2)
    expect(r.parameters).toEqual({ current_task: { title: "B" } })
  })

  it("resolves explicit parameters from env", () => {
    const env: WorkflowEnv = {
      tasks: { setup: { outputs: { repo: "/tmp/repo", branch: "feat/x" } } }
    }
    const task = makeTask({
      parameters: [
        { name: "repository", valueFrom: { ref: "inputs.tasks.setup.outputs.repo" } }
      ]
    })
    expect(resolveArguments(task, env).parameters).toEqual({ repository: "/tmp/repo" })
  })

  it("makes forEach as-value available to parameter refs", () => {
    const env: WorkflowEnv = {
      tasks: { plan: { outputs: { tasks: ["item1", "item2"] } } }
    }
    const task = makeTask({
      forEach: { valueFrom: { ref: "inputs.tasks.plan.outputs.tasks" }, as: "item" },
      parameters: [
        { name: "wrapped", valueFrom: { ref: "inputs.parameters.item" } }
      ]
    })
    const r = resolveArguments(task, env)
    expect(r.parameters).toEqual({ item: "item2", wrapped: "item2" })
  })

  it("handles non-array forEach ref gracefully", () => {
    const env: WorkflowEnv = {
      tasks: { plan: { outputs: { tasks: "not-an-array" } } }
    }
    const task = makeTask({
      forEach: { valueFrom: { ref: "inputs.tasks.plan.outputs.tasks" }, as: "item" }
    })
    const r = resolveArguments(task, env)
    expect(r.itemsCount).toBe(1)
    expect(r.parameters).toEqual({ item: undefined })
  })
})