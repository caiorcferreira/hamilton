export interface GuidelineRule {
  name: string
  toolNames: string[]
  target: "command" | "path" | "input"
  pattern: string
  reason: string
}

export interface CompiledRule extends GuidelineRule {
  compiledPattern: RegExp
}

export interface GuidelineInstructions {
  extensions: string[]
  files: string[]
}

export interface GuidelineSpec {
  instructions?: GuidelineInstructions
  rules?: GuidelineRule[]
}

export interface LoadedGuideline {
  name: string
  instructions: Array<{ name: string; content: string }> | null
  rules: CompiledRule[] | null
}

export interface RuleMatch {
  ruleName: string
  reason: string
  matchedValue: string
}
