function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(dp[j], dp[j - 1], prev) + 1
      prev = temp
    }
  }
  return dp[n]
}

export function findNearestSlugs(input: string, available: ReadonlySet<string>): string[] {
  const entries = [...available]
  if (entries.length === 0) return []
  const scored = entries.map((slug) => ({ slug, distance: levenshtein(input, slug) }))
  scored.sort((a, b) => a.distance - b.distance)
  return scored.slice(0, 3).map((s) => s.slug)
}

export function resolveWorkflowSlug(
  input: string,
  available: ReadonlySet<string>
): string {
  const idx = input.indexOf("--variants")
  const base = idx === -1 ? input : input.substring(0, idx)
  if (available.has(base)) return base
  return input
}
