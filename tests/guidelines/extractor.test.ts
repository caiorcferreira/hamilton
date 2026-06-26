import { describe, it, expect } from "vitest"
import { extractGuidelineArtifacts } from "../../src/guidelines/extractor.js"
import type { LoadedGuideline, CompiledRule } from "../../src/guidelines/types.js"

describe("extractGuidelineArtifacts", () => {
  it("extracts instruction files from loaded guidelines", () => {
    const loaded: LoadedGuideline[] = [
      {
        name: "security",
        instructions: [
          { name: "security:policy.md", content: "# Security Policy" },
          { name: "security:owasp.md", content: "# OWASP Guidelines" }
        ],
        rules: null
      }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toHaveLength(2)
    expect(result.files[0]).toEqual({ name: "security:policy.md", content: "# Security Policy" })
    expect(result.files[1]).toEqual({ name: "security:owasp.md", content: "# OWASP Guidelines" })
    expect(result.rules).toEqual([])
  })

  it("extracts compiled rules from loaded guidelines", () => {
    const rule: CompiledRule = {
      name: "no-eval",
      toolNames: ["bash"],
      target: "command",
      pattern: "eval\\(",
      reason: "eval is dangerous",
      compiledPattern: /eval\(/
    }
    const loaded: LoadedGuideline[] = [
      {
        name: "security",
        instructions: null,
        rules: [rule]
      }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toEqual([])
    expect(result.rules).toEqual([rule])
  })

  it("handles empty input", () => {
    const result = extractGuidelineArtifacts([])
    expect(result.files).toEqual([])
    expect(result.rules).toEqual([])
  })

  it("extracts files and rules from multiple guidelines", () => {
    const rule: CompiledRule = {
      name: "no-eval",
      toolNames: ["bash"],
      target: "command",
      pattern: "eval\\(",
      reason: "eval is dangerous",
      compiledPattern: /eval\(/
    }
    const loaded: LoadedGuideline[] = [
      {
        name: "typescript",
        instructions: [{ name: "ts:style.md", content: "Use const" }],
        rules: null
      },
      {
        name: "security",
        instructions: null,
        rules: [rule]
      }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toHaveLength(1)
    expect(result.rules).toHaveLength(1)
  })

  it("skips guidelines with null instructions and null rules", () => {
    const loaded: LoadedGuideline[] = [
      { name: "empty", instructions: null, rules: null }
    ]
    const result = extractGuidelineArtifacts(loaded)
    expect(result.files).toEqual([])
    expect(result.rules).toEqual([])
  })
})
