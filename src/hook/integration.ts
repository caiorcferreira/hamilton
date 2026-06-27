import { Effect } from "effect"
import type { LoadedHook, HookPoint, HookAction } from "./types.js"
import { runHooks } from "./runner.js"

export interface HookRuntime {
  readonly hooks: ReadonlyArray<LoadedHook>
  run: (point: HookPoint, ctx: Record<string, unknown>) => Effect.Effect<{ action: HookAction; data: Record<string, unknown> }, never, never>
}

export function makeHookRuntime(hooks: ReadonlyArray<LoadedHook>): HookRuntime {
  return {
    hooks,
    run: (point, ctx) => runHooks(point, ctx, hooks as LoadedHook[])
  }
}

export function mergeHookData<T extends Record<string, unknown>>(
  original: T,
  transformed: Record<string, unknown>,
  blocklist: string[] = []
): T {
  const result = { ...original, ...transformed } as Record<string, unknown>
  for (const key of blocklist) {
    delete result[key]
  }
  return result as T
}