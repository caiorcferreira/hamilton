import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent"
import { evaluateToolCall } from "../../../guidelines/rule-engine.js"
import type { CompiledRule } from "../../../guidelines/types.js"

export function createGuidelineExtension(
  rules: CompiledRule[]
): (pi: ExtensionAPI) => void {
  if (rules.length === 0) {
    return () => { }
  }

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
      const matches = evaluateToolCall(
        rules,
        event.toolName,
        (event.input as Record<string, unknown> | undefined) ?? {}
      )

      if (matches.length === 0) return undefined

      return { block: true, reason: matches.map(m => m.reason).join("\n") }
    })
  }
}