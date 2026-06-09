import { describe, it, expect } from "vitest"
import { mergeContext, buildAutoContext } from "../../src/workflow/context.js"
import type { WorkflowTask } from "../../src/types.js"

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

  it("merges vars into allOutputs when no context.fields defined", () => {
    const allOutputs = {
      tasks: {
        setup: { outputs: { repo: "/tmp/repo" } }
      }
    }
    const vars = { current_story: { id: "US-001", title: "Add feature" } }
    const task: WorkflowTask = { name: "implement-story" }
    const result = buildAutoContext(task, allOutputs, vars)
    expect(result.tasks).toEqual(allOutputs.tasks)
    expect(result.current_story).toEqual({ id: "US-001", title: "Add feature" })
  })
})