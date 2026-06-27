import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect } from "effect"
import { loadHooks } from "../../src/hook/loader.js"
import { makeHookRuntime } from "../../src/hook/integration.js"

describe("hook system integration", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-hooks-int-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton", "hooks"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loaded hooks fire correctly at their lifecycle points", async () => {
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "test_start.ts"), `
      import { Effect } from "effect"
      export default function on_workflow_start(ctx) {
        return Effect.succeed({ action: "continue", data: { hook_start_fired: true } })
      }
    `)

    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "test_complete.ts"), `
      import { Effect } from "effect"
      export default function on_workflow_completed(ctx) {
        return Effect.succeed({ action: "continue", data: { hook_complete_fired: true } })
      }
    `)

    const hooks = await Effect.runPromise(loadHooks)
    const runtime = makeHookRuntime(hooks)

    expect(hooks).toHaveLength(2)

    const startResult = await Effect.runPromise(runtime.run("on_workflow_start", { runId: "test", spec: {}, parameters: {} }))
    expect(startResult.action).toBe("continue")
    expect(startResult.data.hook_start_fired).toBe(true)

    const completeResult = await Effect.runPromise(runtime.run("on_workflow_completed", { runId: "test", status: "completed", taskResults: {}, summary: {} }))
    expect(completeResult.action).toBe("continue")
    expect(completeResult.data.hook_complete_fired).toBe(true)
  })

  it("cancel action stops the workflow", async () => {
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "blocker.ts"), `
      import { Effect } from "effect"
      export default function on_workflow_start(ctx) {
        return Effect.succeed({ action: "cancel", data: { reason: "blocked by test" } })
      }
    `)

    const hooks = await Effect.runPromise(loadHooks)
    const runtime = makeHookRuntime(hooks)

    const result = await Effect.runPromise(runtime.run("on_workflow_start", { runId: "test", spec: {}, parameters: {} }))
    expect(result.action).toBe("cancel")
    expect(result.data.reason).toBe("blocked by test")
  })

  it("hook at wrong lifecycle point does not fire", async () => {
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "wrong_point.ts"), `
      import { Effect } from "effect"
      export default function on_agent_exit(ctx) {
        return Effect.succeed({ action: "continue", data: { should_not_appear: true } })
      }
    `)

    const hooks = await Effect.runPromise(loadHooks)
    const runtime = makeHookRuntime(hooks)

    const result = await Effect.runPromise(runtime.run("on_workflow_start", { runId: "test", spec: {}, parameters: {} }))
    expect(result.action).toBe("continue")
    expect(result.data.should_not_appear).toBeUndefined()
  })
})