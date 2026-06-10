import { describe, it, expect, vi } from "vitest"
import { createGuidelineExtension } from "../../../src/executors/pi/guideline-extension.js"
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
    const api = { addEventListener: vi.fn() }
    ext(api)
    expect(api.addEventListener).not.toHaveBeenCalled()
  })

  it("registers a tool_call listener when rules are present", () => {
    const ext = createGuidelineExtension([makeRule()])
    const api = { addEventListener: vi.fn() }
    ext(api)
    expect(api.addEventListener).toHaveBeenCalledWith("tool_call", expect.any(Function))
  })

  it("blocks tool call and injects reason when rule matches", () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "bash" },
      args: { command: "npm install" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).toHaveBeenCalled()
    expect(addMessage).toHaveBeenCalledWith({ role: "system", content: "Use pnpm." })
  })

  it("does not block when no rule matches", () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "bash" },
      args: { command: "pnpm install" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).not.toHaveBeenCalled()
    expect(addMessage).not.toHaveBeenCalled()
  })

  it("does not block when tool does not match any rule toolNames", () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "read" },
      args: { filePath: "/tmp/x" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).not.toHaveBeenCalled()
    expect(addMessage).not.toHaveBeenCalled()
  })

  it("injects multiple reasons when multiple rules match", () => {
    const rules: CompiledRule[] = [
      makeRule(),
      { ...makeRule(), name: "no-npm-exec", compiledPattern: new RegExp("^npm "), reason: "Use pnpm dlx." }
    ]
    const ext = createGuidelineExtension(rules)
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "bash" },
      args: { command: "npm exec tsc" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).toHaveBeenCalled()
    expect(addMessage).toHaveBeenCalledTimes(2)
    expect(addMessage).toHaveBeenCalledWith({ role: "system", content: "Use pnpm." })
    expect(addMessage).toHaveBeenCalledWith({ role: "system", content: "Use pnpm dlx." })
  })
})
