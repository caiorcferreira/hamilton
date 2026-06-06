export const red = (s: string) => `\x1b[31m${s}\x1b[0m`
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

export function categoryColor(id: string): (s: string) => string {
  if (id.startsWith("bug-fix")) return red
  if (id.startsWith("feature-dev")) return green
  if (id.startsWith("quarantine")) return yellow
  if (id.startsWith("security")) return cyan
  return (s: string) => s
}

export function statusColor(status: string): (s: string) => string {
  if (status === "running") return yellow
  if (status === "completed") return green
  if (status === "failed") return red
  if (status === "paused") return cyan
  return (s: string) => s
}