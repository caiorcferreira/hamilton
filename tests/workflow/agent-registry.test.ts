import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  loadAgentManifests,
  DuplicateAgentError,
  AgentManifestParseError
} from "../../src/workflow/agent-registry.js"
import type { WorkflowDescriptor } from "../../src/workflow/agent-registry.js"

describe("agent-registry", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-agent-registry-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeAgentYaml(dir: string, name: string, settings?: Record<string, unknown>) {
    Fs.mkdirSync(dir, { recursive: true })
    const settingsYaml = settings
      ? Object.entries(settings).map(([k, v]) => `    ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")
      : "    model: default"
    const yaml = `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: ${name}\nspec:\n  settings:\n${settingsYaml}\n`
    Fs.writeFileSync(Path.join(dir, "agent.yml"), yaml)
  }

  function makeSiblingFiles(dir: string, files: { instructions?: string; soul?: string }) {
    Fs.mkdirSync(dir, { recursive: true })
    if (files.instructions !== undefined) Fs.writeFileSync(Path.join(dir, "INSTRUCTIONS.md"), files.instructions)
    if (files.soul !== undefined) Fs.writeFileSync(Path.join(dir, "SOUL.md"), files.soul)
  }

  describe("loading shared agent manifests", () => {
    it("loads agents from shared dir into registry", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      makeAgentYaml(Path.join(sharedDir, "doer"), "doer")
      makeSiblingFiles(Path.join(sharedDir, "doer"), {
        instructions: "You are doer",
        soul: "Doer soul"
      })

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, [])
      )
      expect(Exit.isSuccess(result)).toBe(true)
      if (Exit.isSuccess(result)) {
        const registry = result.value
        expect(registry.has("doer")).toBe(true)
        expect(registry.get("doer")!.metadata.name).toBe("doer")
        expect(registry.get("doer")!.systemPrompt.agent).toBe("INSTRUCTIONS.md")
        expect(registry.get("doer")!.systemPrompt.soul).toBe("SOUL.md")
      }
    })
  })

  describe("merging shared + workflow-local manifests", () => {
    it("merges shared and workflow-local agents into single registry", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      makeAgentYaml(Path.join(sharedDir, "doer"), "doer")
      makeSiblingFiles(Path.join(sharedDir, "doer"), {
        instructions: "Shared doer",
        soul: "Shared soul"
      })

      const wfDir = Path.join(tmpDir, "workflows", "my-wf")
      makeAgentYaml(Path.join(wfDir, "agents", "reviewer"), "reviewer")
      makeSiblingFiles(Path.join(wfDir, "agents", "reviewer"), {
        instructions: "Reviewer agent",
        soul: "Reviewer soul"
      })

      const workflows: WorkflowDescriptor[] = [{ name: "my-wf", dir: wfDir }]

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, workflows)
      )
      expect(Exit.isSuccess(result)).toBe(true)
      if (Exit.isSuccess(result)) {
        const registry = result.value
        expect(registry.has("doer")).toBe(true)
        expect(registry.has("reviewer")).toBe(true)
      }
    })

    it("rejects shared agent and workflow-local agent with same name", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      makeAgentYaml(Path.join(sharedDir, "dup"), "dup")
      makeSiblingFiles(Path.join(sharedDir, "dup"), {
        instructions: "Shared",
        soul: "Shared soul"
      })

      const wf1Dir = Path.join(tmpDir, "workflows", "wf1")
      makeAgentYaml(Path.join(wf1Dir, "agents", "dup"), "dup")
      makeSiblingFiles(Path.join(wf1Dir, "agents", "dup"), {
        instructions: "Local",
        soul: "Local soul"
      })

      const workflows: WorkflowDescriptor[] = [{ name: "wf1", dir: wf1Dir }]

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, workflows)
      )
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause._tag === "Fail" ? result.cause.error : null
        expect(error).toBeInstanceOf(DuplicateAgentError)
      }
    })
  })

  describe("rejecting duplicate agent names", () => {
    it("fails when two workflows define an agent with the same name", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      Fs.mkdirSync(sharedDir, { recursive: true })

      const wf1Dir = Path.join(tmpDir, "workflows", "wf1")
      makeAgentYaml(Path.join(wf1Dir, "agents", "shared-name"), "shared-name")
      makeSiblingFiles(Path.join(wf1Dir, "agents", "shared-name"), {
        instructions: "WF1 agent",
        soul: "WF1 soul"
      })

      const wf2Dir = Path.join(tmpDir, "workflows", "wf2")
      makeAgentYaml(Path.join(wf2Dir, "agents", "shared-name"), "shared-name")
      makeSiblingFiles(Path.join(wf2Dir, "agents", "shared-name"), {
        instructions: "WF2 agent",
        soul: "WF2 soul"
      })

      const workflows: WorkflowDescriptor[] = [
        { name: "wf1", dir: wf1Dir },
        { name: "wf2", dir: wf2Dir }
      ]

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, workflows)
      )
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause._tag === "Fail" ? result.cause.error : null
        expect(error).toBeInstanceOf(DuplicateAgentError)
      }
    })

    it("rejects when shared agent and workflow-local agent have same name", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      makeAgentYaml(Path.join(sharedDir, "dup"), "dup")
      makeSiblingFiles(Path.join(sharedDir, "dup"), {
        instructions: "Shared",
        soul: "Shared soul"
      })

      const wf1Dir = Path.join(tmpDir, "workflows", "wf1")
      makeAgentYaml(Path.join(wf1Dir, "agents", "dup"), "dup")
      makeSiblingFiles(Path.join(wf1Dir, "agents", "dup"), {
        instructions: "Local",
        soul: "Local soul"
      })

      const workflows: WorkflowDescriptor[] = [{ name: "wf1", dir: wf1Dir }]

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, workflows)
      )
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause._tag === "Fail" ? result.cause.error : null
        expect(error).toBeInstanceOf(DuplicateAgentError)
      }
    })
  })

  describe("rejecting name/directory mismatch", () => {
    it("fails when agent.yml name does not match directory name", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      makeAgentYaml(Path.join(sharedDir, "doer"), "wrong-name")
      makeSiblingFiles(Path.join(sharedDir, "doer"), {
        instructions: "Agent",
        soul: "Soul"
      })

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, [])
      )
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause._tag === "Fail" ? result.cause.error : null
        expect(error).toBeInstanceOf(AgentManifestParseError)
      }
    })
  })

  describe("systemPrompt defaulting", () => {
    it("defaults systemPrompt to sibling filenames when files exist", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      makeAgentYaml(Path.join(sharedDir, "doer"), "doer")
      makeSiblingFiles(Path.join(sharedDir, "doer"), {
        instructions: "You are doer",
        soul: "Doer soul"
      })

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, [])
      )
      expect(Exit.isSuccess(result)).toBe(true)
      if (Exit.isSuccess(result)) {
        const manifest = result.value.get("doer")!
        expect(manifest.systemPrompt.agent).toBe("INSTRUCTIONS.md")
        expect(manifest.systemPrompt.soul).toBe("SOUL.md")
      }
    })

    it("uses empty strings when no sibling files exist", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      makeAgentYaml(Path.join(sharedDir, "doer"), "doer")
      Fs.mkdirSync(Path.join(sharedDir, "doer"), { recursive: true })

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, [])
      )
      expect(Exit.isSuccess(result)).toBe(true)
      if (Exit.isSuccess(result)) {
        const manifest = result.value.get("doer")!
        expect(manifest.systemPrompt.agent).toBe("")
        expect(manifest.systemPrompt.soul).toBe("")
      }
    })

    it("uses explicit systemPrompt for specified keys and defaults others from sibling files", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      Fs.mkdirSync(Path.join(sharedDir, "custom"), { recursive: true })
      const yaml = `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: custom\nspec:\n  settings:\n    model: default\n  systemPrompt:\n    agent: custom/INSTRUCTIONS.md\n    soul: custom/SOUL.md\n`
      Fs.writeFileSync(Path.join(sharedDir, "custom", "agent.yml"), yaml)
      makeSiblingFiles(Path.join(sharedDir, "custom"), {
        instructions: "Should be ignored",
        soul: "Should be ignored"
      })

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, [])
      )
      expect(Exit.isSuccess(result)).toBe(true)
      if (Exit.isSuccess(result)) {
        const manifest = result.value.get("custom")!
        expect(manifest.systemPrompt.agent).toBe("custom/INSTRUCTIONS.md")
        expect(manifest.systemPrompt.soul).toBe("custom/SOUL.md")
      }
    })

    it("uses explicit systemPrompt for some keys, defaults rest from sibling files", async () => {
      const sharedDir = Path.join(tmpDir, "shared-agents")
      Fs.mkdirSync(Path.join(sharedDir, "partial"), { recursive: true })
      const yaml = `apiVersion: dag.hamilton.io/v1alpha1\nkind: Agent\nmetadata:\n  name: partial\nspec:\n  settings:\n    model: default\n  systemPrompt:\n    agent: partial/custom-agent.md\n`
      Fs.writeFileSync(Path.join(sharedDir, "partial", "agent.yml"), yaml)
      makeSiblingFiles(Path.join(sharedDir, "partial"), {
        instructions: "Ignored - explicitly set",
        soul: "Found from file"
      })

      const result = await Effect.runPromiseExit(
        loadAgentManifests(sharedDir, [])
      )
      expect(Exit.isSuccess(result)).toBe(true)
      if (Exit.isSuccess(result)) {
        const manifest = result.value.get("partial")!
        expect(manifest.systemPrompt.agent).toBe("partial/custom-agent.md")
        expect(manifest.systemPrompt.soul).toBe("SOUL.md")
      }
    })
  })
})