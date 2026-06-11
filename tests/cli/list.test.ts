import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { listWorkflows } from "../../src/cli/commands/list.js"

const validYaml = (name: string, desc?: string) => `apiVersion: dag.hamilton.io/v1alpha1
kind: Workflow
metadata:
  name: ${name}
  version: 1
  ${desc ? `description: "${desc}"` : ""}
spec:
  run:
    entrypoint: step-1
    timeout: 300s
  tasks:
    - name: step-1
      agent:
        executorRef: agent-1
        prompt:
          content: "Do stuff"
`

function makeAgentDir(agentsDir: string, name: string): void {
  const dir = Path.join(agentsDir, name)
  Fs.mkdirSync(dir, { recursive: true })
  Fs.writeFileSync(Path.join(dir, "INSTRUCTIONS.md"), `Agent ${name}`)
  Fs.writeFileSync(Path.join(dir, "agent.yml"), `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  settings:\n    model: default\n`)
}

describe("listWorkflows", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-list-"))
    process.env.HOME = tmpHome

    const agentsDir = Path.join(tmpHome, ".hamilton", "agents")
    makeAgentDir(agentsDir, "agent-1")
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("returns workflow list items from valid workflows", async () => {
    const wfDir = Path.join(tmpHome, ".hamilton", "workflows")
    Fs.mkdirSync(Path.join(wfDir, "alpha"), { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "alpha", "workflow.yml"), validYaml("alpha", "First workflow"))
    Fs.mkdirSync(Path.join(wfDir, "beta"), { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "beta", "workflow.yml"), validYaml("beta"))

    const exit = await Effect.runPromiseExit(listWorkflows)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const items = exit.value
      expect(items).toHaveLength(2)
      expect(items[0].name).toBe("alpha")
      expect(items[0].description).toBe("First workflow")
      expect(items[0].taskCount).toBe(1)
      expect(items[0].agentCount).toBe(1)
      expect(items[1].name).toBe("beta")
      expect(items[1].description).toBeUndefined()
    }
  })

  it("returns empty array when workflows dir does not exist", async () => {
    const exit = await Effect.runPromiseExit(listWorkflows)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("skips directories with invalid workflow YAML", async () => {
    const wfDir = Path.join(tmpHome, ".hamilton", "workflows")
    Fs.mkdirSync(Path.join(wfDir, "good"), { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "good", "workflow.yml"), validYaml("good"))
    Fs.mkdirSync(Path.join(wfDir, "bad"), { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "bad", "workflow.yml"), "invalid: {{{")

    const exit = await Effect.runPromiseExit(listWorkflows)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].name).toBe("good")
    }
  })
})