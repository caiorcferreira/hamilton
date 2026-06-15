import type { Context } from "../workflow/context.js"

export function resolveDottedPath(context: Context, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = context
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function resolveTemplate(template: string, context: Context): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
    const value = resolveDottedPath(context, key)
    if (value === undefined) return match
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}

export function resolveInputsTemplate(template: string, env: Record<string, unknown>): string {
  return resolveTemplate(template, { inputs: env })
}