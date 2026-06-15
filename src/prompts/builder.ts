import type { Prompt, AgentManifest } from "../types.js"
import type { Context } from "../workflow/context.js"
import type { WorkflowEnv } from "../workflow/env.js"
import { resolveTemplate } from "./template.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  prompt: Prompt
  context?: Context
  agentConfig: Partial<AgentManifest>
  env?: WorkflowEnv
  contextTemplate?: string
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
  guidelineFiles: Array<{ name: string; content: string }> = []
): BuiltPrompt {
  const persona = params.soulFile
    ? `<persona>\n${params.soulFile}\n</persona>`
    : ""

  let renderedContext: string

  if (params.env) {
    const template = params.contextTemplate || defaultContextTemplate
    renderedContext = resolveTemplate(template, { inputs: params.env })
  } else {
    renderedContext = Object.keys(params.context ?? {}).length > 0
      ? `<context>\n${JSON.stringify(params.context, null, 2)}\n</context>`
      : ""
  }

  const resolvedSystem = resolveTemplate(systemTemplate, {
    ...(params.context ?? {}),
    instructions: params.agentFile,
    persona,
    context: renderedContext,
  })

  const resolveData: Record<string, unknown> = params.env
    ? { inputs: params.env }
    : (params.context ?? {})

  const resolvedInput = resolveTemplate(params.prompt.content ?? "", resolveData)

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}