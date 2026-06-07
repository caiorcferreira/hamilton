export interface Story {
  id: string
  title: string
  description: string
  acceptanceCriteria: string[]
}

export type Context = Record<string, unknown>

export function resolveTemplate(template: string, context: Context): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in context)) return match
    const value = context[key]
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}

export function mergeContext(existing: Context, incoming: Context): Context {
  return { ...existing, ...incoming }
}

export function parseStoriesJson(json: string): Story[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item: unknown): item is Story =>
        typeof item === "object" && item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).title === "string"
    ).map((item: { id: string; title: string; description?: unknown; acceptanceCriteria?: unknown }) => ({
      id: item.id as string,
      title: item.title as string,
      description: typeof item.description === "string" ? item.description : "",
      acceptanceCriteria: Array.isArray(item.acceptanceCriteria)
        ? item.acceptanceCriteria.filter((a: unknown) => typeof a === "string")
        : []
    }))
  } catch {
    return []
  }
}