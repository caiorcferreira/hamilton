import { describe, it, expect } from "vitest"
import { WorkflowSpecSchema } from "../src/schemas.js"
import { Schema } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"

const decode = Schema.decodeUnknownSync(WorkflowSpecSchema)

describe("WorkflowSpecSchema", () => {
  it("parses a valid DAG workflow YAML", () => {
    const yaml = Fs.readFileSync(
      Path.join(import.meta.dirname, "fixtures", "feature-dev.yml"),
      "utf-8"
    )
    const raw = Yaml.parse(yaml)
    const spec = decode(raw)
    expect(spec.version).toBe(1)
    expect(spec.name).toBe("feature-dev")
    expect(spec.run.entrypoint).toBe("plan")
    expect(spec.run.timeout).toBe("300s")
    expect(spec.agents).toHaveLength(5)
    expect(spec.agents[0].name).toBe("planner")
    expect(spec.agents[0].role).toBe("analysis")
    expect(spec.agents[0].settings.systemPrompt.agent).toBe("agents/planner/AGENTS.md")
    expect(spec.tasks).toHaveLength(4)
    expect(spec.tasks[0].name).toBe("plan")
  })

  it("rejects a workflow with missing run.entrypoint", () => {
    const raw = {
      version: 1,
      name: "bad",
      run: { timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [{ name: "t", agent: { ref: "agents.a", prompt: { content: "do" } } }]
    }
    expect(() => decode(raw)).toThrow()
  })

  it("rejects a workflow with no agents", () => {
    const raw = {
      version: 1,
      name: "bad",
      run: { entrypoint: "t", timeout: "300s" },
      agents: [],
      tasks: [{ name: "t", agent: { ref: "agents.a", prompt: { content: "do" } } }]
    }
    expect(() => decode(raw)).toThrow()
  })

  it("rejects an invalid agent role", () => {
    const raw = {
      version: 1, name: "bad",
      run: { entrypoint: "t", timeout: "300s" },
      agents: [{ name: "a", role: "invalid", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [{ name: "t", agent: { ref: "agents.a", prompt: { content: "do" } } }]
    }
    expect(() => decode(raw)).toThrow()
  })

  it("allows a task with only name when it has nested tasks", () => {
    const raw = {
      version: 1, name: "ok",
      run: { entrypoint: "t1", timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [
        { name: "t1", agent: { ref: "agents.a", prompt: { content: "do" } } },
        { name: "t2", tasks: [{ name: "sub", agent: { ref: "agents.a", prompt: { content: "x" } } }] }
      ]
    }
    const spec = decode(raw)
    expect(spec.tasks).toHaveLength(2)
  })

  it("allows a task with template reference", () => {
    const raw = {
      version: 1, name: "ok",
      run: { entrypoint: "t1", timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [
        { name: "t1", agent: { ref: "agents.a", prompt: { content: "do" } } },
        { name: "t2", template: "t1" }
      ]
    }
    const spec = decode(raw)
    expect(spec.tasks[1].template).toBe("t1")
  })

  it("rejects a template reference to nonexistent task", () => {
    const raw = {
      version: 1, name: "bad",
      run: { entrypoint: "t1", timeout: "300s" },
      agents: [{ name: "a", role: "analysis", settings: { systemPrompt: { agent: "x", soul: "y", identity: "z" } } }],
      tasks: [
        { name: "t1", agent: { ref: "agents.a", prompt: { content: "do" } } },
        { name: "t2", template: "nonexistent" }
      ]
    }
    expect(() => decode(raw)).toThrow()
  })
})