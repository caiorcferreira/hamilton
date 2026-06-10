import { Data } from "effect"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { AgentSettings } from "../types.js"
import { settingsPath, hamiltonHome } from "../paths.js"

export interface ResolvedDefaults {
  model: string
  systemPrompt: AgentSettings["systemPrompt"]
  skills: string[] | null
}

export interface ModelAliasRegistry {
  [alias: string]: string
}

export class CircularModelAliasError extends Data.TaggedError("CircularModelAliasError")<{
  readonly alias: string
}> {}

export function resolveAgentDefaults(settings: AgentSettings): ResolvedDefaults {
  return {
    model: settings.model ?? "default",
    systemPrompt: settings.systemPrompt,
    skills: settings.skills ?? null
  }
}

function readPiDefaultModel(): string {
  try {
    const settingsFile = Path.join(hamiltonHome(), "executors", "pi", "agent", "settings.json")
    const raw = Fs.readFileSync(settingsFile, "utf-8")
    const settings = JSON.parse(raw)
    return settings.defaultModel ?? "glm-5.1"
  } catch {
    return "glm-5.1"
  }
}

export function loadModelAliases(defaultModel?: string): ModelAliasRegistry {
  const actualDefault = defaultModel ?? readPiDefaultModel()
  const registry: ModelAliasRegistry = {}
  const path = settingsPath()
  if (Fs.existsSync(path)) {
    try {
      const raw = Fs.readFileSync(path, "utf-8")
      const doc = Yaml.parse(raw)
      const aliases: Record<string, string> | undefined = doc?.models?.aliases
      if (aliases && typeof aliases === "object") {
        for (const [key, value] of Object.entries(aliases)) {
          if (typeof value === "string") registry[key] = value
        }
      }
    } catch {
      // invalid YAML — skip
    }
  }
  registry.default = actualDefault
  return registry
}

export function resolveModelAlias(model: string, aliases: ModelAliasRegistry): string {
  const resolved = aliases[model]
  if (resolved === undefined) return model
  if (resolved === model) throw new CircularModelAliasError({ alias: model })
  return resolved
}