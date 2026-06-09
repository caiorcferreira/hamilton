import * as Fs from "node:fs"
import { Ajv } from "ajv"
import { stepOutputsDir, stepOutputFile } from "../paths.js"

export interface ValidateResult {
  success: boolean
  error?: string
}

export function validateAndWrite(
  runId: string,
  stepId: string,
  outputSchema: Record<string, unknown> | undefined,
  input: unknown
): ValidateResult {
  const outputPath = stepOutputFile(runId, stepId)

  if (Fs.existsSync(outputPath)) {
    return { success: false, error: "Output already written for this step. write_step_output can only be called once." }
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, error: "Input must be a JSON object (not an array, null, or primitive value)." }
  }

  const obj = input as Record<string, unknown>
  if (typeof obj.status !== "string" || obj.status.length === 0) {
    return { success: false, error: "Missing required field 'status' (must be a non-empty string)." }
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

  const outputsDir = stepOutputsDir(runId)
  Fs.mkdirSync(outputsDir, { recursive: true })
  Fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2))

  return { success: true }
}
