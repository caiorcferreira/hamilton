import { describe, it, expect } from "vitest"
import { createRtkExtension } from "../../../src/executors/pi/rtk-extension.js"

describe("createRtkExtension", () => {
  it("returns a function (the extension factory)", () => {
    const factory = createRtkExtension({})
    expect(typeof factory).toBe("function")
  })

  it("returns no-op when disabled", () => {
    const factory = createRtkExtension({ disabled: true })
    const mockPi = { addEventListener: () => {} }
    factory(mockPi)
    expect(typeof factory).toBe("function")
  })

  it("returns no-op for pi without addEventListener", () => {
    const factory = createRtkExtension({})
    factory({})
    expect(typeof factory).toBe("function")
  })
})