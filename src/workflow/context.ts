import type { WorkflowTask } from "../types.js"
import { resolveDottedPath } from "../prompts/template.js"

export type Context = Record<string, unknown>

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
  return { ...allOutputs, ...vars }
}