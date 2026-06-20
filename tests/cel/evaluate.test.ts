import { describe, it, expect } from "vitest"
import { evaluateWhen, WhenError } from "../../src/cel/evaluate.js"

describe("evaluateWhen", () => {
  const context = {
    inputs: {
      tasks: {
        plan: { outputs: { stories: [{ id: 1 }, { id: 2 }] } },
        test: { outputs: { passed: true } },
        verify: { outputs: { feedback: "" } }
      },
      foo: { bar: "hello" }
    }
  }

  it("returns true for equality check", () => {
    expect(evaluateWhen('inputs.tasks.test.outputs.passed == true', context)).toBe(true)
  })

  it("returns false for inequality check", () => {
    expect(evaluateWhen('inputs.tasks.verify.outputs.feedback != ""', context)).toBe(false)
  })

  it("returns true for inequality when values differ", () => {
    expect(evaluateWhen('inputs.foo.bar != "world"', context)).toBe(true)
  })

  it("supports size() macro on arrays", () => {
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() > 0", context)).toBe(true)
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() > 10", context)).toBe(false)
  })

  it("supports logical AND/OR", () => {
    expect(evaluateWhen("inputs.tasks.test.outputs.passed == true && inputs.tasks.verify.outputs.feedback == \"\"", context)).toBe(true)
    expect(evaluateWhen("inputs.tasks.test.outputs.passed == true || inputs.tasks.verify.outputs.feedback != \"\"", context)).toBe(true)
  })

  it("supports numeric comparison", () => {
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() >= 2", context)).toBe(true)
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() < 1", context)).toBe(false)
  })

  it("returns false for false condition", () => {
    expect(evaluateWhen("false", context)).toBe(false)
  })

  it("fails with WhenError on invalid syntax", () => {
    expect(() => evaluateWhen("inputs.tasks.===", context)).toThrow(WhenError)
  })

  it("fails with WhenError on missing path", () => {
    expect(() => evaluateWhen("inputs.tasks.nonexistent.outputs.x != ''", context)).toThrow(WhenError)
  })

  it("fails with WhenError on partial missing path", () => {
    expect(() => evaluateWhen("inputs.tasks.plan.outputs.nonexistent == 1", context)).toThrow(WhenError)
  })

  it("includes path in error message", () => {
    try {
      evaluateWhen("inputs.tasks.bogus.foo == 1", context)
      expect(false).toBe(true)
    } catch (e) {
      const err = e as WhenError
      expect(err.message).toContain("inputs.tasks.bogus")
    }
  })
})