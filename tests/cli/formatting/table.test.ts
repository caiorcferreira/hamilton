import { describe, it, expect } from "vitest"
import { renderTable, Column } from "../../../src/cli/formatting/table.js"

type Item = { id: string; name: string; n: number }
const cols: Column<Item>[] = [
  { header: "ID", width: 6, render: (i) => i.id },
  { header: "NAME", width: 8, render: (i) => i.name },
  { header: "N", width: 3, render: (i) => String(i.n) }
]

describe("renderTable", () => {
  it("single row", () => {
    const out = renderTable([{ id: "abc", name: "test", n: 3 }], cols)
    const lines = out.split("\n")
    expect(lines[0]).toContain("ID")
    expect(lines[0]).toContain("NAME")
    expect(lines[1]).toContain("abc")
    expect(lines[1]).toContain("test")
  })

  it("column alignment across rows", () => {
    const out = renderTable([
      { id: "x", name: "s", n: 1 },
      { id: "yyy", name: "longer", n: 99 }
    ], cols)
    const lines = out.split("\n")
    expect(lines).toHaveLength(3)
    const i1 = lines[1].indexOf("x")
    const i2 = lines[2].indexOf("y")
    expect(i1).toBe(i2)
  })

  it("empty items returns header only", () => {
    const out = renderTable([], cols)
    expect(out.split("\n")).toHaveLength(1)
  })
})