import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../paths.js"
import type { TemplateOptions } from "./template.js"

export function loadTemplateConfig(): Effect.Effect<TemplateOptions, Error> {
  return Effect.try({
    try: () => {
      const path = settingsPath()
      if (!Fs.existsSync(path)) return { strict: false }

      const content = Fs.readFileSync(path, "utf-8")
      const doc = Yaml.parse(content) as Record<string, unknown> | null
      if (!doc || typeof doc !== "object") return { strict: false }

      const templating = doc["templating"]
      if (!templating || typeof templating !== "object") return { strict: false }

      const strict = (templating as Record<string, unknown>)["strict"]
      return { strict: strict === true }
    },
    catch: () => new Error("Failed to load template config")
  })
}