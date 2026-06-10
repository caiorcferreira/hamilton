import { describe, it, expect } from "vitest"
import { WorkflowSpecSchema, AgentManifestSchema } from "../src/schemas.js"
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
    expect(spec.metadata.version).toBe(1)
    expect(spec.metadata.name).toBe("feature-dev")
    expect(spec.spec.run.entrypoint).toBe("plan")
    expect(spec.spec.run.timeout).toBe("300s")
    expect(spec.spec.tasks).toHaveLength(4)
    expect(spec.spec.tasks[0].name).toBe("plan")
  })

  it("rejects a workflow with missing run.entrypoint", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "bad" },
      spec: {
        run: { timeout: "300s" },
        tasks: [{ name: "t", agent: { executorRef: "a", prompt: { content: "do" } } }]
      }
    }
    expect(() => decode(raw)).toThrow()
  })

  it("allows a task with only name when it has nested tasks", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "ok" },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [
          { name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } },
          { name: "t2", tasks: [{ name: "sub", agent: { executorRef: "a", prompt: { content: "x" } } }] }
        ]
      }
    }
    const spec = decode(raw)
    expect(spec.spec.tasks).toHaveLength(2)
  })

  it("allows a task with template reference", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "ok" },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [
          { name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } },
          { name: "t2", template: "t1" }
        ]
      }
    }
    const spec = decode(raw)
    expect(spec.spec.tasks[1].template).toBe("t1")
  })

  it("rejects a template reference to nonexistent task", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "bad" },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [
          { name: "t1", agent: { executorRef: "a", prompt: { content: "do" } } },
          { name: "t2", template: "nonexistent" }
        ]
      }
    }
    expect(() => decode(raw)).toThrow()
  })
})

describe("AgentManifestSchema (k8s envelope)", () => {
  it("parses a valid agent manifest with envelope", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Agent",
      metadata: { name: "planner" },
      spec: {
        settings: { model: "default" }
      }
    }
    const spec = Schema.decodeUnknownSync(AgentManifestSchema)(raw)
    expect(spec.metadata.name).toBe("planner")
    expect(spec.spec.settings.model).toBe("default")
  })

  it("rejects unknown apiVersion", () => {
    const raw = {
      apiVersion: "bad.io/v1",
      kind: "Agent",
      metadata: { name: "planner" },
      spec: { settings: {} }
    }
    expect(() => Schema.decodeUnknownSync(AgentManifestSchema)(raw)).toThrow()
  })

  it("rejects wrong kind", () => {
    const raw = {
      apiVersion: "dag.hamilton.io/v1alpha1",
      kind: "Pod",
      metadata: { name: "planner" },
      spec: { settings: {} }
    }
    expect(() => Schema.decodeUnknownSync(AgentManifestSchema)(raw)).toThrow()
  })
})