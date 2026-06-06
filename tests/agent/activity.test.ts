import { describe, it, expect } from "vitest"
import {
  buildAgentPrompt,
  extractContextFromOutput,
  PromptParams
} from "../../src/agent/activity.js"

describe("buildAgentPrompt", () => {
  const baseParams: PromptParams = {
    agentsMd: "You are a coder.",
    identityMd: "",
    soulMd: "",
    stepInput: "Fix the bug",
    context: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      agentsMd: "You are a coder.",
      identityMd: "Senior Developer",
      soulMd: "Concise and direct",
      stepInput: "Fix the bug",
      context: {}
    }
    const result = buildAgentPrompt(params)
    expect(result).toHaveProperty("systemPrompt")
    expect(result).toHaveProperty("taskPrompt")
    expect(result.systemPrompt).toContain("Your role: Senior Developer")
    expect(result.systemPrompt).toContain("Your style: Concise and direct")
    expect(result.systemPrompt).toContain("You are a coder.")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("resolves template expressions in the task prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      stepInput: "Fix bug in {{repo}}",
      context: { repo: "hamilton" }
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("includes context entries in the system prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      context: { branch: "main", status: "approved" }
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("Context from previous steps:")
    expect(result.systemPrompt).toContain("branch: main")
    expect(result.systemPrompt).toContain("status: approved")
  })

  it("omits role and style sections when empty", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).not.toContain("Your role:")
    expect(result.systemPrompt).not.toContain("Your style:")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("includes Hamilton Workflow System section as first section", () => {
    const params: PromptParams = {
      agentsMd: "You are a coder.",
      identityMd: "Senior Developer",
      soulMd: "Concise and direct",
      stepInput: "Fix the bug",
      context: {}
    }
    const result = buildAgentPrompt(params)
    const sections = result.systemPrompt.split("\n\n")
    expect(sections[0]).toContain("Hamilton Workflow System")
  })
})

describe("extractContextFromOutput", () => {
  it("extracts only string-valued entries", () => {
    const output = { status: "done", repo: "hamilton", count: 42, items: [1, 2] }
    const result = extractContextFromOutput(output)
    expect(result).toEqual({ status: "done", repo: "hamilton" })
  })

  it("returns empty object for no string values", () => {
    const output = { count: 1, flag: true }
    const result = extractContextFromOutput(output)
    expect(result).toEqual({})
  })
})
