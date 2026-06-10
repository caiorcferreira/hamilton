export function resolveWorkflowSlug(
  input: string,
  available: ReadonlySet<string>
): string {
  const idx = input.indexOf("--variants")
  const base = idx === -1 ? input : input.substring(0, idx)
  if (available.has(base)) return base
  return input
}
