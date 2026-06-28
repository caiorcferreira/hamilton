# General Guidelines — 01: Code Style

This document defines the code-style rules for  projects all in any language.
Every rule includes a ✅ correct example and a ❌ incorrect example so the intent is unambiguous.

---

## Code organization

### Use blank lines to group related code

```typescript
// ✅ blank lines group the small pad function together, give space for distinct steps after
export interface Column<T> {
  header: string
  width: number
  render: (item: T) => string
}

export function renderTable<T>(items: T[], columns: Column<T>[]): string {
  const pad = (s: string, w: number) => {
    if (s.length >= w) return s.slice(0, w)
    return s + " ".repeat(w - s.length)
  }

  const header = columns.map((c) => pad(c.header, c.width)).join("  ")

  if (items.length === 0) return header

  const rows = items.map((item) =>
    columns.map((c) => pad(c.render(item), c.width)).join("  ")
  )

  return [header, ...rows].join("\n")
}
```

```typescript
// ❌ all different steps are squished together, c
export interface Column<T> {
  header: string
  width: number
  render: (item: T) => string
}
export function renderTable<T>(items: T[], columns: Column<T>[]): string {
  const pad = (s: string, w: number) => {
    if (s.length >= w) return s.slice(0, w)
    return s + " ".repeat(w - s.length)
  }
  const header = columns.map((c) => pad(c.header, c.width)).join("  ")
  if (items.length === 0) return header
  const rows = items.map((item) =>
    columns.map((c) => pad(c.render(item), c.width)).join("  ")
  )
  return [header, ...rows].join("\n")
}
```