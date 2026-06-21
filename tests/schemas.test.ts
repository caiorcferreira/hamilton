import { describe, it, expect } from "vitest"
import { WorkflowSpecSchema, AgentManifestSchema, GuidelineSpecSchema } from "../src/schemas.js"
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
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
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
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
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
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
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
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
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

  it("accepts a valid script task", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "script-test" },
      spec: {
        run: { entrypoint: "setup", timeout: "300s" },
        tasks: [
          { name: "setup", script: { command: "npm install" } }
        ]
      }
    }
    const spec = decode(raw)
    expect(spec.spec.tasks[0].script.command).toBe("npm install")
  })

  it("accepts a script task with all optional fields", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "full-script" },
      spec: {
        run: { entrypoint: "build", timeout: "300s" },
        tasks: [
          {
            name: "build",
            script: {
              command: "npm run build",
              workdir: "/app",
              timeout: { fixed: "120s" },
              on_failure: { max_retries: 3 },
              output: { schema: { content: { type: "object", properties: { status: { type: "string" } }, required: ["status"] } } }
            }
          }
        ]
      }
    }
    const spec = decode(raw)
    expect(spec.spec.tasks[0].script.command).toBe("npm run build")
    expect(spec.spec.tasks[0].script.workdir).toBe("/app")
    expect(spec.spec.tasks[0].script.timeout?.fixed).toBe("120s")
    expect(spec.spec.tasks[0].script.on_failure?.max_retries).toBe(3)
  })

  it("rejects a task with both agent and script", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "bad" },
      spec: {
        run: { entrypoint: "t1", timeout: "300s" },
        tasks: [
          { name: "t1", agent: { executorRef: "a", prompt: { content: "do" } }, script: { command: "echo hi" } }
        ]
      }
    }
    expect(() => decode(raw)).toThrow()
  })

  it("accepts a template task with script as target", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Workflow",
      metadata: { version: 1, name: "template-script" },
      spec: {
        run: { entrypoint: "build-all", timeout: "300s" },
        tasks: [
          { name: "build-one", script: { command: "npm run build" } },
          { name: "build-all", template: "build-one" }
        ]
      }
    }
    const spec = decode(raw)
    expect(spec.spec.tasks[1].template).toBe("build-one")
  })
})

describe("AgentManifestSchema (k8s envelope)", () => {
  it("parses a valid agent manifest with envelope", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
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
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Pod",
      metadata: { name: "planner" },
      spec: { settings: {} }
    }
    expect(() => Schema.decodeUnknownSync(AgentManifestSchema)(raw)).toThrow()
  })
})

describe("GuidelineSpecSchema", () => {
  it("parses a valid guideline with instructions and rules", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Guideline",
      metadata: { name: "js-standards" },
      spec: {
        instructions: [
          { matching: ["**/*.js", "**/*.ts"], files: ["code-style.md"] }
        ],
        rules: [
          {
            name: "no-npm",
            toolNames: ["bash"],
            target: "command",
            pattern: "^npm",
            reason: "Use pnpm."
          }
        ]
      }
    }
    const spec = Schema.decodeUnknownSync(GuidelineSpecSchema)(raw)
    expect(spec.metadata.name).toBe("js-standards")
    expect(spec.spec.instructions?.[0].matching).toEqual(["**/*.js", "**/*.ts"])
    expect(spec.spec.instructions?.[0].files).toEqual(["code-style.md"])
    expect(spec.spec.rules).toHaveLength(1)
    expect(spec.spec.rules![0].name).toBe("no-npm")
    expect(spec.spec.rules![0].pattern).toBe("^npm")
  })

  it("parses a rules-only guideline", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Guideline",
      metadata: { name: "no-npm-only" },
      spec: {
        rules: [
          {
            name: "no-npm",
            toolNames: ["bash"],
            target: "command",
            pattern: "^npm",
            reason: "Use pnpm."
          }
        ]
      }
    }
    const spec = Schema.decodeUnknownSync(GuidelineSpecSchema)(raw)
    expect(spec.metadata.name).toBe("no-npm-only")
    expect(spec.spec.instructions).toBeUndefined()
    expect(spec.spec.rules).toHaveLength(1)
  })

  it("parses an instructions-only guideline", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Guideline",
      metadata: { name: "code-style" },
      spec: {
        instructions: [
          { matching: ["**/*.ts"], files: ["style.md"] }
        ]
      }
    }
    const spec = Schema.decodeUnknownSync(GuidelineSpecSchema)(raw)
    expect(spec.metadata.name).toBe("code-style")
    expect(spec.spec.instructions?.[0].matching).toEqual(["**/*.ts"])
    expect(spec.spec.rules).toBeUndefined()
  })

  it("parses a guideline with multiple rules", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Guideline",
      metadata: { name: "multi-rule" },
      spec: {
        rules: [
          { name: "r1", toolNames: ["bash"], target: "command", pattern: "^npm", reason: "no npm." },
          { name: "r2", toolNames: ["read"], target: "path", pattern: "secret", reason: "no secrets." }
        ]
      }
    }
    const spec = Schema.decodeUnknownSync(GuidelineSpecSchema)(raw)
    expect(spec.spec.rules).toHaveLength(2)
    expect(spec.spec.rules![1].toolNames).toEqual(["read"])
  })

  it("parses a minimal empty guideline", () => {
    const raw = {
      apiVersion: "dag.hamiltonai.dev/v1alpha1",
      kind: "Guideline",
      metadata: { name: "minimal" },
      spec: {}
    }
    const spec = Schema.decodeUnknownSync(GuidelineSpecSchema)(raw)
    expect(spec.metadata.name).toBe("minimal")
    expect(spec.spec.instructions).toBeUndefined()
    expect(spec.spec.rules).toBeUndefined()
  })
})