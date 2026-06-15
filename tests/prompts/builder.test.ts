import { describe, it, expect } from "vitest"
import {
  buildAgentPrompt,
  PromptParams
} from "../../src/prompts/builder.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

describe("buildAgentPrompt", () => {
  const baseParams: PromptParams = {
    agentFile: "You are a coder.",
    soulFile: "",
    prompt: { content: "Fix the bug" },
    env: { tasks: {} },
    agentConfig: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      agentFile: "You are a coder.",
      soulFile: "Concise and direct",
      prompt: { content: "Fix the bug" },
      env: { tasks: {} },
      agentConfig: { metadata: { name: "coder" }, dirPath: "", spec: { settings: {} } }
    }
    const result = buildAgentPrompt(params)
    expect(result).toHaveProperty("systemPrompt")
    expect(result).toHaveProperty("taskPrompt")
    expect(result.systemPrompt).toContain("<platform>")
    expect(result.systemPrompt).toContain("<persona>")
    expect(result.systemPrompt).toContain("Concise and direct")
    expect(result.systemPrompt).toContain("You are a coder.")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("resolves template expressions in the task prompt via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Fix bug in {{inputs.tasks.setup.outputs.repo}}" },
      env
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("resolves non-string template values as JSON", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "US-001", title: "Add thing" }] }
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Stories: {{inputs.stories_json}}" },
      env
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain('Stories: [{"id":"US-001","title":"Add thing"}]')
  })

  it("includes context from env in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, branch: "main", status: "approved" }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("<context>")
    expect(result.systemPrompt).toContain('"branch":"main"')
    expect(result.systemPrompt).toContain('"status":"approved"')
  })

  it("includes structured data from env as JSON in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "1", title: "Story" }] }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain('"stories_json"')
    expect(result.systemPrompt).toContain('"Story"')
  })

  it("omits persona section when soulFile is empty", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).not.toContain("<persona>")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("includes Hamilton platform section", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).toContain("Hamilton Agentic Orchestration")
    expect(result.systemPrompt).toContain("write_task_output")
  })

  it("passes guidelineFiles through to BuiltPrompt", () => {
    const instructions = [{ name: "typescript", content: "Use strict mode" }]
    const result = buildAgentPrompt(baseParams, instructions)
    expect(result.guidelineFiles).toEqual(instructions)
  })

  it("defaults guidelineFiles to empty array", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.guidelineFiles).toEqual([])
  })

  it("uses default context template when env is provided without contextTemplate", () => {
    const params: PromptParams = {
      agentFile: "agent",
      soulFile: "",
      prompt: { content: "do" },
      env: { tasks: {}, cwd: "/tmp/repo" },
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("/tmp/repo")
    expect(result.systemPrompt).toContain("## Inputs")
  })

  it("uses custom context template when provided", () => {
    const params: PromptParams = {
      agentFile: "agent",
      soulFile: "",
      prompt: { content: "do" },
      env: { tasks: {}, cwd: "/tmp/repo" },
      contextTemplate: "Working in {{inputs.cwd}}",
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("Working in /tmp/repo")
    expect(result.systemPrompt).not.toContain("## Inputs")
  })
})