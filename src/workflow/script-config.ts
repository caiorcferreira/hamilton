import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../paths.js"

export class ScriptConfigError extends Data.TaggedError("ScriptConfigError")<{
  message: string
}> {}

export interface ScriptConfig {
  maxOutputBytes: number
}

function defaultConfig(): ScriptConfig {
  return { maxOutputBytes: 65536 }
}

export const loadScriptConfig: Effect.Effect<ScriptConfig, ScriptConfigError> = Effect.try({
  try: () => {
    const path = settingsPath()
    if (!Fs.existsSync(path)) return defaultConfig()

    const content = Fs.readFileSync(path, "utf-8")
    const doc = Yaml.parse(content) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return defaultConfig()

    const script = doc["script"]
    if (!script || typeof script !== "object") return defaultConfig()

    const maxOutputBytes = (script as Record<string, unknown>)["maxOutputBytes"]
    if (typeof maxOutputBytes !== "number" || maxOutputBytes <= 0) return defaultConfig()

    return { maxOutputBytes }
  },
  catch: (e) => new ScriptConfigError({ message: "Failed to load script config: " + String(e) })
})
