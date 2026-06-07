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

  it("stringifies non-string values in templates", () => {
    expect(resolveTemplate("Items: {{items}}", { items: [1, 2, 3] })).toBe("Items: [1,2,3]")
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

  it("preserves non-string values as-is", () => {
    const result = mergeContext({}, { items: [1, 2], obj: { key: "val" }, num: 42, flag: true })
    expect(result.items).toEqual([1, 2])
    expect(result.obj).toEqual({ key: "val" })
    expect(result.num).toBe(42)
    expect(result.flag).toBe(true)
  })

  it("merges structured context correctly", () => {
    const existing = { stories_json: [{ id: "1", title: "First" }] }
    const incoming = { stories_json: [{ id: "2", title: "Second" }], status: "done" }
    const result = mergeContext(existing, incoming)
    expect(result.stories_json).toEqual([{ id: "2", title: "Second" }])
    expect(result.status).toBe("done")
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