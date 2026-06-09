import { describe, it, expect } from "vitest"

describe("doctor command", () => {
  it("imports and exposes doctorCommand", async () => {
    const mod = await import("../../src/cli/commands/doctor.js")
    expect(mod.doctorCommand).toBeDefined()
  })
})