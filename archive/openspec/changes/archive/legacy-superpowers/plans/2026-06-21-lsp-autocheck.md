# LSP Autocheck Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Hamilton Pi extension that runs LSP diagnostics after every `edit`/`write` tool call and augments the tool output with any findings.

**Architecture:** New `lsp-autocheck-extension.ts` in the extensions package imports `loadRuntime`/`runDiagnostics` from `@narumitw/pi-lsp` internals. Uses `pi.on("tool_result")` to augment tool output content post-edit. Integrated into `pi-executor.ts` after `buildExtensions()`, gated by `lsp.parameters.autoCheck` in settings.yaml (defaults to `true`). `ExtensionEntry` gains a generic `parameters` field.

**Tech Stack:** TypeScript, `@narumitw/pi-lsp` 0.1.37, `@earendil-works/pi-coding-agent` 0.78.1, vitest

---

### Task 1: Add `parameters` field to `ExtensionEntry`

**Files:**
- Modify: `src/executors/pi/extensions/extensions.ts:8-11`

- [ ] **Step 1: Add `parameters` field**

```ts
export interface ExtensionEntry {
  name: string
  enabled: boolean
  parameters?: Record<string, unknown>
}
```

- [ ] **Step 2: Write failing test for `parameters` round-trip through YAML**

`tests/executors/pi/extensions.test.ts` — add this test inside the `describe("readExtensionSettings", ...)` block:

```ts
it("parses extensions with parameters field", () => {
  const settings = {
    extensions: [
      { name: "lsp", enabled: true, parameters: { autoCheck: true } }
    ]
  }
  writeSettings(Yaml.stringify(settings))
  const result = readExtensionSettings()
  expect(result.extensions).toEqual([
    { name: "lsp", enabled: true, parameters: { autoCheck: true } }
  ])
})
```

- [ ] **Step 3: Run test to verify**

Run: `bun --bun vitest run tests/executors/pi/extensions.test.ts`
Expected: 5 tests pass (4 existing + 1 new)

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/extensions/extensions.ts tests/executors/pi/extensions.test.ts
git commit -m "feat: add parameters field to ExtensionEntry for per-extension config"
```

---

### Task 2: Create `lsp-autocheck-extension.ts`

**Files:**
- Create: `src/executors/pi/extensions/lsp-autocheck-extension.ts`

- [ ] **Step 1: Write the extension**

```ts
import { loadRuntime } from "@narumitw/pi-lsp/src/adapters.js"
import { resolveRoot } from "@narumitw/pi-lsp/src/files.js"
import { runDiagnostics } from "@narumitw/pi-lsp/src/runner.js"
import type { ExtensionAPI, ToolResultEventResult } from "@earendil-works/pi-coding-agent"

const STATUS_KEY = "lsp-autocheck"

function formatDiagnosticsText(
  result: Awaited<ReturnType<typeof runDiagnostics>>
): string | undefined {
  const text = result.content?.find((c) => c.type === "text")?.text ?? ""
  if (!text || text.includes("no diagnostics")) return undefined
  return text
}

export function createLspAutocheckExtension(): (pi: ExtensionAPI) => void {
  try {
    const { adapters, timeoutMs } = loadRuntime()
    if (adapters.length === 0) return () => {}

    return (pi: ExtensionAPI) => {
      pi.on("tool_result", async (event): Promise<ToolResultEventResult | undefined> => {
        if (event.toolName !== "edit" && event.toolName !== "write") return undefined
        if (event.isError) return undefined

        const filePath = (event.input as Record<string, unknown>).filePath as string | undefined
        if (!filePath) return undefined

        const adapter = adapters.find((a) => a.isSupportedFile(filePath))
        if (!adapter) return undefined

        try {
          const result = await runDiagnostics(
            adapter,
            { root: resolveRoot(), files: [filePath] },
            timeoutMs,
            undefined,
            { ui: { setStatus: () => {} } },
            STATUS_KEY
          )

          const diagnosticsText = formatDiagnosticsText(result)
          if (!diagnosticsText) return undefined

          return {
            content: [
              { type: "text", text: `\n${diagnosticsText}\n` },
              ...event.content
            ]
          }
        } catch {
          return undefined
        }
      })
    }
  } catch {
    return () => {}
  }
}
```

- [ ] **Step 2: Verify module compiles**

Run: `bun run build`
Expected: All modules compile, no errors related to `lsp-autocheck-extension.ts`

- [ ] **Step 3: Commit**

```bash
git add src/executors/pi/extensions/lsp-autocheck-extension.ts
git commit -m "feat: add lsp-autocheck extension for post-edit diagnostics"
```

---

### Task 3: Integrate into `pi-executor.ts`

**Files:**
- Modify: `src/executors/pi/pi-executor.ts:20,115-134`

- [ ] **Step 1: Add import and conditionally push the autocheck extension**

At line 20 (after the existing `createRedactExtension` import), add:

```ts
import { createLspAutocheckExtension } from "./extensions/lsp-autocheck-extension.js"
```

After line 133 (`extensionFactories.push(createRedactExtension())`), add:

```ts
const lspEntry = extSettings.extensions?.find((e) => e.name === "lsp")
if (lspEntry?.parameters?.autoCheck !== false) {
  extensionFactories.push(createLspAutocheckExtension() as ExtensionFactory)
}
```

The full block around lines 115-137 becomes:

```ts
const extSettings = readExtensionSettings()
const extensionFactories = buildExtensions(extSettings)

let sessionRef: typeof session | null = null

if (config.rules && config.rules.length > 0) {
  extensionFactories.push(createGuidelineExtension(config.rules) as ExtensionFactory)
}

extensionFactories.push(
  createWorkflowExtension(
    config.runId,
    config.taskId,
    config.outputSchema,
    () => { sessionRef?.abort().catch(() => {}) }
  )
)

extensionFactories.push(createRedactExtension())

const lspEntry = extSettings.extensions?.find((e) => e.name === "lsp")
if (lspEntry?.parameters?.autoCheck !== false) {
  extensionFactories.push(createLspAutocheckExtension() as ExtensionFactory)
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: Compiles cleanly

- [ ] **Step 3: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "feat: integrate lsp autocheck into pi-executor, gated by lsp.parameters.autoCheck"
```

---

### Task 4: Write tests for the autocheck extension

**Files:**
- Create: `tests/executors/pi/lsp-autocheck-extension.test.ts`

- [ ] **Step 1: Write the test file**

```ts
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
      details: {}
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
      details: {}
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
      details: {}
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
```

- [ ] **Step 2: Run tests**

Run: `bun --bun vitest run tests/executors/pi/lsp-autocheck-extension.test.ts`
Expected: 9 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/executors/pi/lsp-autocheck-extension.test.ts
git commit -m "test: add lsp-autocheck extension tests"
```

---

### Task 5: Run full test suite and final verification

- [ ] **Step 1: Run full test suite**

Run: `bun --bun vitest run`
Expected: All existing tests pass, new tests pass, no regressions

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: Clean compile, no errors

- [ ] **Step 3: Commit any final changes**

```bash
git status
```
If clean, no commit needed. If any fixup changes, commit with appropriate message.
