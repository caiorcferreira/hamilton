export interface Summary {
  type: string
  bytes: number
  lines?: number
  keys?: string[]
}

function classify(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return "string"
  if (typeof value === "number") return "number"
  if (typeof value === "boolean") return "boolean"
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return "binary"
  if (Array.isArray(value)) return "array"
  return "object"
}

function measure(value: unknown, t: string): { bytes: number; lines?: number; keys?: string[] } {
  if (t === "null") return { bytes: 0 }
  if (t === "string") {
    const s = value as string
    return { bytes: Buffer.byteLength(s, "utf8"), lines: s.split("\n").length }
  }
  if (t === "binary") return { bytes: (value as Uint8Array).length }
  if (t === "object" && !Array.isArray(value)) {
    const s = JSON.stringify(value)
    const keys = Object.keys(value as Record<string, unknown>)
    return { bytes: s.length, keys }
  }
  const s = JSON.stringify(value)
  return { bytes: s.length }
}

export function summarizeToolArgs(args: unknown): Summary {
  const type = classify(args)
  const m = measure(args, type)
  return { type, bytes: m.bytes, keys: m.keys }
}

export function summarizeToolResult(result: unknown): Summary {
  const type = classify(result)
  const m = measure(result, type)
  return { type, bytes: m.bytes, lines: m.lines, keys: m.keys }
}

export function summarizePayload(payload: unknown): Summary {
  const type = classify(payload)
  const m = measure(payload, type)
  return { type, bytes: m.bytes, lines: m.lines, keys: m.keys }
}
