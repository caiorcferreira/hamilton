import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"

export interface AgentSettings {
  model?: string
  thinking?: string
  tools?: string[]
  timeoutSeconds?: number
  skills?: string[]
  retryOnTransient?: boolean
  compactionEnabled?: boolean
  compactionThresholdTokens?: number
}

export class ConfigLoadError extends Data.TaggedError("ConfigLoadError")<{
  agentId: string
  message: string
}> {}

export function loadAgentSettings(
  agentDir: string
): Effect.Effect<AgentSettings, ConfigLoadError> {
  return Effect.gen(function* () {
    const settingsPath = Path.join(agentDir, "settings.yaml")

    const exists = yield* Effect.sync(() => Fs.existsSync(settingsPath))

    if (!exists) {
      return {} as AgentSettings
    }

    const content = yield* Effect.try({
      try: () => Fs.readFileSync(settingsPath, "utf-8"),
      catch: (e) =>
        new ConfigLoadError({
          agentId: Path.basename(agentDir),
          message: `Failed to read settings.yaml: ${String(e)}`
        })
    })

    const parsed = yield* Effect.try({
      try: (): AgentSettings => {
        const raw = Yaml.parse(content)
        if (!raw || typeof raw !== "object") return {}
        const result: AgentSettings = {}
        const r = raw as Record<string, unknown>
        if (typeof r.model === "string") result.model = r.model
        if (typeof r.thinking === "string") result.thinking = r.thinking
        if (typeof r.timeoutSeconds === "number") result.timeoutSeconds = r.timeoutSeconds
        if (Array.isArray(r.tools) && r.tools.every((t) => typeof t === "string")) result.tools = r.tools as string[]
        if (Array.isArray(r.skills) && r.skills.every((s) => typeof s === "string")) result.skills = r.skills as string[]
        if (typeof r.retryOnTransient === "boolean") result.retryOnTransient = r.retryOnTransient
        if (typeof r.compactionEnabled === "boolean") result.compactionEnabled = r.compactionEnabled
        if (typeof r.compactionThresholdTokens === "number") result.compactionThresholdTokens = r.compactionThresholdTokens
        return result
      },
      catch: (e) =>
        new ConfigLoadError({
          agentId: Path.basename(agentDir),
          message: `Invalid settings.yaml: ${String(e)}`
        })
    })

    return parsed
  })
}