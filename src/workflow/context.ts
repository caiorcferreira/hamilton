import type { WorkflowTask } from "../types.js"

export type Context = Record<string, unknown>

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
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in context)) return match
    const value = context[key]
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}

export function mergeContext(existing: Context, incoming: Context): Context {
  return { ...existing, ...incoming }
}

export function buildAutoContext(
  task: WorkflowTask,
  allOutputs: Context,
  vars: Context
): Context {
  if (task.context) {
    const result: Context = {}
    for (const field of task.context.fields) {
      const ref = field.valueFrom.ref
      if (ref.startsWith("vars.")) {
        result[field.name] = resolveDottedPath({ vars }, ref)
      } else {
        result[field.name] = resolveDottedPath(allOutputs, ref)
      }
    }
    return result
  }
  return allOutputs
}