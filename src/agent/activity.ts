import { Data, Effect } from "effect"
import { resolveTemplate } from "../workflow/context.js"

export interface PromptParams {
  agentsMd: string
  identityMd: string
  soulMd: string
  stepInput: string
  context: Record<string, string>
}

export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
}

export class AgentOutputParseError extends Data.TaggedError("AgentOutputParseError")<{
  message: string
}> {}

export function buildAgentPrompt(params: PromptParams): BuiltPrompt {
  const systemParts: string[] = []

  if (params.identityMd) {
    systemParts.push(`Your role: ${params.identityMd}`)
  }

  if (params.soulMd) {
    systemParts.push(`Your style: ${params.soulMd}`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextLines = Object.entries(params.context)
      .map(([key, value]) => `  ${key}: ${value}`)
      .join("\n")
    systemParts.push(`Context from previous steps:\n${contextLines}`)
  }

  systemParts.push(params.agentsMd)

  const resolvedInput = resolveTemplate(params.stepInput, params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: `${resolvedInput}\n\nWhen complete, respond with a JSON object containing your results.`
  }
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