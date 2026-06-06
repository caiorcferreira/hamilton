export interface Story {
  id: string
  title: string
  description: string
  acceptanceCriteria: string[]
}

export function resolveTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in context ? context[key] : match
  )
}

export function mergeContext(
  existing: Record<string, string>,
  incoming: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    result[key] = String(value)
  }
  return result
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