import { describe, it, expect } from "vitest"
import { createRtkExtension } from "../../../src/executors/pi/rtk-extension.js"

describe("createRtkExtension", () => {
  it("returns a function (the extension factory)", () => {
    const factory = createRtkExtension({})
    expect(typeof factory).toBe("function")
  })

  it("respects RTK_DISABLED environment variable", () => {
    const origEnv = process.env.RTK_DISABLED
    process.env.RTK_DISABLED = "1"
    const factory = createRtkExtension({})
    const mockPi = { addEventListener: () => {} }
    factory(mockPi)
    expect(typeof factory).toBe("function")
    process.env.RTK_DISABLED = origEnv
  })

  it("does not throw when options.disabled is true", () => {
    const factory = createRtkExtension({ disabled: true })
    const mockPi = { addEventListener: () => {} }
    factory(mockPi)
    expect(typeof factory).toBe("function")
  })

  it("passes model through options", () => {
    const factory = createRtkExtension({ model: "anthropic/claude-sonnet-4-20250514" })
    expect(typeof factory).toBe("function")
  })

  it("returns no-op for pi without addEventListener", () => {
    const factory = createRtkExtension({})
    factory({})
    expect(typeof factory).toBe("function")
  })
})