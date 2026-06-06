import { Data, Effect } from "effect"
import { resolveTemplate } from "../workflow/context.js"

export interface PromptParams {
  agentsMd: string
  identityMd: string
  soulMd: string
  stepInput: string
  context: Record<string, string>
}

export class AgentOutputParseError extends Data.TaggedError("AgentOutputParseError")<{
  message: string
}> {}

export function buildAgentPrompt(params: PromptParams): string {
  const parts: string[] = []

  if (params.identityMd) {
    parts.push(`Your role: ${params.identityMd}`)
  }

  if (params.soulMd) {
    parts.push(`Your style: ${params.soulMd}`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextLines = Object.entries(params.context)
      .map(([key, value]) => `  ${key}: ${value}`)
      .join("\n")
    parts.push(`Context from previous steps:\n${contextLines}`)
  }

  parts.push(params.agentsMd)

  const resolvedInput = resolveTemplate(params.stepInput, params.context)
  parts.push(`Task: ${resolvedInput}`)
  parts.push("When complete, respond with a JSON object containing your results.")

  return parts.join("\n\n")
}

export function parseAgentOutput(
  output: string
): Effect.Effect<Record<string, unknown>, AgentOutputParseError> {
  return Effect.try({
    try: () => {
      const trimmed = output.trim()
      if (!trimmed) throw new Error("Empty output")

      const fenceMatch = trimmed.match(/```json\s*\n([\s\S]*?)\n```/)
      if (fenceMatch) {
        return JSON.parse(fenceMatch[1])
      }

      return JSON.parse(trimmed)
    },
    catch: (e) => new AgentOutputParseError({
      message: `Failed to parse agent output: ${e instanceof Error ? e.message : String(e)}`
    })
  })
}

export function extractContextFromOutput(
  output: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(output)) {
    if (typeof value === "string") {
      result[key] = value
    }
  }
  return result
}