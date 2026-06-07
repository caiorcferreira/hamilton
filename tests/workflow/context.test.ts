import { describe, it, expect } from "vitest"
import { resolveDottedPath, resolveTemplate, mergeContext, buildAutoContext } from "../../src/workflow/context.js"
import type { WorkflowTask } from "../../src/types.js"

describe("resolveDottedPath", () => {
  it("resolves a simple path", () => {
    const ctx = { plan: { outputs: { user_stories: ["a", "b"] } } }
    expect(resolveDottedPath(ctx, "plan.outputs.user_stories")).toEqual(["a", "b"])
  })

  it("resolves tasks.plan.outputs", () => {
    const ctx = { tasks: { plan: { outputs: { status: "done" } } } }
    expect(resolveDottedPath(ctx, "tasks.plan.outputs.status")).toBe("done")
  })

  it("resolves agents.planner", () => {
    const ctx = { agents: { planner: { role: "analysis" } } }
    expect(resolveDottedPath(ctx, "agents.planner.role")).toBe("analysis")
  })

  it("resolves vars.user_story", () => {
    const ctx = { vars: { user_story: { id: "US-001", title: "Foo" } } }
    expect(resolveDottedPath(ctx, "vars.user_story.id")).toBe("US-001")
  })

  it("returns undefined for missing path", () => {
    const ctx = { plan: { outputs: {} } }
    expect(resolveDottedPath(ctx, "plan.outputs.nonexistent")).toBeUndefined()
  })

  it("returns first-level key", () => {
    const ctx = { key: "value" }
    expect(resolveDottedPath(ctx, "key")).toBe("value")
  })
})

describe("resolveTemplate", () => {
  it("replaces {{key}} with context values", () => {
    expect(resolveTemplate("Hello {{name}}!", { name: "world" })).toBe("Hello world!")
  })

  it("keeps unreplaced templates intact", () => {
    expect(resolveTemplate("Hello {{name}}!", {})).toBe("Hello {{name}}!")
  })

  it("replaces multiple templates", () => {
    expect(resolveTemplate("{{a}} and {{b}}", { a: "1", b: "2" })).toBe("1 and 2")
  })

  it("stringifies non-string values", () => {
    expect(resolveTemplate("Items: {{items}}", { items: [1, 2, 3] })).toBe("Items: [1,2,3]")
  })

  it("stringifies objects", () => {
    expect(resolveTemplate("Context: {{ctx}}", { ctx: { plan: { status: "done" } } }))
      .toBe('Context: {"plan":{"status":"done"}}')
  })
})

describe("mergeContext", () => {
  it("shallow-merges two context objects", () => {
    expect(mergeContext({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" })
  })

  it("overwrites existing keys", () => {
    expect(mergeContext({ a: "1" }, { a: "2" })).toEqual({ a: "2" })
  })

  it("does not mutate inputs", () => {
    const a = { x: "1" }
    const b = { y: "2" }
    const result = mergeContext(a, b)
    expect(result).toEqual({ x: "1", y: "2" })
    expect(a).toEqual({ x: "1" })
  })
})

describe("buildAutoContext", () => {
  it("derives context from explicit fields", () => {
    const allOutputs = {
      tasks: {
        setup: { outputs: { repo: "/tmp/repo", branch: "feature/x", build_cmd: "npm run build" } }
      }
    }
    const vars = {}
    const task: WorkflowTask = {
      name: "codify",
      context: {
        fields: [
          { name: "repository", valueFrom: { ref: "tasks.setup.outputs.repo" } },
          { name: "current_branch", valueFrom: { ref: "tasks.setup.outputs.branch" } }
        ]
      }
    }
    const result = buildAutoContext(task, allOutputs, vars)
    expect(result).toEqual({ repository: "/tmp/repo", current_branch: "feature/x" })
  })

  it("derives context from all upstream outputs when no context.fields", () => {
    const allOutputs = {
      tasks: {
        plan: { outputs: { status: "done", user_stories: [] } },
        setup: { outputs: { repo: "/tmp/repo", build_cmd: "npm run build" } }
      }
    }
    const vars = {}
    const task: WorkflowTask = { name: "implement" }
    const result = buildAutoContext(task, allOutputs, vars)
    expect(result.tasks).toEqual(allOutputs.tasks)
  })

  it("resolves vars paths in context fields", () => {
    const allOutputs = { tasks: {} }
    const vars = { user_story: { id: "US-001", title: "Add feature" } }
    const task: WorkflowTask = {
      name: "codify",
      context: {
        fields: [
          { name: "story", valueFrom: { ref: "vars.user_story" } }
        ]
      }
    }
    const result = buildAutoContext(task, allOutputs, vars)
    expect(result.story).toEqual({ id: "US-001", title: "Add feature" })
  })
})