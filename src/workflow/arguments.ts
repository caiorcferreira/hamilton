import type { WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import { resolveDottedPath } from "../prompts/template.js"

export function resolveArguments(
  task: WorkflowTask,
  env: WorkflowEnv
): { parameters: Record<string, unknown>; itemsCount: number } {
  const args = task.arguments
  if (!args) return { parameters: {}, itemsCount: 1 }

  const wrappedEnv = { inputs: env }

  let items: unknown[] = [undefined]
  if (args.forEach) {
    const resolved = resolveDottedPath(wrappedEnv, args.forEach.valueFrom.ref)
    items = Array.isArray(resolved) ? resolved : [undefined]
  }

  const lastItem = items[items.length - 1]

  let params: Record<string, unknown> = {}
  if (args.forEach) {
    params = { [args.forEach.as]: lastItem }
  }

  if (args.parameters && args.parameters.length > 0) {
    const tempEnv = { ...env, parameters: { ...params } }
    const wrappedTemp = { inputs: tempEnv }
    for (const p of args.parameters) {
      params[p.name] = resolveDottedPath(wrappedTemp, p.valueFrom.ref)
    }
  }

  return { parameters: params, itemsCount: items.length }
}