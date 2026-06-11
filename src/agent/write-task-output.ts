import * as Fs from "node:fs"
import { taskOutputsDir, taskOutputFile } from "../paths.js"
import { Ajv } from "ajv"

export function validateAndWrite(
  runId: string,
  taskId: string,
  outputSchema: Record<string, unknown> | undefined,
  input: unknown
): { success: true } | { success: false; error: string } {
  const outputPath = taskOutputFile(runId, taskId)
  const outputsDir = taskOutputsDir(runId)

  if (Fs.existsSync(outputPath)) {
    return { success: false, error: "Output already written for this task. write_task_output can only be called once." }
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, error: "Input must be a JSON object (not an array, null, or primitive value)." }
  }

  const obj = input as Record<string, unknown>
  if (typeof obj.status !== "string" || obj.status.length === 0) {
    return { success: false, error: "Missing required field 'status' (must be a non-empty string). Example: { \"status\": \"done\", ... }" }
  }

  if (outputSchema) {
    const ajv = new Ajv({ strict: false })
    const validate = ajv.compile(outputSchema)
    if (!validate(obj)) {
      const errors = validate.errors
        ? validate.errors.map((e) => `${e.instancePath} ${e.message}`).join("; ")
        : "Unknown validation error"
      return { success: false, error: `Output failed schema validation: ${errors}. Please correct your output and try again.` }
    }
  }

  Fs.mkdirSync(outputsDir, { recursive: true })
  Fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2))

  return { success: true }
}
