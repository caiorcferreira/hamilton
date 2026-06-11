import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../paths.js"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  message: string
}> {}

export interface TelemetryConfig {
  disableStores: Set<"file" | "db">
}

function defaultConfig(): TelemetryConfig {
  return { disableStores: new Set() }
}

export const loadTelemetryConfig: Effect.Effect<TelemetryConfig, ConfigError> = Effect.try({
  try: () => {
    const path = settingsPath()
    if (!Fs.existsSync(path)) return defaultConfig()

    const content = Fs.readFileSync(path, "utf-8")
    const doc = Yaml.parse(content) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return defaultConfig()

    const telemetry = doc["telemetry"]
    if (!telemetry || typeof telemetry !== "object") return defaultConfig()

    const stores = (telemetry as Record<string, unknown>)["disableStores"]
    if (!Array.isArray(stores)) return defaultConfig()

    const set = new Set<"file" | "db">()
    for (const s of stores) {
      if (s === "file" || s === "db") set.add(s)
    }
    return { disableStores: set }
  },
  catch: (e) => new ConfigError({ message: "Failed to load telemetry config: " + String(e) })
})

export const saveTelemetryConfig: (config: TelemetryConfig) => Effect.Effect<void, ConfigError> = (config) =>
  Effect.try({
    try: () => {
      const path = settingsPath()
      const content = Fs.existsSync(path) ? Fs.readFileSync(path, "utf-8") : ""
      let doc = (Yaml.parse(content) as Record<string, unknown> | null) ?? {}

      if (typeof doc !== "object" || Array.isArray(doc)) doc = {}

      const stores = Array.from(config.disableStores)
      ;(doc as Record<string, unknown>)["telemetry"] = { disableStores: stores }

      Fs.writeFileSync(path, Yaml.stringify(doc), "utf-8")
    },
    catch: (e) => new ConfigError({ message: "Failed to save telemetry config: " + String(e) })
  })
