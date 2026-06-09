import * as ChildProcess from "node:child_process"

export interface RtkExtensionOptions {
  disabled?: boolean
}

interface ToolCallEvent {
  toolCall: {
    name: string
    input: { command: string }
  }
  args?: { command: string }
}

interface PiExtensionApi {
  addEventListener(event: string, handler: (evt: ToolCallEvent) => void): void
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
  } catch {}
}

export function createRtkExtension(options: RtkExtensionOptions): (pi: unknown) => void {
  if (options.disabled) {
    return () => {}
  }

  return (pi: unknown) => {
    const api = pi as PiExtensionApi | null
    if (!api || typeof api.addEventListener !== "function") return

    api.addEventListener("tool_call", (evt: ToolCallEvent) => {
      if (evt.toolCall?.name === "bash") {
        const command = evt.args?.command ?? evt.toolCall.input.command
        rewriteCommand(evt.toolCall.input, command)
      }
    })
  }
}