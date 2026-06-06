import * as Fs from "node:fs"
import { stepOutputsDir, stepOutputFile } from "../paths.js"
import type { ToolDefinition } from "@earendil-works/pi-coding-agent"
import { defineTool } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

const paramsSchema = Type.Object({
  input: Type.String({ description: "JSON string with your results. Must be an object with a 'status' field." })
})

function textContent(text: string): { type: "text"; text: string } {
  return { type: "text", text }
}

export function createWriteStepOutputTool(runId: string, stepId: string): ToolDefinition<typeof paramsSchema> {
  return defineTool({
    name: "write_step_output",
    label: "Write Step Output",
    description: "Save your step results as JSON. The input must be a valid JSON object with a 'status' field (string). Call this exactly once when your step is complete. The file is written to the Hamilton run outputs directory.",
    parameters: paramsSchema,
    promptSnippet: "- write_step_output: saves your step results as JSON (call once when done, input must be valid JSON with 'status' field)",
    execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
      const outputsDir = stepOutputsDir(runId)
      const outputPath = stepOutputFile(runId, stepId)

      if (Fs.existsSync(outputPath)) {
        return {
          content: [textContent("Error: Output already written for this step. write_step_output can only be called once.")],
          details: {}
        }
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(input)
      } catch {
        return {
          content: [textContent("Error: Invalid JSON input. Please provide a valid JSON string.")],
          details: {}
        }
      }

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
          content: [textContent("Error: Input must be a JSON object (not an array, null, or primitive value).")],
          details: {}
        }
      }

      const obj = parsed as Record<string, unknown>
      if (typeof obj.status !== "string") {
        return {
          content: [textContent("Error: Missing required field 'status' (must be a string). Example: { \"status\": \"done\", ... }")],
          details: {}
        }
      }

      Fs.mkdirSync(outputsDir, { recursive: true })
      Fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2))

      return {
        content: [textContent("Step output written successfully to " + outputPath)],
        details: {}
      }
    }
  })
}