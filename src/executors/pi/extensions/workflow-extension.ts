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
  }
}