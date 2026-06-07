import type { Prompt, WorkflowAgent } from "../types.js"
import type { Context } from "../workflow/context.js"
import { resolveTemplate } from "../workflow/context.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  identityFile: string
  prompt: Prompt
  context: Context
  agentConfig: Partial<WorkflowAgent>
}

export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
}

export function buildAgentPrompt(params: PromptParams): BuiltPrompt {
  const systemParts: string[] = []

  if (params.identityFile) {
    systemParts.push(`<identity>\n${params.identityFile}\n</identity>`)
  }

  if (params.soulFile) {
    systemParts.push(`<style>\n${params.soulFile}\n</style>`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextJson = JSON.stringify(params.context, null, 2)
    systemParts.push(`<context>\n${contextJson}\n</context>`)
  }

  systemParts.push(`<harness>
# Hamilton Workflow

You are executing a task within a Hamilton workflow. A workflow is a sequence of tasks
that pass context between them. Your job is to complete one task and save your result.

### How to finish your task

When you have completed your work, call the write_step_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_step_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</harness>`)

  systemParts.push(`<agent>${params.agentFile}</agent>`)

  const resolvedInput = resolveTemplate(params.prompt.content, params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: resolvedInput
  }
}