import { describe, it, expect } from "vitest"
import { resolveDottedPath, resolveTemplate } from "../../src/prompts/template.js"

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

  it("resolves first-level key", () => {
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

  it("resolves dotted-path placeholders", () => {
    const ctx = {
      tasks: {
        setup: { outputs: { repo: "/tmp/repo", branch: "feature/x", build_cmd: "npm run build" } },
        plan: { outputs: { stories_json: [{ id: "US-001" }] } }
      }
    }
    expect(resolveTemplate("REPO: {{tasks.setup.outputs.repo}}", ctx)).toBe("REPO: /tmp/repo")
    expect(resolveTemplate("BRANCH: {{tasks.setup.outputs.branch}}", ctx)).toBe("BRANCH: feature/x")
    expect(resolveTemplate("BUILD: {{tasks.setup.outputs.build_cmd}}", ctx)).toBe("BUILD: npm run build")
    expect(resolveTemplate("STORIES: {{tasks.plan.outputs.stories_json}}", ctx))
      .toBe('STORIES: [{"id":"US-001"}]')
  })

  it("resolves vars from forEach vars", () => {
    const ctx = { vars: { current_story: { id: "US-001", title: "Add feature" } } }
    expect(resolveTemplate("STORY: {{vars.current_story}}", ctx))
      .toBe('STORY: {"id":"US-001","title":"Add feature"}')
    expect(resolveTemplate("ID: {{vars.current_story.id}}", ctx)).toBe("ID: US-001")
    expect(resolveTemplate("TITLE: {{vars.current_story.title}}", ctx)).toBe("TITLE: Add feature")
  })

  it("resolves multi-level dotted path", () => {
    const ctx = { tasks: { setup: { outputs: { repo: { url: "github.com/x" } } } } }
    expect(resolveTemplate("URL: {{tasks.setup.outputs.repo.url}}", ctx)).toBe("URL: github.com/x")
  })

  it("keeps unreplaced template with dotted path intact", () => {
    expect(resolveTemplate("MISSING: {{tasks.nonexistent.field}}", {})).toBe("MISSING: {{tasks.nonexistent.field}}")
  })
})