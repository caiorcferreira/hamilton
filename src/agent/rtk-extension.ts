import * as ChildProcess from "node:child_process"

export interface RtkExtensionOptions {
  model?: string
  disabled?: boolean
}

interface ToolCallEvent {
  toolCall: {
    name: string
    input: { command: string }
  }
}

interface PiExtensionApi {
  addEventListener(event: string, handler: (evt: ToolCallEvent) => void): void
}

export function rewriteCommand(
  toolInput: { command: string },
  command: string,
  model?: string
): void {
  try {
    const args = ["rewrite", command]
    if (model) args.push("--model", model)
    const result = ChildProcess.spawnSync("rtk", args, {
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
  if (options.disabled || process.env.RTK_DISABLED === "1") {
    return () => {}
  }

  const { model } = options

  return (pi: unknown) => {
    const api = pi as PiExtensionApi | null
    if (!api || typeof api.addEventListener !== "function") return

    api.addEventListener("tool_call", (evt: ToolCallEvent) => {
      if (evt.toolCall?.name === "bash") {
        rewriteCommand(evt.toolCall.input, evt.toolCall.input.command, model)
      }
    })
  }
}