import { Effect, Console } from "effect"
import * as Fs from "node:fs"
import type { LoadedHook, HookPoint, HookFunction } from "./types.js"
import { HOOK_POINTS } from "./types.js"
import { hooksDir } from "../paths.js"

export const loadHooks: Effect.Effect<LoadedHook[], never, never> = Effect.gen(function* (_) {
  const dir = hooksDir()
  if (!Fs.existsSync(dir)) return []

  const entries = Fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .sort()

  const loaded: LoadedHook[] = []

  for (const entry of entries) {
    const name = entry.name.replace(/\.ts$/, "")
    const filePath = `${dir}/${entry.name}`

    const modOption = yield* _(
      Effect.tryPromise({
        try: () => import(filePath),
        catch: () => new Error("import failed")
      }).pipe(Effect.option)
    )

    if (modOption._tag === "None") {
      yield* _(Console.log(`Hook "${name}": import failed — skipping`))
      continue
    }

    const mod = modOption.value
    const defaultExport = mod.default

    if (!defaultExport || typeof defaultExport !== "function") {
      yield* _(Console.log(`Hook "${name}": default export is not a function — skipping`))
      continue
    }

    const fn = defaultExport as (...args: unknown[]) => unknown
    const fnName = fn.name

    if (!fnName || !(HOOK_POINTS as readonly string[]).includes(fnName)) {
      yield* _(Console.log(`Hook "${name}": function name "${fnName || "anonymous"}" is not a valid hook point — skipping`))
      continue
    }

    loaded.push({
      name,
      point: fnName as HookPoint,
      fn: fn as HookFunction<Record<string, unknown>>
    })
  }

  return loaded
})