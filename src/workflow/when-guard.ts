import { Effect } from "effect"
import type { WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import type { EngineError } from "./run-state-machine.js"
import { evaluateWhen, WhenError } from "../cel/evaluate.js"

export function checkRecursionDepth(
  ctx: WorkflowRuntime,
  maxDepth: number | null,
  taskName: string
): Effect.Effect<"proceed" | "fail", EngineError> {
  return Effect.gen(function* (_) {
    if (maxDepth === null) return "proceed" as const
    const depth = yield* _(ctx.getTaskDepth(taskName))
    if (depth === null) return "proceed" as const
    if (depth >= maxDepth) {
      yield* _(ctx.transitionTask(taskName, "fail"))
      yield* _(ctx.fail(`max recursion depth (${maxDepth}) exceeded`))
      return "fail" as const
    }
    return "proceed" as const
  })
}

export function evaluateWhenCondition(
  task: WorkflowTask,
  env: WorkflowEnv
): "proceed" | "skip" | { _tag: "error"; message: string } {
  try {
    const result = evaluateWhen(task.when!, { inputs: env as Record<string, unknown> })
    return result ? "proceed" : "skip"
  } catch (e) {
    const msg = e instanceof WhenError ? e.message : String(e)
    return { _tag: "error", message: msg }
  }
}

export function handleWhenGuard(
  task: WorkflowTask,
  env: WorkflowEnv
): "proceed" | "skip" | { _tag: "error"; message: string } {
  if (!task.when) return "proceed"
  return evaluateWhenCondition(task, env)
}
