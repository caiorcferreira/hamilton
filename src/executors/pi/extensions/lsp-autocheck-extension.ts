import { loadRuntime } from "@narumitw/pi-lsp/src/adapters.js"
import { resolveRoot } from "@narumitw/pi-lsp/src/files.js"
import { runDiagnostics } from "@narumitw/pi-lsp/src/runner.js"
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent"
import { Effect } from "effect"
import { type EventBusService } from "../../../events/bus.js"

const STATUS_KEY = "lsp-autocheck"

function formatDiagnosticsText(
  result: Awaited<ReturnType<typeof runDiagnostics>>
): string | undefined {
  const summary = (result.details as Record<string, unknown> | undefined)?.summary as { diagnostics?: number } | undefined
  if (!summary || summary.diagnostics === 0) return undefined
  const text = result.content?.find((c) => c.type === "text")?.text ?? ""
  return text || undefined
}

export function createLspAutocheckExtension(bus: EventBusService, runId: string, taskId: string): (pi: ExtensionAPI) => void {
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
          if (diagnosticsText) {
            Effect.runPromise(bus.publish({
              _tag: "LspDiagnostic",
              runId,
              taskId,
              filePath,
              text: diagnosticsText
            }).pipe(
              Effect.catchAll(() => Effect.void)
            )).catch(() => {})
          }

          if (!diagnosticsText) return undefined

          return {
            content: [
              { type: "text", text: `\n${diagnosticsText}\n` },
              ...event.content
            ]
          }
        } catch (err) {
          console.warn("[lsp-autocheck] diagnostics failed:", err)
          return undefined
        }
      })
    }
  } catch (err) {
    console.warn("[lsp-autocheck] loadRuntime failed:", err)
    return () => {}
  }
}
