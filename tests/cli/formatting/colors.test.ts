import { describe, it, expect } from "vitest"
import { red, green, yellow, cyan, dim, bold, categoryColor, statusColor } from "../../../src/cli/formatting/colors.js"

describe("color functions", () => {
  it("red wraps with ANSI 31", () => {
    expect(red("fail")).toBe("\x1b[31mfail\x1b[0m")
  })
  it("green wraps with ANSI 32", () => {
    expect(green("ok")).toBe("\x1b[32mok\x1b[0m")
  })
  it("yellow wraps with ANSI 33", () => {
    expect(yellow("warn")).toBe("\x1b[33mwarn\x1b[0m")
  })
  it("cyan wraps with ANSI 36", () => {
    expect(cyan("info")).toBe("\x1b[36minfo\x1b[0m")
  })
  it("dim wraps with ANSI 2", () => {
    expect(dim("faded")).toBe("\x1b[2mfaded\x1b[0m")
  })
  it("bold wraps with ANSI 1", () => {
    expect(bold("strong")).toBe("\x1b[1mstrong\x1b[0m")
  })
})

describe("categoryColor", () => {
  it("bug-fix -> red", () => {
    const fn = categoryColor("bug-fix-github-pr")
    expect(fn("t")).toBe(red("t"))
  })
  it("feature-dev -> green", () => {
    const fn = categoryColor("feature-dev-merge")
    expect(fn("t")).toBe(green("t"))
  })
  it("quarantine -> yellow", () => {
    const fn = categoryColor("quarantine-broken-tests")
    expect(fn("t")).toBe(yellow("t"))
  })
  it("security -> cyan", () => {
    const fn = categoryColor("security-audit-worktree")
    expect(fn("t")).toBe(cyan("t"))
  })
  it("unknown -> identity", () => {
    const fn = categoryColor("other")
    expect(fn("test")).toBe("test")
  })
})

describe("statusColor", () => {
  it("running -> yellow", () => {
    expect(statusColor("running")("t")).toBe(yellow("t"))
  })
  it("completed -> green", () => {
    expect(statusColor("completed")("t")).toBe(green("t"))
  })
  it("failed -> red", () => {
    expect(statusColor("failed")("t")).toBe(red("t"))
  })
  it("paused -> cyan", () => {
    expect(statusColor("paused")("t")).toBe(cyan("t"))
  })
})