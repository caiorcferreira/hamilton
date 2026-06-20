import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../paths.js"
import type { TemplateOptions } from "./template.js"

export class TemplateConfigError extends Data.TaggedError("TemplateConfigError")<{
  message: string
}> { }

export function loadTemplateConfig(): Effect.Effect<TemplateOptions, TemplateConfigError> {
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
    catch: (e) => new TemplateConfigError({ message: String(e) })
  })
}

export interface RecursionConfig {
  maxDepth: number | null
}

export function loadRecursionConfig(): Effect.Effect<RecursionConfig, TemplateConfigError> {
  return Effect.try({
    try: () => {
      const path = settingsPath()
      if (!Fs.existsSync(path)) return { maxDepth: null }

      const content = Fs.readFileSync(path, "utf-8")
      const doc = Yaml.parse(content) as Record<string, unknown> | null
      if (!doc || typeof doc !== "object") return { maxDepth: null }

      const recursion = doc["recursion"]
      if (!recursion || typeof recursion !== "object") return { maxDepth: null }

      const raw = (recursion as Record<string, unknown>)["max_depth"]
      if (raw === undefined || raw === null) return { maxDepth: null }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) return { maxDepth: null }
      return { maxDepth: n }
    },
    catch: (e) => new TemplateConfigError({ message: String(e) })
  })
}