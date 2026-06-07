import { describe, it, expect } from "vitest"
import { resolveTemplate, mergeContext, parseStoriesJson } from "../../src/workflow/context.js"

describe("resolveTemplate", () => {
  it("replaces {{key}} with context values", () => {
    expect(resolveTemplate("Hello {{name}}!", { name: "world" })).toBe("Hello world!")
  })

  it("keeps unreplaced templates intact", () => {
    expect(resolveTemplate("Hello {{name}}!", {})).toBe("Hello {{name}}!")
  })

  it("replaces multiple templates", () => {
    expect(resolveTemplate("{{a}} and {{b}}", { a: "1", b: "2" })).toBe("1 and 2")
  })
})

describe("mergeContext", () => {
  it("merges incoming into existing", () => {
    expect(mergeContext({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" })
  })

  it("overwrites existing keys with incoming", () => {
    expect(mergeContext({ a: "1" }, { a: "2" })).toEqual({ a: "2" })
  })

  it("returns new object without mutating inputs", () => {
    const existing = { a: "1" }
    const incoming = { b: "2" }
    const result = mergeContext(existing, incoming)
    expect(result).toEqual({ a: "1", b: "2" })
    expect(existing).toEqual({ a: "1" })
  })

  it("stringifies non-string values as JSON", () => {
    const result = mergeContext({}, { items: [1, 2], obj: { key: "val" }, num: 42 })
    expect(result.items).toBe("[1,2]")
    expect(result.obj).toBe('{"key":"val"}')
    expect(result.num).toBe("42")
  })

  it("skips null and undefined values", () => {
    const result = mergeContext({}, { a: null, b: undefined, c: "keep" })
    expect(result).toEqual({ c: "keep" })
  })
})

describe("parseStoriesJson", () => {
  it("parses valid stories JSON", () => {
    const stories = parseStoriesJson(JSON.stringify([
      { id: "1", title: "Story 1", description: "desc", acceptanceCriteria: ["ac1"] }
    ]))
    expect(stories).toHaveLength(1)
    expect(stories[0].id).toBe("1")
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseStoriesJson("not json")).toEqual([])
  })

  it("returns empty array for non-array JSON", () => {
    expect(parseStoriesJson('"hello"')).toEqual([])
  })

  it("filters stories without string id and title", () => {
    const stories = parseStoriesJson(JSON.stringify([
      { id: "1", title: "Good" },
      { title: "Missing Id" }
    ]))
    expect(stories).toHaveLength(1)
  })
})