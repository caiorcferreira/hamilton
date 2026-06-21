import { describe, it, expect, vi } from "vitest"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

vi.mock("@narumitw/pi-lsp/src/adapters.js", () => ({
  loadRuntime: vi.fn()
}))

vi.mock("@narumitw/pi-lsp/src/files.js", () => ({
  resolveRoot: vi.fn(() => "/fake/root")
}))

vi.mock("@narumitw/pi-lsp/src/runner.js", () => ({
  runDiagnostics: vi.fn()
}))

import { createLspAutocheckExtension } from "../../../src/executors/pi/extensions/lsp-autocheck-extension.js"
import { loadRuntime } from "@narumitw/pi-lsp/src/adapters.js"
import { runDiagnostics } from "@narumitw/pi-lsp/src/runner.js"

function makeAdapter(overrides: Partial<any> = {}) {
  return {
    name: "biome",
    defaultCommand: { command: "biome", args: ["lsp-proxy"] },
    commandEnvVar: "PI_BIOME_LSP_COMMAND",
    missingCommandHint: "Install biome",
    extensions: [".ts", ".tsx"],
    env: undefined,
    initialization: undefined,
    skipDirectories: new Set(["node_modules"]),
    isSupportedFile: (p: string) => p.endsWith(".ts") || p.endsWith(".tsx"),
    languageIdFor: () => "typescript",
    ...overrides
  }
}

function makePi(): { api: Record<string, any>; getHandler: (event: string) => Function } {
  const handlers: Record<string, Function> = {}
  const api = {
    on: (event: string, handler: Function) => { handlers[event] = handler }
  }
  return { api, getHandler: (event: string) => handlers[event]! }
}

describe("createLspAutocheckExtension", () => {
  it("returns a no-op factory when no adapters are configured", () => {
    vi.mocked(loadRuntime).mockReturnValue({ adapters: [], timeoutMs: 20000 })
    const ext = createLspAutocheckExtension()
    const pi: any = { on: vi.fn() }
    ext(pi)
    expect(pi.on).not.toHaveBeenCalled()
  })

  it("returns a no-op when loadRuntime throws", () => {
    vi.mocked(loadRuntime).mockImplementation(() => { throw new Error("no config") })
    const ext = createLspAutocheckExtension()
    const pi: any = { on: vi.fn() }
    ext(pi)
    expect(pi.on).not.toHaveBeenCalled()
  })

  it("registers a tool_result listener when adapters are present", () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)
    expect(getHandler("tool_result")).toBeDefined()
  })

  it("returns undefined for non-edit/write tools", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "read",
      toolCallId: "1",
      input: { filePath: "/ws/src/foo.ts" },
      content: [{ type: "text", text: "ok" }],
      details: undefined,
      isError: false
    })

    expect(result).toBeUndefined()
  })

  it("returns undefined when isError is true", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "edit",
      toolCallId: "1",
      input: { filePath: "/ws/src/foo.ts" },
      content: [{ type: "text", text: "error" }],
      details: undefined,
      isError: true
    })

    expect(result).toBeUndefined()
  })

  it("returns undefined when filePath is missing from input", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "edit",
      toolCallId: "1",
      input: {},
      content: [{ type: "text", text: "ok" }],
      details: undefined,
      isError: false
    })

    expect(result).toBeUndefined()
  })

  it("returns undefined when no adapter supports the file", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter({ isSupportedFile: () => false })],
      timeoutMs: 20000
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "edit",
      toolCallId: "1",
      input: { filePath: "/ws/src/foo.py" },
      content: [{ type: "text", text: "ok" }],
      details: undefined,
      isError: false
    })

    expect(result).toBeUndefined()
  })

  it("augments content with diagnostics when LSP finds issues", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    vi.mocked(runDiagnostics).mockResolvedValue({
      content: [{ type: "text", text: "biome LSP diagnostics: 1 diagnostic(s) across 1 file(s).\n\nfoo.ts:1:5: error biome: unused variable" }],
      details: { summary: { files: 1, diagnostics: 1 } }
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "edit",
      toolCallId: "1",
      input: { filePath: "/ws/src/foo.ts" },
      content: [{ type: "text", text: "edit success" }],
      details: undefined,
      isError: false
    })

    expect(result).toEqual({
      content: [
        { type: "text", text: "\nbiome LSP diagnostics: 1 diagnostic(s) across 1 file(s).\n\nfoo.ts:1:5: error biome: unused variable\n" },
        { type: "text", text: "edit success" }
      ]
    })
  })

  it("returns undefined when LSP finds no diagnostics", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    vi.mocked(runDiagnostics).mockResolvedValue({
      content: [{ type: "text", text: "biome LSP diagnostics: 0 diagnostic(s) across 1 file(s).\n\nfoo.ts: no diagnostics" }],
      details: { summary: { files: 1, diagnostics: 0 } }
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "edit",
      toolCallId: "1",
      input: { filePath: "/ws/src/foo.ts" },
      content: [{ type: "text", text: "edit success" }],
      details: undefined,
      isError: false
    })

    expect(result).toBeUndefined()
  })

  it("returns undefined when runDiagnostics throws", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    vi.mocked(runDiagnostics).mockRejectedValue(new Error("LSP crashed"))
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "edit",
      toolCallId: "1",
      input: { filePath: "/ws/src/foo.ts" },
      content: [{ type: "text", text: "edit success" }],
      details: undefined,
      isError: false
    })

    expect(result).toBeUndefined()
  })

  it("handles write tool calls", async () => {
    vi.mocked(loadRuntime).mockReturnValue({
      adapters: [makeAdapter()],
      timeoutMs: 20000
    })
    vi.mocked(runDiagnostics).mockResolvedValue({
      content: [{ type: "text", text: "biome LSP diagnostics: 1 diagnostic(s) across 1 file(s).\n\nfoo.ts:2:10: warning biome: unused import" }],
      details: { summary: { files: 1, diagnostics: 1 } }
    })
    const { api, getHandler } = makePi()
    const ext = createLspAutocheckExtension()
    ext(api as unknown as ExtensionAPI)

    const result = await getHandler("tool_result")({
      toolName: "write",
      toolCallId: "1",
      input: { filePath: "/ws/src/foo.ts" },
      content: [{ type: "text", text: "wrote 100 bytes" }],
      details: undefined,
      isError: false
    })

    expect(result).toEqual({
      content: [
        { type: "text", text: "\nbiome LSP diagnostics: 1 diagnostic(s) across 1 file(s).\n\nfoo.ts:2:10: warning biome: unused import\n" },
        { type: "text", text: "wrote 100 bytes" }
      ]
    })
  })
})
