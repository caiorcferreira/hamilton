import { Effect } from "effect"
import type { Prompt, AgentManifest } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import { Template, type TemplateOptions } from "./template.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  contextTemplate?: string

  prompt: Prompt // TODO: rename to taskPrompt

  env: WorkflowEnv
  agentConfig: Partial<AgentManifest>
}

export interface BuiltPrompt {
  systemTemplate: Template
  taskTemplate: Template
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

export function buildAgentPrompt(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): BuiltPrompt {
  const resolvedAgentFileStr = Effect.runSync(
    Template.make(params.agentFile, options)
      .setVar("inputs", params.env)
      .render()
  )

  const resolvedSoulStr = params.soulFile
    ? Effect.runSync(
        Template.make(params.soulFile, options)
          .setVar("inputs", params.env)
          .render()
      )
    : ""

  const persona = resolvedSoulStr
    ? `<persona>\n${resolvedSoulStr}\n</persona>`
    : ""

  const renderedContextStr = Effect.runSync(
    Template.make(params.contextTemplate || defaultContextTemplate, options)
      .setVar("inputs", params.env)
      .render()
  )

  const taskContent = params.prompt.skipTemplate
    ? (params.prompt.content ?? "").replace(/{{/g, "\\{{")
    : Effect.runSync(
        Template.make(params.prompt.content ?? "", options)
          .setVar("inputs", params.env)
          .render()
      )

  const systemTemplateInst = Template.make(systemTemplate, options)
    .setVar("instructions", resolvedAgentFileStr)
    .setVar("persona", persona)
    .setVar("context", renderedContextStr)

  const taskTemplateInst = Template.make(taskContent, options)

  return {
    systemTemplate: systemTemplateInst,
    taskTemplate: taskTemplateInst,
    guidelineFiles
  }
}