import { Data, Effect } from "effect"
import Handlebars from "handlebars"
import * as Fs from "node:fs"
import { WorkflowEnv } from "src/workflow/env.js"

export interface TemplateOptions {
  strict: boolean
}

export class MissingVariableError extends Data.TaggedError("MissingVariableError")<{
  variable: string
  template: string
}> { }

export class TemplateSyntaxError extends Data.TaggedError("TemplateSyntaxError")<{
  message: string
}> { }

export class TemplateFileError extends Data.TaggedError("TemplateFileError")<{
  filePath: string
  message: string
}> { }

export type TemplateError = MissingVariableError | TemplateSyntaxError | TemplateFileError

export function resolveDottedPath(context: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = context
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined
    }
    if (!Object.hasOwn(current as Record<string, unknown>, part)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function createHandlebars(): typeof Handlebars {
  const hbs = Handlebars.create()
  hbs.Utils.escapeExpression = function (value: unknown): string {
    if (value === null || value === undefined) return ""
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number") return String(value)
    if (typeof value === "object") return JSON.stringify(value)
    return String(value)
  }
  return hbs
}

function resolveTemplate(
  template: string,
  context: Record<string, unknown>,
  options: TemplateOptions = { strict: false }
): string {
  if (!template.includes("{{")) return template

  try {
    const hbs = createHandlebars()
    const compiled = hbs.compile(template)

    if (options.strict) {
      const referenced = scanTemplatePaths(template)
      for (const path of referenced) {
        const value = resolveDottedPath(context, path)
        if (value === undefined) {
          throw new MissingVariableError({ variable: path, template: template.slice(0, 100) })
        }
      }
    }

    return compiled(context)
  } catch (e) {
    if (e instanceof MissingVariableError) throw e
    throw new TemplateSyntaxError({ message: String(e) })
  }
}

function scanTemplatePaths(template: string): string[] {
  const paths = new Set<string>()
  for (const m of template.matchAll(/\{\{(?!\#|\/)([\w.]+)\}\}/g)) {
    paths.add(m[1])
  }
  for (const m of template.matchAll(/\{\{#(?:if|unless|each)\s+([\w.]+)\}\}/g)) {
    paths.add(m[1])
  }
  return [...paths]
}

export class Template extends Data.Class<{
  readonly template: string
  readonly vars: Readonly<Record<string, string>>
  readonly options: TemplateOptions
}> {

  // Factory — clean starting point, no need to pass vars manually
  static make(template: string, options: TemplateOptions = { strict: false }): Template {
    return new Template({ template, vars: {}, options: options })
  }

  // Returns a NEW instance — does not mutate
  setVar(key: string, value: any): Template {
    return new Template({
      template: this.template,
      vars: { ...this.vars, [key]: value },
      options: this.options,
    })
  }

  setInputEnv(value: WorkflowEnv): Template {
    return this.setVar("inputs", value)
  }

  static fromFile(filePath: string, options: TemplateOptions = { strict: false }): Effect.Effect<Template, TemplateError> {
    return Effect.try({
      try: () => {
        if (!Fs.existsSync(filePath)) {
          throw new TemplateFileError({ filePath, message: "File not found" })
        }
        const content = Fs.readFileSync(filePath, "utf-8")
        return Template.make(content, options)
      },
      catch: (e) => {
        if (e instanceof TemplateFileError) return e
        return new TemplateFileError({ filePath, message: String(e) })
      }
    })
  }

  // Effectful render — fails if any variable is still missing
  render(): Effect.Effect<string, TemplateError> {
    return Effect.try({
      try: () => {
        return resolveTemplate(this.template, this.vars, this.options)
      },
      catch: (e) => {
        if (e instanceof MissingVariableError || e instanceof TemplateSyntaxError) {
          return e
        }
        return new TemplateSyntaxError({ message: String(e) })
      }
    })
  }
}