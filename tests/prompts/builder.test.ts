import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  buildAgentsPrompts,
  PromptParams
} from "../../src/prompts/builder.js"
import { Template } from "../../src/prompts/template.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

describe("buildAgentsPrompts", () => {
  const render = (t: Template): string => Effect.runSync(t.render()).trim()
  const build = (...args: Parameters<typeof buildAgentsPrompts>) => Effect.runSync(buildAgentsPrompts(...args))
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
    const result = build(params)
    expect(result).toHaveProperty("systemTemplate")
    expect(result).toHaveProperty("taskTemplate")
    expect(render(result.systemTemplate)).toContain("<platform>")
    expect(render(result.systemTemplate)).toContain("<persona>")
    expect(render(result.systemTemplate)).toContain("Concise and direct")
    expect(render(result.systemTemplate)).toContain("You are a coder.")
    expect(render(result.taskTemplate)).toContain("Fix the bug")
  })

  it("resolves template expressions in the task prompt via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Fix bug in {{inputs.tasks.setup.outputs.repo}}" },
      env
    }
    const result = build(params)
    expect(render(result.taskTemplate)).toContain("Fix bug in hamilton")
  })

  it("resolves non-string template values as JSON", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "US-001", title: "Add thing" }] }
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Stories: {{inputs.stories_json}}" },
      env
    }
    const result = build(params)
    expect(render(result.taskTemplate)).toContain('Stories: [{"id":"US-001","title":"Add thing"}]')
  })

  it("includes context from env in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, parameters: { project_dir: "/tmp/repo" } }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = build(params)
    expect(render(result.systemTemplate)).toContain("<context>")
    expect(render(result.systemTemplate)).toContain("Current directory:")
    expect(render(result.systemTemplate)).toContain("/tmp/repo")
  })

  it("includes structured data from env as JSON in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "1", title: "Story" }] }
    const params: PromptParams = {
      fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "Env: {{inputs}}" } },
      taskPrompt: { content: "do" },
      env,
      agentConfig: {}
    }
    const result = build(params)
    expect(render(result.systemTemplate)).toContain('"stories_json"')
    expect(render(result.systemTemplate)).toContain('"Story"')
  })

  it("omits persona section when soulFile is empty", () => {
    const result = build(baseParams)
    expect(render(result.systemTemplate)).not.toContain("<persona>")
    expect(render(result.taskTemplate)).toContain("Fix the bug")
  })

  it("includes Hamilton platform section", () => {
    const result = build(baseParams)
    expect(render(result.systemTemplate)).toContain("Hamilton Agentic Orchestration")
    expect(render(result.systemTemplate)).toContain("write_task_output")
  })

  it("passes memoryContext through to AgentPrompts", () => {
    const result = build(baseParams, "some memory context")
    expect(result.memoryContext).toBe("some memory context")
  })

  it("defaults memoryContext to empty string", () => {
    const result = build(baseParams)
    expect(result.memoryContext).toBe("")
  })

  it("uses default context template when env is provided without contextTemplate", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "" } },
      taskPrompt: { content: "do" },
      env: { tasks: {}, parameters: { project_dir: "/tmp/repo" } },
      agentConfig: {}
    }
    const result = build(params)
    expect(render(result.systemTemplate)).toContain("/tmp/repo")
    expect(render(result.systemTemplate)).toContain("## Context")
  })

  it("uses custom context template when provided", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "Working in {{inputs.project_dir}}" } },
      taskPrompt: { content: "do" },
      env: { tasks: {}, project_dir: "/tmp/repo" },
      agentConfig: {}
    }
    const result = build(params)
    expect(render(result.systemTemplate)).toContain("Working in /tmp/repo")
    expect(render(result.systemTemplate)).not.toContain("## Context")
  })

  it("passes TemplateOptions through to resolution", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Hello {{inputs.name}}" },
      env: { tasks: {}, name: "world" }
    }
    const result = build(params, "", { strict: false })
    expect(render(result.taskTemplate)).toBe("Hello world")
  })

  it("defaults TemplateOptions to lenient when not provided", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Hello {{inputs.missing}}" },
      env: { tasks: {} }
    }
    const result = build(params)
    expect(render(result.taskTemplate)).toBe("Hello")
  })

  it("skips template resolution when prompt has skipTemplate flag", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Keep {{this}} as-is", skipTemplate: true },
      env: { tasks: {} }
    }
    const result = build(params)
    expect(render(result.taskTemplate)).toBe("Keep {{this}} as-is")
  })

  it("resolves template expressions in agentFile via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder for {{inputs.tasks.setup.outputs.repo}}." }, soul: { content: "" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = build(params)
    expect(render(result.systemTemplate)).toContain("You are a coder for hamilton.")
  })

  it("resolves template expressions in soulFile via env", () => {
    const env: WorkflowEnv = { project_dir: "/tmp/repo" }
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder." }, soul: { content: "Working from {{inputs.project_dir}}" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = build(params)
    expect(render(result.systemTemplate)).toContain("<persona>")
    expect(render(result.systemTemplate)).toContain("Working from /tmp/repo")
  })
})
