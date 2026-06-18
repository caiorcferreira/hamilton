import type { Prompt, AgentManifest } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import { resolveTemplate, type TemplateOptions } from "./template.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  prompt: Prompt
  env: WorkflowEnv
  contextTemplate?: string
  agentConfig: Partial<AgentManifest>
}

export interface BuiltPrompt {
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

const defaultContextTemplate = `## Inputs
{{inputs}}`

export function buildAgentPrompt(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): BuiltPrompt {
  const persona = params.soulFile
    ? `<persona>\n${params.soulFile}\n</persona>`
    : ""

  const template = params.contextTemplate || defaultContextTemplate
  const contextForTemplate = params.contextTemplate
    ? { inputs: params.env }
    : { inputs: JSON.stringify(params.env) }
  const renderedContext = resolveTemplate(template, contextForTemplate, options)

  const resolvedSystem = resolveTemplate(systemTemplate, {
    instructions: params.agentFile,
    persona,
    context: renderedContext,
  }, options)

  const resolvedInput = params.prompt.skipTemplate
    ? (params.prompt.content ?? "")
    : resolveTemplate(params.prompt.content ?? "", { inputs: params.env }, options)

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}