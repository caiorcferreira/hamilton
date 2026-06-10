import { evaluateToolCall } from "../../guidelines/rule-engine.js"
import type { CompiledRule } from "../../guidelines/types.js"

interface ToolCallEvent {
  toolCall: { name: string }
  args?: Record<string, unknown>
  preventDefault: () => void
  api: {
    conversation: {
      addMessage: (msg: { role: string; content: string }) => void
    }
  }
}

interface PiExtensionApi {
  addEventListener(event: string, handler: (evt: ToolCallEvent) => void): void
}

export function createGuidelineExtension(
  rules: CompiledRule[]
): (pi: unknown) => void {
  if (rules.length === 0) {
    return () => {}
  }

  return (pi: unknown) => {
    const api = pi as PiExtensionApi | null
    if (!api || typeof api.addEventListener !== "function") return

    api.addEventListener("tool_call", (evt: ToolCallEvent) => {
      const input = evt.args ?? {}
      const matches = evaluateToolCall(rules, evt.toolCall.name, input)

      if (matches.length > 0) {
        evt.preventDefault()
        for (const match of matches) {
          evt.api.conversation.addMessage({
            role: "system",
            content: match.reason
          })
        }
      }
    })
  }
}
