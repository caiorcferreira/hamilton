import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createWriteStepOutputTool } from "../../../src/executors/pi/write-step-output-tool.js"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

describe("createWriteStepOutputTool", () => {
  let tmpDir: string
  let originalHome: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-tool-test-"))
    originalHome = process.env.HOME!
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("defines the tool with correct name", () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    expect(tool.name).toBe("write_step_output")
    expect(tool.label).toBe("Write Step Output")
  })

  it("executes successfully with valid JSON input containing status", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: { status: "done", repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect(result.details).toEqual({})
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("returns error when status is empty string", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: { status: "" } }, undefined, undefined, {} as any)
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })

  it("returns error when input is an array", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: [1, 2, 3] as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("returns error when status field is missing", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: { repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })

  it("rejects duplicate calls (write-once)", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    await tool.execute("call-1", { input: { status: "done" } }, undefined, undefined, {} as any)
    const result = await tool.execute("call-2", { input: { status: "done" } }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Output already written")
  })

  it("writes output JSON to the correct file path", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    await tool.execute("call-1", { input: { status: "done", key: "val" } as any }, undefined, undefined, {} as any)

    const outputPath = Path.join(tmpDir, ".hamilton", "runs", "run-1", "step-outputs", "step-1.json")
    const raw = Fs.readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ status: "done", key: "val" })
  })

  it("validates with schema and rejects invalid output", async () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string" },
        count: { type: "number" }
      },
      required: ["status", "count"]
    }
    const tool = createWriteStepOutputTool("run-schema", "step-schema", schema)
    const result = await tool.execute("call-1", { input: { status: "done", count: "not-a-number" } as any }, undefined, undefined, {} as any)

    const text = (result.content[0] as { type: "text"; text: string }).text
    expect(text).toContain("schema validation")
  })

  it("validates with schema and accepts valid output", async () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string" },
        count: { type: "number" }
      },
      required: ["status", "count"]
    }
    const tool = createWriteStepOutputTool("run-valid", "step-valid", schema)
    const result = await tool.execute("call-1", { input: { status: "done", count: 42 } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("skips schema validation when schema is undefined", async () => {
    const tool = createWriteStepOutputTool("run-noschema", "step-noschema")
    const result = await tool.execute("call-1", { input: { status: "done", anyField: "anyValue" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("returns error when input is null", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: null as any }, undefined, undefined, {} as any)
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })
})