import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createWorkflowExtension, validateTodoList } from "../../../src/executors/pi/extensions/workflow-extension.js"
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

  it("registers the write_task_output tool on pi", () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "write_task_output",
      label: "Write Task Output"
    }))
  })

  it("tool execute writes output and returns success", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "done", repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect(result.details).toEqual({})
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Task output written successfully")
  })

  it("tool execute returns error when status is missing", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })

  it("tool execute returns error when input is an array", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: [1, 2, 3] as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("tool execute returns error when input is null", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: null as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("tool execute writes output JSON to the correct file path", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    await toolDef.execute("call-1", { input: { status: "done", key: "val" } as any }, undefined, undefined, {} as any)

    const outputPath = Path.join(tmpDir, ".hamilton", "runs", "run-1", "task-outputs", "task-1.json")
    const raw = Fs.readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ status: "done", key: "val" })
  })

  it("tool execute rejects duplicate calls (write-once)", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
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
    const ext = createWorkflowExtension("run-schema", "task-schema", schema)
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
    const ext = createWorkflowExtension("run-valid", "task-valid", schema)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "done", count: 42 } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Task output written successfully")
  })

  it("tool execute skips schema validation when schema is undefined", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-noschema", "task-noschema")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "done", anyField: "anyValue" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Task output written successfully")
  })

  it("calls onComplete callback on successful write", async () => {
    const registerTool = vi.fn()
    const onComplete = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1", undefined, onComplete)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    await toolDef.execute("call-1", { input: { status: "done" } }, undefined, undefined, {} as any)

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("does not call onComplete on failed write", async () => {
    const registerTool = vi.fn()
    const onComplete = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1", undefined, onComplete)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { input: { status: "" } }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("registers the git_diff tool on pi", () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const registeredNames = registerTool.mock.calls.map((c: any) => c[0].name)
    expect(registeredNames).toContain("git_diff")
  })

  it("git_diff tool returns unstaged diff output when staged=false", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls.find((c: any) => c[0].name === "git_diff")[0]
    const result = await toolDef.execute("call-1", { staged: false }, undefined, undefined, {} as any)

    expect(result.content[0].type).toBe("text")
    expect(typeof (result.content[0] as { type: "text"; text: string }).text).toBe("string")
  })

  it("git_diff tool returns staged diff when staged=true", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls.find((c: any) => c[0].name === "git_diff")[0]
    const result = await toolDef.execute("call-1", { staged: true }, undefined, undefined, {} as any)

    expect(result.content[0].type).toBe("text")
  })
})

describe("validateTodoList", () => {
  it("accepts a valid list with one in_progress", () => {
    const result = validateTodoList([
      { content: "write tests", status: "completed", priority: "high" },
      { content: "implement feature", status: "in_progress", priority: "high" },
      { content: "run build", status: "pending", priority: "medium" }
    ])
    expect(result).toEqual({ valid: true })
  })

  it("accepts an empty array", () => {
    const result = validateTodoList([])
    expect(result).toEqual({ valid: true })
  })

  it("accepts all items completed", () => {
    const result = validateTodoList([
      { content: "write tests", status: "completed", priority: "high" },
      { content: "implement feature", status: "completed", priority: "high" }
    ])
    expect(result).toEqual({ valid: true })
  })

  it("accepts all items cancelled", () => {
    const result = validateTodoList([
      { content: "write tests", status: "cancelled", priority: "low" }
    ])
    expect(result).toEqual({ valid: true })
  })

  it("rejects non-array input", () => {
    expect(validateTodoList(null)).toEqual({ valid: false, error: "Input must be an array of todo items" })
    expect(validateTodoList("string")).toEqual({ valid: false, error: "Input must be an array of todo items" })
    expect(validateTodoList({})).toEqual({ valid: false, error: "Input must be an array of todo items" })
  })

  it("rejects items with null/primitive elements", () => {
    const result = validateTodoList([null])
    expect(result.valid).toBe(false)
    expect(result.error).toContain("ach todo item must be an object")
  })

  it("rejects items with missing fields", () => {
    const result = validateTodoList([{ status: "pending" }])
    expect(result.valid).toBe(false)
    expect(result.error).toContain("content")
  })

  it("rejects items with empty content", () => {
    const result = validateTodoList([{ content: "", status: "pending", priority: "high" }])
    expect(result.valid).toBe(false)
    expect(result.error).toContain("content")
  })

  it("rejects items with invalid status", () => {
    const result = validateTodoList([{ content: "do thing", status: "started", priority: "high" }])
    expect(result.valid).toBe(false)
    expect(result.error).toContain("status")
    expect(result.error).toContain("pending, in_progress, completed, cancelled")
  })

  it("rejects items with invalid priority", () => {
    const result = validateTodoList([{ content: "do thing", status: "pending", priority: "critical" }])
    expect(result.valid).toBe(false)
    expect(result.error).toContain("priority")
    expect(result.error).toContain("high, medium, low")
  })

  it("rejects more than one in_progress", () => {
    const result = validateTodoList([
      { content: "task a", status: "in_progress", priority: "high" },
      { content: "task b", status: "in_progress", priority: "high" }
    ])
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Expected exactly 1 in_progress item, found 2")
  })

  it("rejects zero in_progress when pending items exist", () => {
    const result = validateTodoList([
      { content: "task a", status: "pending", priority: "high" },
      { content: "task b", status: "completed", priority: "high" }
    ])
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Either set one item to in_progress or mark all items as completed/cancelled")
  })
})