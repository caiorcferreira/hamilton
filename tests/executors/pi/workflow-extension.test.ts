import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createWorkflowExtension } from "../../../src/executors/pi/extensions/workflow-extension.js"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

describe("createWorkflowExtension", () => {
  let tmpDir: string
  let originalHome: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-wfext-test-"))
    originalHome = process.env.HOME!
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("registers the write_step_output tool on pi", () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "write_step_output",
      label: "Write Step Output"
    }))
  })

  it("tool execute writes output and returns success", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "done", repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect(result.details).toEqual({})
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("tool execute returns error when status is missing", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })

  it("tool execute returns error when input is an array", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: [1, 2, 3] as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("tool execute returns error when input is null", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: null as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("tool execute writes output JSON to the correct file path", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    await toolDef.execute("call-1", { input: { status: "done", key: "val" } as any }, undefined, undefined, {} as any)

    const outputPath = Path.join(tmpDir, ".hamilton", "runs", "run-1", "step-outputs", "step-1.json")
    const raw = Fs.readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ status: "done", key: "val" })
  })

  it("tool execute rejects duplicate calls (write-once)", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    await toolDef.execute("call-1", { input: { status: "done" } }, undefined, undefined, {} as any)
    const result = await toolDef.execute("call-2", { input: { status: "done" } }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Output already written")
  })

  it("tool execute validates with schema and rejects invalid output", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const schema = {
      type: "object",
      properties: { status: { type: "string" }, count: { type: "number" } },
      required: ["status", "count"]
    }
    const ext = createWorkflowExtension("run-schema", "step-schema", schema)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "done", count: "not-a-number" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("schema validation")
  })

  it("tool execute validates with schema and accepts valid output", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const schema = {
      type: "object",
      properties: { status: { type: "string" }, count: { type: "number" } },
      required: ["status", "count"]
    }
    const ext = createWorkflowExtension("run-valid", "step-valid", schema)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "done", count: 42 } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("tool execute skips schema validation when schema is undefined", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-noschema", "step-noschema")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "done", anyField: "anyValue" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("calls onComplete callback on successful write", async () => {
    const registerTool = vi.fn()
    const onComplete = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1", undefined, onComplete)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    await toolDef.execute("call-1", { input: { status: "done" } }, undefined, undefined, {} as any)

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("does not call onComplete on failed write", async () => {
    const registerTool = vi.fn()
    const onComplete = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1", undefined, onComplete)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "" } }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
    expect(onComplete).not.toHaveBeenCalled()
  })
})