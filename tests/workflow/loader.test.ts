import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec, resolveWorkflowSpec, WorkflowNotFoundError, WorkflowParseError, AgentNotFoundError } from "../../src/workflow/loader.js"

const validYaml = `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: test-wf
  version: 1
spec:
  run:
    entrypoint: t1
    timeout: 300s
  tasks:
    - name: t1
      agent:
        executorRef: a1
        prompt:
          content: do it
`

const invalidYaml = `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: bad
  version: not-a-number
spec:
  run:
    entrypoint: t1
    timeout: 300s
  tasks:
    - name: t1
      agent:
        executorRef: a1
        prompt:
          content: do it
`

function makeAgentDir(agentsDir: string, name: string): void {
  const dir = Path.join(agentsDir, name)
  Fs.mkdirSync(dir, { recursive: true })
  Fs.writeFileSync(Path.join(dir, "INSTRUCTIONS.md"), `Agent ${name}`)
  Fs.writeFileSync(Path.join(dir, "agent.yml"), `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  settings:\n    model: default\n`)
}

describe("loadWorkflowSpec", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
    const wfDir = Path.join(tmpDir, "workflows", "test-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), validYaml)

    const badDir = Path.join(tmpDir, "workflows", "bad-wf")
    Fs.mkdirSync(badDir, { recursive: true })
    Fs.writeFileSync(Path.join(badDir, "workflow.yml"), invalidYaml)

    const agentsDir = Path.join(tmpDir, "agents")
    makeAgentDir(agentsDir, "a1")
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  })

  it("loads a valid DAG workflow YAML", async () => {
    const wfDir = Path.join(tmpDir, "workflows")
    const agentsDir = Path.join(tmpDir, "agents")
    const workflows = [{ name: "test-wf", dir: Path.join(wfDir, "test-wf") }]
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(wfDir, "test-wf", agentsDir, workflows))
    if (Exit.isSuccess(exit)) {
      expect(exit.value.metadata.name).toBe("test-wf")
      expect(exit.value.metadata.version).toBe(1)
      expect(exit.value.spec.run.entrypoint).toBe("t1")
      expect(exit.value.spec.run.timeout).toBe("300s")
      expect(exit.value.agentRegistry.has("a1")).toBe(true)
      expect(exit.value.spec.tasks).toHaveLength(1)
      expect(exit.value.spec.tasks[0].name).toBe("t1")
    } else {
      expect.unreachable("Expected success but got failure")
    }
  })

  it("fails with WorkflowNotFoundError for nonexistent workflow", async () => {
    const wfDir = Path.join(tmpDir, "workflows")
    const agentsDir = Path.join(tmpDir, "agents")
    const workflows = [{ name: "test-wf", dir: Path.join(wfDir, "test-wf") }]
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(wfDir, "nonexistent", agentsDir, workflows))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("WorkflowNotFoundError")
    }
  })

  it("fails with WorkflowParseError for invalid YAML", async () => {
    const wfDir = Path.join(tmpDir, "workflows")
    const agentsDir = Path.join(tmpDir, "agents")
    const workflows = [
      { name: "test-wf", dir: Path.join(wfDir, "test-wf") },
      { name: "bad-wf", dir: Path.join(wfDir, "bad-wf") }
    ]
    const exit = await Effect.runPromiseExit(loadWorkflowSpec(wfDir, "bad-wf", agentsDir, workflows))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("WorkflowParseError")
    }
  })

  it("fails with AgentNotFoundError when executorRef does not match", async () => {
    const wfDir = Path.join(tmpDir, "workflows")
    const agentsDir = Path.join(tmpDir, "agents")
    const workflows = [{ name: "test-wf", dir: Path.join(wfDir, "test-wf") }]

    const missingRefYaml = `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: test-wf
  version: 1
spec:
  run:
    entrypoint: t1
    timeout: 300s
  tasks:
    - name: t1
      agent:
        executorRef: nonexistent
        prompt:
          content: do it
`
    Fs.writeFileSync(Path.join(wfDir, "test-wf", "workflow.yml"), missingRefYaml)

    const exit = await Effect.runPromiseExit(loadWorkflowSpec(wfDir, "test-wf", agentsDir, workflows))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const cause = exit.cause
      const defect = cause._tag === "Fail" ? cause.error : undefined
      expect(defect?._tag).toBe("AgentNotFoundError")
    }
  })
})

describe("resolveWorkflowSpec", () => {
  it("resolves prompt.file by reading file from workflow dir", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const wfDir = Path.join(tmpDir, "prompt-file-wf")
      const promptsDir = Path.join(wfDir, "prompts")
      Fs.mkdirSync(promptsDir, { recursive: true })
      Fs.writeFileSync(Path.join(promptsDir, "my-prompt.md"), "prompt from file")
      const spec = {
        apiVersion: "dag.hamilton.io/v1alpha1",
        kind: "Workflow",
        metadata: { name: "prompt-file-wf", version: 1 },
        spec: {
          run: { entrypoint: "t1", timeout: "300s" },
          tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { file: "prompts/my-prompt.md" } } }]
        }
      }
      const resolved = resolveWorkflowSpec(wfDir, spec)
      expect(resolved.spec.tasks[0].agent.prompt.content).toBe("prompt from file")
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("resolves schema.file by reading and parsing JSON from workflow dir", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const wfDir = Path.join(tmpDir, "schema-file-wf")
      const schemasDir = Path.join(wfDir, "schemas")
      Fs.mkdirSync(schemasDir, { recursive: true })
      Fs.writeFileSync(Path.join(schemasDir, "out.json"), JSON.stringify({ type: "object", required: ["status"], properties: { status: { type: "string" } } }))
      const spec = {
        apiVersion: "dag.hamilton.io/v1alpha1",
        kind: "Workflow",
        metadata: { name: "schema-file-wf", version: 1 },
        spec: {
          run: { entrypoint: "t1", timeout: "300s" },
          tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { content: "do" }, output: { schema: { file: "schemas/out.json" } } } }]
        }
      }
      const resolved = resolveWorkflowSpec(wfDir, spec)
      expect(resolved.spec.tasks[0].agent.output.schema.content).toEqual({ type: "object", required: ["status"], properties: { status: { type: "string" } } })
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("throws on nonexistent prompt file", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const spec = {
        apiVersion: "dag.hamilton.io/v1alpha1",
        kind: "Workflow",
        metadata: { name: "bad", version: 1 },
        spec: {
          run: { entrypoint: "t1", timeout: "300s" },
          tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { file: "nonexistent.md" } } }]
        }
      }
      expect(() => resolveWorkflowSpec(tmpDir, spec)).toThrow("Prompt file not found: nonexistent.md")
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("throws on nonexistent schema file", () => {
    const tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-resolve-"))
    try {
      const spec = {
        apiVersion: "dag.hamilton.io/v1alpha1",
        kind: "Workflow",
        metadata: { name: "bad", version: 1 },
        spec: {
          run: { entrypoint: "t1", timeout: "300s" },
          tasks: [{ name: "t1", agent: { executorRef: "a1", prompt: { content: "do" }, output: { schema: { file: "nonexistent.json" } } } }]
        }
      }
      expect(() => resolveWorkflowSpec(tmpDir, spec)).toThrow("Schema file not found: nonexistent.json")
    } finally {
      Fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})