import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { runHooks } from "../../src/hook/runner.js"
import type { LoadedHook, HookPoint } from "../../src/hook/types.js"

function makeHook(name: string, point: HookPoint, impl: (ctx: Record<string, unknown>) => Effect.Effect<never, never, { action: "continue" | "cancel" | "fail"; data: Record<string, unknown> }>): LoadedHook {
  return { name, point, fn: impl as any }
}

describe("runHooks", () => {
  it("returns continue when no hooks match", async () => {
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
      expect(result.value.data).toEqual({})
    }
  })

  it("runs matching hooks sequentially", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("a", "on_task_start", (ctx) => {
        order.push("a")
        return Effect.succeed({ action: "continue", data: { ...ctx, a_ran: true } })
      }),
      makeHook("b", "on_task_start", (ctx) => {
        order.push("b")
        return Effect.succeed({ action: "continue", data: { ...ctx, b_ran: true } })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", { original: true }, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(order).toEqual(["a", "b"])
    }
  })

  it("passes transformed data between hooks", async () => {
    const hooks: LoadedHook[] = [
      makeHook("add", "on_task_start", (ctx) =>
        Effect.succeed({ action: "continue", data: { ...ctx, count: (ctx.count as number || 0) + 1 } })
      ),
      makeHook("multiply", "on_task_start", (ctx) =>
        Effect.succeed({ action: "continue", data: { ...ctx, count: (ctx.count as number) * 2 } })
      )
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", { count: 1 }, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.data.count).toBe(4)
    }
  })

  it("stops chain on cancel action", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("first", "on_task_start", (ctx) => {
        order.push("first")
        return Effect.succeed({ action: "cancel", data: ctx })
      }),
      makeHook("second", "on_task_start", (ctx) => {
        order.push("second")
        return Effect.succeed({ action: "continue", data: ctx })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("cancel")
      expect(order).toEqual(["first"])
    }
  })

  it("stops chain on fail action", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("first", "on_task_start", (ctx) => {
        order.push("first")
        return Effect.succeed({ action: "fail", data: ctx })
      }),
      makeHook("second", "on_task_start", (ctx) => {
        order.push("second")
        return Effect.succeed({ action: "continue", data: ctx })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("fail")
      expect(order).toEqual(["first"])
    }
  })

  it("logs error and continues on hook failure", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("bad", "on_task_start", (_ctx) => {
        order.push("bad")
        return Effect.fail(new Error("boom"))
      }),
      makeHook("good", "on_task_start", (ctx) => {
        order.push("good")
        return Effect.succeed({ action: "continue", data: ctx })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
      expect(order).toEqual(["bad", "good"])
    }
  })

  it("only runs hooks matching the given point", async () => {
    const hooks: LoadedHook[] = [
      makeHook("exit_hook", "on_agent_exit", (_ctx) =>
        Effect.succeed({ action: "continue", data: {} })
      ),
      makeHook("start_hook", "on_task_start", (ctx) =>
        Effect.succeed({ action: "continue", data: { start_ran: true } })
      )
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.data).toEqual({ start_ran: true })
    }
  })
})