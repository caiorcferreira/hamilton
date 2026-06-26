import type { Prompt, AgentManifest } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import type { SystemPromptFragments } from "./persona.js"
import { resolveTemplate, type TemplateOptions } from "./template.js"

export interface PromptParams {
  fragments: SystemPromptFragments
  taskPrompt: Prompt

  env: WorkflowEnv
  agentConfig: Partial<AgentManifest>
}

export interface AgentPrompts {
  systemPrompt: string
  taskPrompt: string
  guidelineFiles: Array<{ name: string; content: string }>
}

const systemTemplate = `
<platform>
# Hamilton Agentic Orchestration

Hamilton is an agentic orchestration platform where tasks are executed by agents, orchestrated as a DAG.

Your goal is to fullfil the task provided as input by Hamilton user.

## How to finish your task

When you finish your work, call the write_task_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_task_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</platform>

<instructions>
{{instructions}}
</instructions>

{{persona}}

<context>
{{context}}
</context>
`


const defaultContextTemplate = `## Context
- Current directory: {{inputs.parameters.cwd}}
- Available tools:
  - All built-in tools: read, bash, edit, write, grep, find, ls
  - write_task_output: saves your task results (call once when done, input must be a JSON object with 'status' field)
`

export function buildAgentsPrompts(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): AgentPrompts {
  const resolvedAgentFile = resolveTemplate(params.fragments.agent.content ?? "", { inputs: params.env }, options)

  const resolvedSoul = params.fragments.soul.content
    ? resolveTemplate(params.fragments.soul.content, { inputs: params.env }, options)
    : ""

  const persona = resolvedSoul
    ? `<persona>\n${resolvedSoul}\n</persona>`
    : ""

  const template = params.fragments.context.content || defaultContextTemplate
  const contextForTemplate = { inputs: params.env }
  const renderedContext = resolveTemplate(template, contextForTemplate, options)

  const resolvedSystem = resolveTemplate(systemTemplate, {
    instructions: resolvedAgentFile,
    persona,
    context: renderedContext,
  }, options)

  const resolvedInput = params.taskPrompt.skipTemplate
    ? (params.taskPrompt.content ?? "")
    : resolveTemplate(params.taskPrompt.content ?? "", { inputs: params.env }, options)

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}
