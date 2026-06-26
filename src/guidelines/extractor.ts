import type { CompiledRule, LoadedGuideline } from "./types.js"

export function extractGuidelineArtifacts(loaded: LoadedGuideline[]): {
  files: Array<{ name: string; content: string }>
  rules: CompiledRule[]
} {
  const files: Array<{ name: string; content: string }> = []
  const rules: CompiledRule[] = []
  for (const g of loaded) {
    if (g.instructions) {
      for (const inst of g.instructions) files.push(inst)
    }
    if (g.rules) {
      for (const rule of g.rules) rules.push(rule)
    }
  }
  return { files, rules }
}
