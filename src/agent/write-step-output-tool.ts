import * as Fs from "node:fs"
import { stepOutputsDir, stepOutputFile } from "../paths.js"
import type { ToolDefinition } from "@earendil-works/pi-coding-agent"
import { defineTool } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { Ajv } from "ajv"

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
  const ajv = outputSchema ? new Ajv({ strict: false }) : null
  const validate = ajv && outputSchema ? ajv.compile(outputSchema) : null

  return defineTool({
    name: "write_step_output",
    label: "Write Step Output",
    description: "Save your step results. The input must be a JSON object with a 'status' field (string). Call this exactly once when your step is complete. The file is written to the Hamilton run outputs directory.",
    parameters: paramsSchema,
    promptSnippet: "- write_step_output: saves your step results (call once when done, input must be a JSON object with 'status' field)",
    execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
      const outputsDir = stepOutputsDir(runId)
      const outputPath = stepOutputFile(runId, stepId)

      if (Fs.existsSync(outputPath)) {
        return {
          content: [textContent("Error: Output already written for this step. write_step_output can only be called once.")],
          details: {}
        }
      }

      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return {
          content: [textContent("Error: Input must be a JSON object (not an array, null, or primitive value).")],
          details: {}
        }
      }

      const obj = input as Record<string, unknown>
      if (typeof obj.status !== "string" || obj.status.length === 0) {
        return {
          content: [textContent("Error: Missing required field 'status' (must be a non-empty string). Example: { \"status\": \"done\", ... }")],
          details: {}
        }
      }

      if (validate && !validate(obj)) {
        const errors = validate.errors
          ? validate.errors.map((e) => `${e.instancePath} ${e.message}`).join("; ")
          : "Unknown validation error"
        return {
          content: [textContent(`Error: Output failed schema validation: ${errors}. Please correct your output and try again.`)],
          details: {}
        }
      }

      Fs.mkdirSync(outputsDir, { recursive: true })
      Fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2))

      cb?.onStepComplete()

      return {
        content: [textContent("Step output written successfully to " + outputPath)],
        details: {}
      }
    }
  })
}