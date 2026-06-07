import { describe, it, expect } from "vitest"
import { parseDuration, topologicalSort, collectReachableTasks, buildRunId, buildTaskId, resolveTaskTimeout } from "../../src/workflow/engine.js"
import type { WorkflowTask } from "../../src/types.js"

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30)
  })

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300)
  })

  it("parses hours", () => {
    expect(parseDuration("1h")).toBe(3600)
  })

  it("parses just a number string as seconds", () => {
    expect(parseDuration("300")).toBe(300)
  })

  it("falls back to 300 for invalid duration", () => {
    expect(parseDuration("invalid")).toBe(300)
  })
})

describe("topologicalSort", () => {
  it("sorts tasks by dependency order", () => {
    const tasks: WorkflowTask[] = [
      { name: "review", dependencies: ["test"], agent: { ref: "agents.v", prompt: { content: "" } } },
      { name: "test", dependencies: ["implement"], agent: { ref: "agents.t", prompt: { content: "" } } },
      { name: "implement", agent: { ref: "agents.d", prompt: { content: "" } } }
    ]
    const sorted = topologicalSort(tasks)
    expect(sorted.map(t => t.name)).toEqual(["implement", "test", "review"])
  })

  it("handles tasks with no dependencies first", () => {
    const tasks: WorkflowTask[] = [
      { name: "b", dependencies: ["a"], agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "a", agent: { ref: "agents.x", prompt: { content: "" } } }
    ]
    expect(topologicalSort(tasks).map(t => t.name)).toEqual(["a", "b"])
  })

  it("handles multiple independent tasks", () => {
    const tasks: WorkflowTask[] = [
      { name: "x", agent: { ref: "agents.a", prompt: { content: "" } } },
      { name: "y", agent: { ref: "agents.a", prompt: { content: "" } } },
      { name: "z", dependencies: ["x", "y"], agent: { ref: "agents.a", prompt: { content: "" } } }
    ]
    expect(topologicalSort(tasks).map(t => t.name)).toEqual(["x", "y", "z"])
  })

  it("throws on circular dependency", () => {
    const tasks: WorkflowTask[] = [
      { name: "a", dependencies: ["b"], agent: { ref: "agents.x", prompt: { content: "" } } },
      { name: "b", dependencies: ["a"], agent: { ref: "agents.x", prompt: { content: "" } } }
    ]
    expect(() => topologicalSort(tasks)).toThrow("circular")
  })

  it("handles empty tasks list", () => {
    expect(topologicalSort([])).toEqual([])
  })
})

describe("collectReachableTasks", () => {
  it("collects tasks reachable from entrypoint", () => {
    const tasks: WorkflowTask[] = [
      { name: "plan", agent: { ref: "agents.p", prompt: { content: "" } } },
      { name: "setup", dependencies: ["plan"], agent: { ref: "agents.s", prompt: { content: "" } } },
      { name: "orphan", agent: { ref: "agents.o", prompt: { content: "" } } }
    ]
    const collected = collectReachableTasks(tasks, "plan")
    expect(collected.map(t => t.name)).toEqual(["plan", "setup"])
  })
})

describe("buildRunId", () => {
  it("generates a run ID with workflow name prefix", () => {
    const runId = buildRunId("feature-dev")
    expect(runId).toMatch(/^feature-dev-[A-Za-z0-9_-]{5}$/)
  })
})

describe("buildTaskId", () => {
  it("generates a compound task ID", () => {
    const taskId = buildTaskId("feature-dev-abcde", "plan")
    expect(taskId).toMatch(/^feature-dev-abcde-plan-[A-Za-z0-9_-]{5}$/)
  })

  it("sanitizes forward slashes in task names", () => {
    const taskId = buildTaskId("test-run", "codify/0")
    expect(taskId).toMatch(/^test-run-codify-0-[A-Za-z0-9_-]{5}$/)
    expect(taskId).not.toContain("/")
  })
})

describe("resolveTaskTimeout", () => {
  it("uses task-level timeout", () => {
    const task: WorkflowTask = {
      name: "t",
      agent: { ref: "agents.a", timeout: { fixed: "120s" }, prompt: { content: "" } }
    }
    expect(resolveTaskTimeout(task, "300s")).toBe(120)
  })

  it("falls back to global run timeout", () => {
    const task: WorkflowTask = {
      name: "t",
      agent: { ref: "agents.a", prompt: { content: "" } }
    }
    expect(resolveTaskTimeout(task, "300s")).toBe(300)
  })

  it("returns 300 when both are missing or invalid", () => {
    const task: WorkflowTask = {
      name: "t",
      agent: { ref: "agents.a", prompt: { content: "" } }
    }
    expect(resolveTaskTimeout(task, "invalid")).toBe(300)
  })
})