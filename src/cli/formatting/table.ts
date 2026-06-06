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