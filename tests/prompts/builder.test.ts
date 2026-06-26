import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  buildAgentPrompt,
  PromptParams
} from "../../src/prompts/builder.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

const renderSystem = (result: ReturnType<typeof buildAgentPrompt>) =>
  Effect.runSync(result.systemTemplate.render()).trim()

const renderTask = (result: ReturnType<typeof buildAgentPrompt>) =>
  Effect.runSync(result.taskTemplate.render()).trim()

describe("buildAgentPrompt", () => {
  const baseParams: PromptParams = {
    agentFile: "You are a coder.",
    soulFile: "",
    prompt: { content: "Fix the bug" },
    env: { tasks: {} },
    agentConfig: {}
  }

  it("returns systemTemplate and taskTemplate", () => {
    const params: PromptParams = {
      agentFile: "You are a coder.",
      soulFile: "Concise and direct",
      prompt: { content: "Fix the bug" },
      env: { tasks: {} },
      agentConfig: { metadata: { name: "coder" }, dirPath: "", spec: { settings: {} } }
    }
    const result = buildAgentPrompt(params)
    expect(result).toHaveProperty("systemTemplate")
    expect(result).toHaveProperty("taskTemplate")
    expect(renderSystem(result)).toContain("<platform>")
    expect(renderSystem(result)).toContain("<persona>")
    expect(renderSystem(result)).toContain("Concise and direct")
    expect(renderSystem(result)).toContain("You are a coder.")
    expect(renderTask(result)).toContain("Fix the bug")
  })

  it("resolves template expressions in the task prompt via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Fix bug in {{inputs.tasks.setup.outputs.repo}}" },
      env
    }
    const result = buildAgentPrompt(params)
    expect(renderTask(result)).toContain("Fix bug in hamilton")
  })

  it("resolves non-string template values as JSON", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "US-001", title: "Add thing" }] }
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Stories: {{inputs.stories_json}}" },
      env
    }
    const result = buildAgentPrompt(params)
    expect(renderTask(result)).toContain('Stories: [{"id":"US-001","title":"Add thing"}]')
  })

  it("includes context from env in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, branch: "main", status: "approved" }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = buildAgentPrompt(params)
    expect(renderSystem(result)).toContain("<context>")
    expect(renderSystem(result)).toContain('"branch":"main"')
    expect(renderSystem(result)).toContain('"status":"approved"')
  })

  it("includes structured data from env as JSON in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "1", title: "Story" }] }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = buildAgentPrompt(params)
    expect(renderSystem(result)).toContain('"stories_json"')
    expect(renderSystem(result)).toContain('"Story"')
  })

  it("omits persona section when soulFile is empty", () => {
    const result = buildAgentPrompt(baseParams)
    expect(renderSystem(result)).not.toContain("<persona>")
    expect(renderTask(result)).toContain("Fix the bug")
  })

  it("includes Hamilton platform section", () => {
    const result = buildAgentPrompt(baseParams)
    expect(renderSystem(result)).toContain("Hamilton Agentic Orchestration")
    expect(renderSystem(result)).toContain("write_task_output")
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
    expect(renderSystem(result)).toContain("/tmp/repo")
    expect(renderSystem(result)).toContain("## Inputs")
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
    expect(renderSystem(result)).toContain("Working in /tmp/repo")
    expect(renderSystem(result)).not.toContain("## Inputs")
  })

  it("passes TemplateOptions through to resolution", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Hello {{inputs.name}}" },
      env: { tasks: {}, name: "world" }
    }
    const result = buildAgentPrompt(params, [], { strict: false })
    expect(renderTask(result)).toBe("Hello world")
  })

  it("defaults TemplateOptions to lenient when not provided", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Hello {{inputs.missing}}" },
      env: { tasks: {} }
    }
    const result = buildAgentPrompt(params)
    expect(renderTask(result)).toBe("Hello")
  })

  it("skips template resolution when prompt has skipTemplate flag", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Keep {{this}} as-is", skipTemplate: true },
      env: { tasks: {} }
    }
    const result = buildAgentPrompt(params)
    expect(renderTask(result)).toBe("Keep {{this}} as-is")
  })

  it("resolves template expressions in agentFile via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      agentFile: "You are a coder for {{inputs.tasks.setup.outputs.repo}}.",
      soulFile: "",
      prompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(renderSystem(result)).toContain("You are a coder for hamilton.")
  })

  it("resolves template expressions in soulFile via env", () => {
    const env: WorkflowEnv = { cwd: "/tmp/repo" }
    const params: PromptParams = {
      agentFile: "You are a coder.",
      soulFile: "Working from {{inputs.cwd}}",
      prompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = buildAgentPrompt(params)
    expect(renderSystem(result)).toContain("<persona>")
    expect(renderSystem(result)).toContain("Working from /tmp/repo")
  })
})
