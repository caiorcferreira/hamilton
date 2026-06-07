import type { AgentSettings } from "../types.js"

export interface ResolvedDefaults {
  model: string
  systemPrompt: AgentSettings["systemPrompt"]
  skills: string[] | null
}

export function resolveAgentDefaults(settings: AgentSettings): ResolvedDefaults {
  return {
    model: settings.model ?? "default",
    systemPrompt: settings.systemPrompt,
    skills: settings.skills ?? null
  }
}