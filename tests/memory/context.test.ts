import { describe, it, expect } from "vitest"
import { buildMemoryContext } from "../../src/memory/context.js"
import type { MemoryAtom } from "../../src/memory/store.js"

describe("buildMemoryContext", () => {
  it("returns empty string for empty atom list", () => {
    expect(buildMemoryContext([])).toBe("")
  })

  it("formats canonical atoms into reference section", () => {
    const atoms: MemoryAtom[] = [
      {
        id: "a1",
        title: "Code Style Guide",
        kind: "canonical",
        scope: "user",
        confidence: 1.0,
        content: "Use 2-space indentation.",
        tags: ["lang:typescript"],
      },
    ]
    const context = buildMemoryContext(atoms)
    expect(context).toContain("Agent Memory — Session Context")
    expect(context).toContain("REFERENCE (canonical knowledge)")
    expect(context).toContain("[canonical] Code Style Guide")
    expect(context).toContain("Use 2-space indentation.")
    expect(context).toContain("ID: a1")
  })

  it("includes the correct markdown structure", () => {
    const atoms: MemoryAtom[] = [
      {
        id: "a1",
        title: "Test Guideline",
        kind: "canonical",
        scope: "user",
        confidence: 1.0,
        content: "Some content.",
        tags: [],
      },
    ]
    const context = buildMemoryContext(atoms)
    expect(context).toContain("---")
    expect(context).toContain("authoritative guidelines")
    expect(context).toContain("1 atoms injected inline")
  })
})