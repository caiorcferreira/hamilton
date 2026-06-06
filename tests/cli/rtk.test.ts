import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { verifyRtk, compareSemver } from "../../src/cli/commands/rtk.js"

describe("verifyRtk", () => {
  it("returns a RtkStatus with all required fields", async () => {
    const result = await Effect.runPromiseExit(verifyRtk)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveProperty("installed")
      expect(result.value).toHaveProperty("version")
      expect(result.value).toHaveProperty("path")
      expect(result.value).toHaveProperty("message")
      expect(typeof result.value.installed).toBe("boolean")
      if (!result.value.installed) {
        expect(result.value.version).toBeNull()
        expect(result.value.path).toBeNull()
      }
    }
  })
})

describe("compareSemver", () => {
  it("compares major versions", () => {
    expect(compareSemver("1.0.0", "0.23.0")).toBe(1)
    expect(compareSemver("0.22.0", "0.23.0")).toBe(-1)
    expect(compareSemver("0.23.0", "0.23.0")).toBe(0)
  })

  it("handles version prefixes", () => {
    expect(compareSemver("v0.24.0", "0.23.0")).toBe(1)
  })

  it("handles shorter versions", () => {
    expect(compareSemver("0.24", "0.23.0")).toBe(1)
    expect(compareSemver("0.23", "0.23.0")).toBe(0)
  })
})