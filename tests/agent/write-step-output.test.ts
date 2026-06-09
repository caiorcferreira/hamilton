import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { validateAndWrite } from "../../src/agent/write-step-output.js"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

describe("validateAndWrite", () => {
  let tmpDir: string
  let originalHome: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-validate-"))
    originalHome = process.env.HOME!
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("writes output JSON to file and returns success", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, { status: "done", key: "val" })
    expect(result.success).toBe(true)

    const outputPath = Path.join(tmpDir, ".hamilton", "runs", "run-1", "step-outputs", "step-1.json")
    const raw = Fs.readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ status: "done", key: "val" })
  })

  it("returns error on duplicate write", () => {
    validateAndWrite("run-1", "step-1", undefined, { status: "done" })
    const result = validateAndWrite("run-1", "step-1", undefined, { status: "done" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("already written")
    }
  })

  it("returns error when input is an array", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, [1, 2, 3])
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("JSON object")
    }
  })

  it("returns error when input is null", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, null)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("JSON object")
    }
  })

  it("returns error when status field is missing", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, { repo: "hamilton" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("Missing required field 'status'")
    }
  })

  it("returns error when status is empty", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, { status: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("Missing required field 'status'")
    }
  })

  it("validates with schema and rejects invalid output", () => {
    const schema = {
      type: "object",
      properties: { status: { type: "string" }, count: { type: "number" } },
      required: ["status", "count"]
    }
    const result = validateAndWrite("run-1", "step-1", schema, { status: "done", count: "not-a-number" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("schema validation")
    }
  })

  it("validates with schema and accepts valid output", () => {
    const schema = {
      type: "object",
      properties: { status: { type: "string" }, count: { type: "number" } },
      required: ["status", "count"]
    }
    const result = validateAndWrite("run-1", "step-1", schema, { status: "done", count: 42 })
    expect(result.success).toBe(true)
  })

  it("skips schema validation when schema is undefined", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, { status: "done", anyField: "anyValue" })
    expect(result.success).toBe(true)
  })
})
