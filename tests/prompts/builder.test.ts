import { describe, it, expect } from "vitest"
import {
  buildAgentPrompt,
  PromptParams
} from "../../src/prompts/builder.js"

describe("buildAgentPrompt", () => {
  const baseParams: PromptParams = {
    agentFile: "You are a coder.",
    soulFile: "",
    prompt: { content: "Fix the bug" },
    context: {},
    agentConfig: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      agentFile: "You are a coder.",
      soulFile: "Concise and direct",
      prompt: { content: "Fix the bug" },
      context: {},
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

  it("resolves template expressions in the task prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Fix bug in {{repo}}" },
      context: { repo: "hamilton" }
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("resolves non-string template values as JSON", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Stories: {{stories_json}}" },
      context: { stories_json: [{ id: "US-001", title: "Add thing" }] }
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain('Stories: [{"id":"US-001","title":"Add thing"}]')
  })

  it("includes context as JSON in the system prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      context: { branch: "main", status: "approved" }
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("<context>")
    expect(result.systemPrompt).toContain('"branch": "main"')
    expect(result.systemPrompt).toContain('"status": "approved"')
  })

  it("includes structured context as JSON in the system prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      context: { stories_json: [{ id: "1", title: "Story" }] }
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
    expect(result.systemPrompt).toContain("write_step_output")
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
})