import { describe, it, expect, vi } from "vitest"
import { createGuidelineExtension } from "../../../src/executors/pi/extensions/guideline-extension.js"
import type { CompiledRule } from "../../../src/guidelines/types.js"

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    name: "no-npm",
    toolNames: ["bash"],
    target: "command",
    pattern: "^npm",
    reason: "Use pnpm.",
    compiledPattern: new RegExp(overrides.pattern ?? "^npm"),
    ...overrides
  }
}

describe("createGuidelineExtension", () => {
  it("returns a no-op factory when rules array is empty", () => {
    const ext = createGuidelineExtension([])
    const api = { on: vi.fn() }
    ext(api as any)
    expect(api.on).not.toHaveBeenCalled()
  })

  it("registers a tool_call listener when rules are present", () => {
    const ext = createGuidelineExtension([makeRule()])
    const api = { on: vi.fn() }
    ext(api as any)
    expect(api.on).toHaveBeenCalledWith("tool_call", expect.any(Function))
  })

  it("blocks tool call and returns reason when rule matches", async () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "bash",
      input: { command: "npm install" }
    }

    const result = await handler(evt)

    expect(result).toEqual({ block: true, reason: "Use pnpm." })
  })

  it("returns undefined when no rule matches", async () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "bash",
      input: { command: "pnpm install" }
    }

    const result = await handler(evt)

    expect(result).toBeUndefined()
  })

  it("returns undefined when tool does not match any rule toolNames", async () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "read",
      input: { path: "/tmp/x" }
    }

    const result = await handler(evt)

    expect(result).toBeUndefined()
  })

  it("joins multiple reasons when multiple rules match", async () => {
    const rules: CompiledRule[] = [
      makeRule(),
      { ...makeRule(), name: "no-npm-exec", compiledPattern: new RegExp("^npm "), reason: "Use pnpm dlx." }
    ]
    const ext = createGuidelineExtension(rules)
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "bash",
      input: { command: "npm exec tsc" }
    }

    const result = await handler(evt)

    expect(result).toEqual({ block: true, reason: "Use pnpm.\nUse pnpm dlx." })
  })
})