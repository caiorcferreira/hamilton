import { Effect, Console, Either } from "effect"
import type { LoadedHook, HookPoint, HookAction, HookResult } from "./types.js"

export function runHooks(
  point: HookPoint,
  initialCtx: Record<string, unknown>,
  allHooks?: LoadedHook[]
): Effect.Effect<{ action: HookAction; data: Record<string, unknown> }, never, never> {
  return Effect.gen(function* (_) {
    const matching = (allHooks ?? []).filter((h) => h.point === point)
    let data = { ...initialCtx }

    for (const hook of matching) {
      const result = yield* _(
        Effect.either(hook.fn(data) as unknown as Effect.Effect<HookResult, unknown, never>)
      )

      if (Either.isLeft(result)) {
        yield* _(Console.log(`Hook "${hook.name}" failed: ${String(result.left)}`))
        continue
      }

      const output: HookResult = result.right as HookResult

      if (output.action === "cancel") {
        return { action: "cancel", data: { ...data, ...output.data as Record<string, unknown> } }
      }

      if (output.action === "fail") {
        return { action: "fail", data: { ...data, ...output.data as Record<string, unknown> } }
      }

      data = { ...data, ...output.data as Record<string, unknown> }
    }

    return { action: "continue", data }
  })
}