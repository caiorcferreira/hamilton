import * as ChildProcess from "node:child_process"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export interface RtkExtensionOptions {
  disabled?: boolean
}

export function rewriteCommand(
  toolInput: { command: string },
  command: string
): void {
  try {
    const result = ChildProcess.spawnSync("rtk", ["rewrite", command], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000
    })
    if ((result.status === 0 || result.status === 3) && result.stdout !== command) {
      toolInput.command = result.stdout
    }
  } catch { }
}

export function createRtkExtension(options?: RtkExtensionOptions): (pi: ExtensionAPI) => void {
  if (options?.disabled) {
    return () => { }
  }

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event) => {
      if (event.toolName === "bash") {
        const command = (event.input as Record<string, unknown>).command as string | undefined
        if (command) rewriteCommand(event.input as { command: string }, command)
      }
    })
  }
}