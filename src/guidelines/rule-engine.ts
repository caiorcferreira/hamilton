import type { CompiledRule, RuleMatch } from "./types.js"

export function evaluateToolCall(
  rules: CompiledRule[],
  toolName: string,
  toolInput: Record<string, unknown>
): RuleMatch[] {
  const matches: RuleMatch[] = []

  for (const rule of rules) {
    if (!rule.toolNames.includes(toolName)) continue

    let targetValue: string | undefined

    switch (rule.target) {
      case "command":
        targetValue = typeof toolInput.command === "string" ? toolInput.command : undefined
        break
      case "path":
        targetValue = typeof toolInput.filePath === "string"
          ? toolInput.filePath
          : typeof toolInput.path === "string"
            ? toolInput.path
            : undefined
        break
      case "input":
        targetValue = JSON.stringify(toolInput)
        break
    }

    if (targetValue === undefined) continue

    if (rule.compiledPattern.test(targetValue)) {
      matches.push({
        ruleName: rule.name,
        reason: rule.reason,
        matchedValue: targetValue
      })
    }
  }

  return matches
}
