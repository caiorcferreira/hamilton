const VARIANT_SUFFIXES = ["-merge-worktree", "-github-pr", "-merge", "-worktree"] as const

const SUFFIX_MAP: Record<string, string> = {
  "--merge-worktree": "-merge-worktree",
  "--github-pr": "-github-pr",
  "--merge": "-merge",
  "--worktree": "-worktree"
}

export function resolveWorkflowId(
  input: string,
  available: ReadonlySet<string>
): string {
  if (available.has(input)) return input

  const lastSep = input.lastIndexOf("--")
  if (lastSep === -1) return input

  const base = input.substring(0, lastSep)
  const suffix = input.substring(lastSep)

  const mapped = SUFFIX_MAP[suffix]
  if (mapped !== undefined) {
    const candidate = base + mapped
    if (available.has(candidate)) return candidate
  }

  for (const vs of VARIANT_SUFFIXES) {
    const candidate = base + vs
    if (available.has(candidate)) return candidate
  }

  if (available.has(base)) return base

  return input
}