import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent"
import { lintSource } from "@secretlint/core"
import { creator } from "@secretlint/secretlint-rule-preset-recommend"

function isTextContent(block: unknown): block is { type: "text"; text: string } {
  return typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "text"
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

async function redactText(text: string): Promise<string | null> {
  if (text.length < 20) return null

  try {
    const result = await withTimeout(
      lintSource({
        source: {
          contentType: "text",
          content: text,
          filePath: "tool-output.txt",
          ext: ".txt"
        },
        options: {
          config: {
            rules: [
              { id: "@secretlint/secretlint-rule-preset-recommend", rule: creator }
            ]
          },
          noPhysicFilePath: true,
          maskSecrets: true
        }
      }),
      2000
    )

    if (result.messages.length === 0) return null

    const sorted = [...result.messages].sort((a, b) => b.range[0] - a.range[0])

    let redacted = text
    for (const msg of sorted) {
      const [start, end] = msg.range
      redacted = redacted.slice(0, start) + `[REDACTED:${msg.messageId}]` + redacted.slice(end)
    }

    return redacted
  } catch {
    console.warn("[redact-extension] secretlint scan failed or timed out")
    return null
  }
}

export function createRedactExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("tool_result", async (event: ToolResultEvent) => {
      let modified = false

      const newContent = await Promise.all(
        event.content.map(async (block) => {
          if (!isTextContent(block)) return block
          const redacted = await redactText(block.text)
          if (redacted === null) return block
          modified = true
          return { ...block, text: redacted }
        })
      )

      if (!modified) return undefined
      return { content: newContent }
    })
  }
}
