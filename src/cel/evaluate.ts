import { evaluate as celEvaluate } from "@marcbachmann/cel-js"
import { Data } from "effect"

export class WhenError extends Data.TaggedError("WhenError")<{
  message: string
}> { }

function extractPaths(expression: string): string[] {
  const paths: string[] = []
  const regex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\b/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(expression)) !== null) {
    const candidate = match[1]
    if (candidate.startsWith("inputs.") && !candidate.match(/\b(true|false|null|size|has|all|exists|filter|map)\b/)) {
      paths.push(candidate)
    }
  }
  return paths
}

function pathExists(context: Record<string, unknown>, path: string): boolean {
  const segments = path.split(".")
  let current: unknown = context
  for (const seg of segments) {
    if (current === null || current === undefined) return false
    if (typeof current !== "object") return false
    if (!(seg in (current as Record<string, unknown>))) return false
    current = (current as Record<string, unknown>)[seg]
  }
  return true
}

export function evaluateWhen(expression: string, context: { inputs: Record<string, unknown> }): boolean {
  const paths = extractPaths(expression)
  for (const path of paths) {
    if (!pathExists(context, path)) {
      return false
    }
  }

  try {
    const result = celEvaluate(expression, context)
    return Boolean(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new WhenError({ message: `CEL evaluation error: ${message}` })
  }
}