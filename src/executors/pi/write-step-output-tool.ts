import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { validateAndWrite } from "../../agent/write-step-output.js"

const paramsSchema = Type.Object({
  input: Type.Object({
    status: Type.String({ description: "Completion state: 'done', 'retry', or 'failed'" })
  }, { additionalProperties: true })
})

function textContent(text: string): { type: "text"; text: string } {
  return { type: "text", text }
}

export interface StepCompleteCallback {
  onStepComplete: () => void
}

export function createWriteStepOutputTool(
  runId: string,
  stepId: string,
  outputSchema?: Record<string, unknown>,
  cb?: StepCompleteCallback
): ToolDefinition<typeof paramsSchema> {
  return defineTool({
    name: "write_step_output",
    label: "Write Step Output",
    description: "Save your step results. The input must be a JSON object with a 'status' field (string). Call this exactly once when your step is complete. The file is written to the Hamilton run outputs directory.",
    parameters: paramsSchema,
    promptSnippet: "- write_step_output: saves your step results (call once when done, input must be a JSON object with 'status' field)",
    execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
      const result = validateAndWrite(runId, stepId, outputSchema, input)

      if (!result.success) {
        return {
          content: [textContent(`Error: ${result.error}`)],
          details: {}
        }
      }

      cb?.onStepComplete()

      return {
        content: [textContent("Step output written successfully.")],
        details: {}
      }
    }
  })
}
