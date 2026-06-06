import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import {
  buildAgentPrompt,
  parseAgentOutput,
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

  it("includes persona files and step input", () => {
    const params: PromptParams = {
      agentsMd: "You are a coder.",
      identityMd: "Senior Developer",
      soulMd: "Concise and direct",
      stepInput: "Fix the bug",
      context: {}
    }
    const result = buildAgentPrompt(params)
    expect(result).toContain("Your role: Senior Developer")
    expect(result).toContain("Your style: Concise and direct")
    expect(result).toContain("You are a coder.")
    expect(result).toContain("Task: Fix the bug")
    expect(result).toContain("When complete, respond with a JSON object containing your results.")
  })

  it("resolves template expressions in step input", () => {
    const params: PromptParams = {
      ...baseParams,
      stepInput: "Fix bug in {{repo}}",
      context: { repo: "hamilton" }
    }
    const result = buildAgentPrompt(params)
    expect(result).toContain("Task: Fix bug in hamilton")
  })

  it("includes context entries from previous steps", () => {
    const params: PromptParams = {
      ...baseParams,
      context: { branch: "main", status: "approved" }
    }
    const result = buildAgentPrompt(params)
    expect(result).toContain("Context from previous steps:")
    expect(result).toContain("branch: main")
    expect(result).toContain("status: approved")
  })

  it("omits role and style sections when empty", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result).not.toContain("Your role:")
    expect(result).not.toContain("Your style:")
  })
})

describe("parseAgentOutput", () => {
  it("parses JSON from code fences", async () => {
    const output = 'Some text\n```json\n{"status": "done"}\n```\nMore text'
    const exit = await Effect.runPromiseExit(parseAgentOutput(output))
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ status: "done" })
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("parses raw JSON", async () => {
    const output = '{"status": "done", "count": 5}'
    const exit = await Effect.runPromiseExit(parseAgentOutput(output))
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ status: "done", count: 5 })
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("fails on invalid JSON", async () => {
    const output = "not json at all"
    const exit = await Effect.runPromiseExit(parseAgentOutput(output))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails on empty string", async () => {
    const exit = await Effect.runPromiseExit(parseAgentOutput(""))
    expect(Exit.isFailure(exit)).toBe(true)
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