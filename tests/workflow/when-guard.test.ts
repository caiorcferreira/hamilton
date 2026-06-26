import { describe, it, expect } from "vitest"
import { handleWhenGuard } from "../../src/workflow/when-guard.js"
import type { WorkflowTask, WorkflowEnv } from "../../src/types.js"

describe("handleWhenGuard", () => {
  it("returns proceed when task has no when condition", () => {
    const task: WorkflowTask = { name: "build", agent: { executorRef: "b", prompt: { content: "x" } } }
    const env: WorkflowEnv = {}
    expect(handleWhenGuard(task, env)).toBe("proceed")
  })

  it("returns skip when when condition evaluates to false", () => {
    const task: WorkflowTask = { name: "check", agent: { executorRef: "c", prompt: { content: "x" } }, when: "inputs.go == false" }
    const env: WorkflowEnv = { parameters: { go: false } }
    expect(handleWhenGuard(task, env)).toBe("skip")
  })

  it("returns proceed when when condition evaluates to true", () => {
    const task: WorkflowTask = { name: "check", agent: { executorRef: "c", prompt: { content: "x" } }, when: "inputs.parameters.go == true" }
    const env: WorkflowEnv = { parameters: { go: true } }
    expect(handleWhenGuard(task, env)).toBe("proceed")
  })

  it("returns error object for invalid when expression", () => {
    const task: WorkflowTask = { name: "check", agent: { executorRef: "c", prompt: { content: "x" } }, when: "inputs.+++" }
    const env: WorkflowEnv = {}
    const result = handleWhenGuard(task, env)
    expect(typeof result).toBe("object")
    expect((result as any)._tag).toBe("error")
  })
})