import { defineTool } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { validateAndWrite } from "../../../agent/write-task-output.js"

const paramsSchema = Type.Object({
  input: Type.Object({
    status: Type.String({ description: "Completion state: 'done', 'retry', or 'failed'" })
  }, { additionalProperties: true })
})

export function createWorkflowExtension(
  runId: string,
  taskId: string,
  outputSchema?: Record<string, unknown>,
  onComplete?: () => void
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool(defineTool({
      name: "write_task_output",
      label: "Write Task Output",
      description: "Save your task results. The input must be a JSON object with a 'status' field (string). Call this exactly once when your task is complete. The file is written to the Hamilton run outputs directory.",
      parameters: paramsSchema,
      promptSnippet: "- write_task_output: saves your task results (call once when done, input must be a JSON object with 'status' field)",
      execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
        const result = validateAndWrite(runId, taskId, outputSchema, input)

        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {}
          }
        }

        onComplete?.()

        return {
          content: [{ type: "text" as const, text: "Task output written successfully." }],
          details: {}
        }
      }
    }))

    pi.registerTool(defineTool({
      name: "git_diff",
      label: "Git Diff",
      description: "Show git diff for the working directory. Set staged=true to see staged changes (git diff --cached). Defaults to unstaged changes.",
      parameters: Type.Object({
        staged: Type.Optional(Type.Boolean({ description: "Show staged changes instead of unstaged (default: false)" }))
      }),
      promptSnippet: "- git_diff: shows current git diff (staged or unstaged)",
      execute: async (_toolCallId, { staged }, _signal, _onUpdate, _ctx) => {
        try {
          const args = staged ? ["diff", "--cached"] : ["diff"]
          const proc = Bun.spawnSync(["git", ...args], {
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "pipe"
          })
          const output = new TextDecoder().decode(proc.stdout)
          const errorOutput = new TextDecoder().decode(proc.stderr)

          if (proc.exitCode !== 0 && errorOutput) {
            return {
              content: [{ type: "text" as const, text: `git diff failed: ${errorOutput.trim()}` }],
              details: {}
            }
          }

          return {
            content: [{ type: "text" as const, text: output || "No changes." }],
            details: {}
          }
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: `git diff error: ${String(e)}` }],
            details: {}
          }
        }
      }
    }))
  }
}