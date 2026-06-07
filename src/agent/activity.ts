
import { Effect } from "effect"
import { resolveTemplate, type Context } from "../workflow/context.js"

export interface PromptParams {
  agentsMd: string
  identityMd: string
  soulMd: string
  stepInput: string
  context: Context
}

export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
}

export function buildAgentPrompt(params: PromptParams): BuiltPrompt {
  const systemParts: string[] = []

  if (params.identityMd) {
    systemParts.push(`<identity>\n${params.identityMd}\n</identity>`)
  }

  if (params.soulMd) {
    systemParts.push(`<style>\n${params.soulMd}\n</style>`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextJson = JSON.stringify(params.context, null, 2)
    systemParts.push(`<context>\n${contextJson}\n</context>`)
  }

  systemParts.push(`<harness>
# Hamilton Workflow

You are executing a step within a Hamilton workflow. A workflow is a sequence of steps
that pass context between them. Your job is to complete one step and save your result.

### How to finish your step

When you have completed your work, call the write_step_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent steps.

IMPORTANT:
- You MUST call write_step_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</harness>`)

  systemParts.push(`<agent>${params.agentsMd}</agent>`)

  const resolvedInput = resolveTemplate(params.stepInput, params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: resolvedInput
  }
}