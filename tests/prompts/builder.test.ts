import { describe, it, expect } from "vitest"
import {
  buildAgentPrompt,
  PromptParams
} from "../../src/prompts/builder.js"

describe("buildAgentPrompt", () => {
  const baseParams: PromptParams = {
    agentFile: "You are a coder.",
    soulFile: "",
    identityFile: "",
    prompt: { content: "Fix the bug" },
    context: {},
    agentConfig: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      agentFile: "You are a coder.",
      identityFile: "Senior Developer",
      soulFile: "Concise and direct",
      prompt: { content: "Fix the bug" },
      context: {},
      agentConfig: { name: "coder", role: "coding" }
    }
    const result = buildAgentPrompt(params)
    expect(result).toHaveProperty("systemPrompt")
    expect(result).toHaveProperty("taskPrompt")
    expect(result.systemPrompt).toContain("<identity>\nSenior Developer\n</identity>")
    expect(result.systemPrompt).toContain("<style>\nConcise and direct\n</style>")
    expect(result.systemPrompt).toContain("<agent>You are a coder.</agent>")
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

  it("omits identity and style sections when empty", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).not.toContain("<identity>")
    expect(result.systemPrompt).not.toContain("<style>")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("uses task terminology in harness", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).toContain("task within a Hamilton workflow")
    expect(result.systemPrompt).toContain("finish your task")
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