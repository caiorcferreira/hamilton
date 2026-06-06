import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createWriteStepOutputTool } from "../../src/agent/write-step-output-tool.js"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

describe("createWriteStepOutputTool", () => {
  let tmpDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-tool-test-"))
    originalEnv = { ...process.env }
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env = originalEnv
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("defines the tool with correct name", () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    expect(tool.name).toBe("write_step_output")
    expect(tool.label).toBe("Write Step Output")
  })

  it("executes successfully with valid JSON input containing status", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: '{"status":"done","repo":"hamilton"}' }, undefined, undefined, {} as any)

    expect(result.details).toEqual({})
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("returns error when input is not valid JSON", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: "not json" }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Invalid JSON")
  })

  it("returns error when input is not an object", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: "[1,2,3]" }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("returns error when input is null", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: "null" }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("returns error when status field is missing", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: '{"repo":"hamilton"}' }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })

  it("returns error when status field is not a string", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: '{"status":42}' }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })

  it("rejects duplicate calls (write-once)", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    await tool.execute("call-1", { input: '{"status":"done"}' }, undefined, undefined, {} as any)
    const result = await tool.execute("call-2", { input: '{"status":"done"}' }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Output already written")
  })

  it("writes output JSON to the correct file path", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    await tool.execute("call-1", { input: '{"status":"done","key":"val"}' }, undefined, undefined, {} as any)

    const outputPath = Path.join(tmpDir, ".hamilton", "runs", "run-1", "step-outputs", "step-1.json")
    const raw = Fs.readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ status: "done", key: "val" })
  })
})