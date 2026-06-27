import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadHooks } from "../../src/hook/loader.js"

describe("loadHooks", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-hooks-test-"))
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createHookFile(name: string, content: string): void {
    const dir = Path.join(tmpDir, ".hamilton", "hooks")
    Fs.mkdirSync(dir, { recursive: true })
    Fs.writeFileSync(Path.join(dir, name), content)
  }

  it("returns empty when hooks dir does not exist", async () => {
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("loads a valid hook file", async () => {
    createHookFile("reminder.ts", `
      import { Effect } from "effect"
      export default function on_agent_exit(ctx) {
        return Effect.succeed({ action: "continue", data: {} })
      }
    `)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const hooks = result.value
      expect(hooks).toHaveLength(1)
      expect(hooks[0]!.name).toBe("reminder")
      expect(hooks[0]!.point).toBe("on_agent_exit")
    }
  })

  it("skips files without a default function export", async () => {
    createHookFile("bad.ts", `export const foo = "bar"`)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("skips files whose function name is not a valid hook point", async () => {
    createHookFile("bad.ts", `
      import { Effect } from "effect"
      export default function not_a_hook(ctx) {
        return Effect.succeed({ action: "continue", data: {} })
      }
    `)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("skips files whose default export is not a function", async () => {
    createHookFile("bad.ts", `export default "string"`)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("loads multiple valid hooks", async () => {
    createHookFile("reminder.ts", `
      import { Effect } from "effect"
      export default function on_agent_exit(ctx) {
        return Effect.succeed({ action: "continue", data: {} })
      }
    `)
    createHookFile("audit.ts", `
      import { Effect } from "effect"
      export default function on_task_completed(ctx) {
        return Effect.succeed({ action: "continue", data: { result: ctx.result } })
      }
    `)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(2)
    }
  })

  it("ignores non-.ts files", async () => {
    createHookFile("notes.md", "# notes")
    createHookFile("helper.js", `export default {}`)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })
})