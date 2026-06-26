import type { Prompt, AgentManifest } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import type { SystemPromptFragments } from "./persona.js"
import { Template, type TemplateOptions } from "./template.js"
import { Effect } from "effect"

export interface PromptParams {
  fragments: SystemPromptFragments
  taskPrompt: Prompt
  outputSchema?: Record<string, unknown>
  userInput?: string
  isEntrypoint?: boolean

  env: WorkflowEnv
  agentConfig: Partial<AgentManifest>
}

export interface AgentPrompts {
  systemTemplate: Template
  taskTemplate: Template
  guidelineFiles: Array<{ name: string; content: string }>
}

const systemTemplateStr = `
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

{{#if persona}}
<persona>
{{persona}}
</persona>
{{/if}}

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
  const resolvedAgentFile = Template.make(params.fragments.agent.content ?? "", options)
    .setVar("inputs", params.env)

  const soulTemplate = params.fragments.soul.content
    ? Template.make(params.fragments.soul.content, options).setVar("inputs", params.env)
    : null

  const contextContent = params.fragments.context.content || defaultContextTemplate
  const contextTemplate = Template.make(contextContent, options).setVar("inputs", params.env)

  const resolvedSoul = soulTemplate ? Effect.runSync(soulTemplate.render()) : ""

  const persona = resolvedSoul

  const renderedAgentFile = Effect.runSync(resolvedAgentFile.render())
  const renderedContext = Effect.runSync(contextTemplate.render())

  const systemTemplate = Template.make(systemTemplateStr, options)
    .setVar("instructions", renderedAgentFile)
    .setVar("persona", persona)
    .setVar("context", renderedContext)

  let taskTemplateContent = params.taskPrompt.skipTemplate
    ? (params.taskPrompt.content ?? "")
    : params.taskPrompt.content ?? ""

  if (params.outputSchema) {
    const schemaJson = JSON.stringify(params.outputSchema, null, 2)
    taskTemplateContent = `<task>\n${taskTemplateContent}\n</task>\n\n<task_output_schema>\n${schemaJson}\n</task_output_schema>`
  }
  if (params.isEntrypoint && params.userInput) {
    taskTemplateContent = `${taskTemplateContent}\n\n<user_prompt>\n\n${params.userInput}\n</user_prompt>`
  }

  let taskTemplate: Template
  if (params.taskPrompt.skipTemplate && !params.outputSchema && !(params.isEntrypoint && params.userInput)) {
    taskTemplate = Template.make(params.taskPrompt.content ?? "", options)
  } else if (params.taskPrompt.skipTemplate) {
    taskTemplate = Template.make(taskTemplateContent, options)
  } else {
    taskTemplate = Template.make(taskTemplateContent, options).setVar("inputs", params.env)
  }

  return {
    systemTemplate,
    taskTemplate,
    guidelineFiles
  }
}
