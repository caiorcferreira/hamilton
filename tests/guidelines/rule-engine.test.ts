import { describe, it, expect } from "vitest"
import { evaluateToolCall } from "../../src/guidelines/rule-engine.js"
import type { CompiledRule, RuleMatch } from "../../src/guidelines/types.js"

function rule(overrides: Partial<CompiledRule> = {}): CompiledRule {
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

describe("evaluateToolCall", () => {
  it("matches command target", () => {
    const matches = evaluateToolCall(
      [rule()],
      "bash",
      { command: "npm install" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].ruleName).toBe("no-npm")
    expect(matches[0].reason).toBe("Use pnpm.")
    expect(matches[0].matchedValue).toBe("npm install")
  })

  it("matches path target via filePath", () => {
    const pathRule = rule({
      name: "no-lock",
      toolNames: ["read"],
      target: "path",
      pattern: "package-lock\\.json",
      reason: "Do not read lock files.",
      compiledPattern: new RegExp("package-lock\\.json")
    })
    const matches = evaluateToolCall(
      [pathRule],
      "read",
      { filePath: "/proj/package-lock.json" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedValue).toBe("/proj/package-lock.json")
  })

  it("matches path target via path key", () => {
    const pathRule = rule({
      name: "no-ls-root",
      toolNames: ["ls"],
      target: "path",
      pattern: "^/$",
      reason: "Do not list root.",
      compiledPattern: new RegExp("^/$")
    })
    const matches = evaluateToolCall(
      [pathRule],
      "ls",
      { path: "/" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedValue).toBe("/")
  })

  it("matches input target (JSON.stringify)", () => {
    const inputRule = rule({
      name: "no-secret",
      toolNames: ["write"],
      target: "input",
      pattern: "SECRET",
      reason: "Do not write secrets.",
      compiledPattern: new RegExp("SECRET")
    })
    const matches = evaluateToolCall(
      [inputRule],
      "write",
      { filePath: "/tmp/x", content: "contains SECRET_KEY" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedValue).toContain("SECRET_KEY")
  })

  it("returns empty when toolName not in toolNames", () => {
    const matches = evaluateToolCall(
      [rule()],
      "read",
      { command: "npm install" }
    )
    expect(matches).toEqual([])
  })

  it("returns empty when target key absent from input", () => {
    const matches = evaluateToolCall(
      [rule()],
      "bash",
      { something: "else" }
    )
    expect(matches).toEqual([])
  })

  it("returns empty when regex does not match", () => {
    const matches = evaluateToolCall(
      [rule()],
      "bash",
      { command: "pnpm install" }
    )
    expect(matches).toEqual([])
  })

  it("matches multiple rules on same tool call", () => {
    const rules: CompiledRule[] = [
      rule(),
      { ...rule(), name: "no-npx", compiledPattern: new RegExp("^npm "), reason: "Prefer pnpm dlx." }
    ]
    const matches = evaluateToolCall(rules, "bash", { command: "npm exec tsc" })
    expect(matches).toHaveLength(2)
    expect(matches[0].ruleName).toBe("no-npm")
    expect(matches[1].ruleName).toBe("no-npx")
  })

  it("handles empty rules array", () => {
    const matches = evaluateToolCall([], "bash", { command: "npm install" })
    expect(matches).toEqual([])
  })

  it("only evaluates rules for the matching tool", () => {
    const bashRule = rule()
    const writeRule = rule({
      name: "no-secret",
      toolNames: ["write"],
      target: "input",
      pattern: "SECRET",
      reason: "no.",
      compiledPattern: new RegExp("SECRET")
    })
    const matches = evaluateToolCall([bashRule, writeRule], "bash", { command: "npm install" })
    expect(matches).toHaveLength(1)
    expect(matches[0].ruleName).toBe("no-npm")
  })
})
