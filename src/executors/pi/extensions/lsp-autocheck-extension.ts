import { loadRuntime } from "@narumitw/pi-lsp/src/adapters.js"
import { resolveRoot } from "@narumitw/pi-lsp/src/files.js"
import { runDiagnostics } from "@narumitw/pi-lsp/src/runner.js"
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent"

const STATUS_KEY = "lsp-autocheck"

function formatDiagnosticsText(
  result: Awaited<ReturnType<typeof runDiagnostics>>
): string | undefined {
  const text = result.content?.find((c) => c.type === "text")?.text ?? ""
  if (!text || text.includes("no diagnostics")) return undefined
  return text
}

export function createLspAutocheckExtension(): (pi: ExtensionAPI) => void {
  try {
    const { adapters, timeoutMs } = loadRuntime()
    if (adapters.length === 0) return () => {}

    return (pi: ExtensionAPI) => {
      pi.on("tool_result", async (event: ToolResultEvent) => {
        if (event.toolName !== "edit" && event.toolName !== "write") return undefined
        if (event.isError) return undefined

        const filePath = (event.input as Record<string, unknown>).filePath as string | undefined
        if (!filePath) return undefined

        const adapter = adapters.find((a) => a.isSupportedFile(filePath))
        if (!adapter) return undefined

        try {
          const result = await runDiagnostics(
            adapter,
            { root: resolveRoot(), files: [filePath] },
            timeoutMs,
            undefined,
            { ui: { setStatus: () => {} } },
            STATUS_KEY
          )

          const diagnosticsText = formatDiagnosticsText(result)
          if (!diagnosticsText) return undefined

          return {
            content: [
              { type: "text", text: `\n${diagnosticsText}\n` },
              ...event.content
            ]
          }
        } catch {
          return undefined
        }
      })
    }
  } catch {
    return () => {}
  }
}
