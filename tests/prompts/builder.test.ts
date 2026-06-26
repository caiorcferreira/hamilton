import { describe, it, expect } from "vitest"
import {
  buildAgentsPrompts,
  PromptParams
} from "../../src/prompts/builder.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

describe("buildAgentsPrompts", () => {
  const baseFragments = { agent: { content: "" }, soul: { content: "" }, context: { content: "" } }
  const baseParams: PromptParams = {
    fragments: baseFragments,
    taskPrompt: { content: "Fix the bug" },
    env: { tasks: {} },
    agentConfig: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder." }, soul: { content: "Concise and direct" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env: { tasks: {} },
      agentConfig: { metadata: { name: "coder" }, dirPath: "", spec: { settings: {} } }
    }
    const result = buildAgentsPrompts(params)
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
      taskPrompt: { content: "Fix bug in {{inputs.tasks.setup.outputs.repo}}" },
      env
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("resolves non-string template values as JSON", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "US-001", title: "Add thing" }] }
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Stories: {{inputs.stories_json}}" },
      env
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toContain('Stories: [{"id":"US-001","title":"Add thing"}]')
  })

  it("includes context from env in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, branch: "main", status: "approved" }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = buildAgentsPrompts(params)
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
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain('"stories_json"')
    expect(result.systemPrompt).toContain('"Story"')
  })

  it("omits persona section when soulFile is empty", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.systemPrompt).not.toContain("<persona>")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("includes Hamilton platform section", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.systemPrompt).toContain("Hamilton Agentic Orchestration")
    expect(result.systemPrompt).toContain("write_task_output")
  })

  it("passes guidelineFiles through to AgentPrompts", () => {
    const instructions = [{ name: "typescript", content: "Use strict mode" }]
    const result = buildAgentsPrompts(baseParams, instructions)
    expect(result.guidelineFiles).toEqual(instructions)
  })

  it("defaults guidelineFiles to empty array", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.guidelineFiles).toEqual([])
  })

  it("uses default context template when env is provided without contextTemplate", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "" } },
      taskPrompt: { content: "do" },
      env: { tasks: {}, cwd: "/tmp/repo" },
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("/tmp/repo")
    expect(result.systemPrompt).toContain("## Context")
  })

  it("uses custom context template when provided", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "Working in {{inputs.cwd}}" } },
      taskPrompt: { content: "do" },
      env: { tasks: {}, cwd: "/tmp/repo" },
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("Working in /tmp/repo")
    expect(result.systemPrompt).not.toContain("## Context")
  })

  it("passes TemplateOptions through to resolution", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Hello {{inputs.name}}" },
      env: { tasks: {}, name: "world" }
    }
    const result = buildAgentsPrompts(params, [], { strict: false })
    expect(result.taskPrompt).toBe("Hello world")
  })

  it("defaults TemplateOptions to lenient when not provided", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Hello {{inputs.missing}}" },
      env: { tasks: {} }
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toBe("Hello")
  })

  it("skips template resolution when prompt has skipTemplate flag", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Keep {{this}} as-is", skipTemplate: true },
      env: { tasks: {} }
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toBe("Keep {{this}} as-is")
  })

  it("resolves template expressions in agentFile via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder for {{inputs.tasks.setup.outputs.repo}}." }, soul: { content: "" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("You are a coder for hamilton.")
  })

  it("resolves template expressions in soulFile via env", () => {
    const env: WorkflowEnv = { cwd: "/tmp/repo" }
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder." }, soul: { content: "Working from {{inputs.cwd}}" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("<persona>")
    expect(result.systemPrompt).toContain("Working from /tmp/repo")
  })
})
