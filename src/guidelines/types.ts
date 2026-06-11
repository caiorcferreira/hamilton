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

export interface GuidelineInstructionEntry {
  matching: string[]
  files: string[]
}

export interface GuidelineSpec {
  apiVersion: "dag.hamiltonai.dev/v1alpha1"
  kind: "Guideline"
  metadata: { name: string; description?: string }
  spec: {
    instructions?: GuidelineInstructionEntry[]
    rules?: GuidelineRule[]
  }
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
