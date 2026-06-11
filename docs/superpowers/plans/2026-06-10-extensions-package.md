# Extensions Package + Workflow Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Pi extensions into a `src/executors/pi/extensions/` package, refactor all extensions to use the `ExtensionAPI` pattern from `@earendil-works/pi-coding-agent`, and implement a new workflow extension that provides `write_step_output` via `pi.registerTool`.

**Architecture:** Each extension exports a factory function that returns `(pi: ExtensionAPI) => void`. The RTK and guideline extensions intercept tool calls via `pi.on("tool_call")`. The workflow extension registers a custom tool via `pi.registerTool`. All are composed by `buildExtensions()` in `extensions.ts` and wired by `pi-executor.ts`.

**Tech Stack:** TypeScript, bun, Effect-TS, `@earendil-works/pi-coding-agent`, typebox, vitest

---

### Task 1: Create package directory structure

**Files:**
- Create: `src/executors/pi/extensions/`

- [ ] **Step 1: Create the extensions package directory**

```bash
mkdir -p src/executors/pi/extensions
```

- [ ] **Step 2: Commit**

```bash
git add src/executors/pi/extensions/
git commit -m "chore: create extensions package directory"
```

---

### Task 2: Move and refactor extensions.ts (registry)

**Files:**
- Create: `src/executors/pi/extensions/extensions.ts`
- Modify: `tests/executors/pi/extensions.test.ts`
- (Old file deleted in Task 7)

- [ ] **Step 1: Write the updated test**

Update `tests/executors/pi/extensions.test.ts` import path. The logic is unchanged — only the import path and `ExtensionFactory` type matter.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import * as Yaml from "yaml"
import { readExtensionSettings, buildExtensions } from "../../../src/executors/pi/extensions/extensions.js"
import { settingsPath } from "../../../src/paths.js"

let tmpHome: string
let origHome: string | undefined

beforeEach(() => {
  origHome = process.env.HOME
  tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-ext-test-"))
  process.env.HOME = tmpHome
})

afterEach(() => {
  process.env.HOME = origHome
  Fs.rmSync(tmpHome, { recursive: true, force: true })
})

function writeSettings(content: string): void {
  const dir = Path.dirname(settingsPath())
  Fs.mkdirSync(dir, { recursive: true })
  Fs.writeFileSync(settingsPath(), content, "utf-8")
}

describe("readExtensionSettings", () => {
  it("returns empty object when settings.yaml does not exist", () => {
    const result = readExtensionSettings()
    expect(result).toEqual({})
  })

  it("parses valid settings.yaml", () => {
    const settings = { extensions: [{ name: "rtk", enabled: true }] }
    writeSettings(Yaml.stringify(settings))
    const result = readExtensionSettings()
    expect(result.extensions).toEqual([{ name: "rtk", enabled: true }])
  })

  it("returns empty object for invalid YAML", () => {
    writeSettings(": : invalid: [")
    const result = readExtensionSettings()
    expect(result).toEqual({})
  })

  it("returns empty object when file exists but has no extensions key", () => {
    const settings = { other: true }
    writeSettings(Yaml.stringify(settings))
    const result = readExtensionSettings()
    expect(result).toEqual({ other: true })
    expect(result.extensions).toBeUndefined()
  })
})

describe("buildExtensions", () => {
  it("returns empty array for empty settings", () => {
    const result = buildExtensions({})
    expect(result).toEqual([])
  })

  it("includes enabled extensions", () => {
    const result = buildExtensions({
      extensions: [{ name: "rtk", enabled: true }]
    })
    expect(result).toHaveLength(1)
    expect(typeof result[0]).toBe("function")
  })

  it("excludes disabled extensions", () => {
    const result = buildExtensions({
      extensions: [{ name: "rtk", enabled: false }]
    })
    expect(result).toHaveLength(0)
  })

  it("includes both when both enabled", () => {
    const result = buildExtensions({
      extensions: [
        { name: "rtk", enabled: true },
        { name: "lsp", enabled: true }
      ]
    })
    expect(result).toHaveLength(2)
    expect(typeof result[0]).toBe("function")
    expect(typeof result[1]).toBe("function")
  })

  it("skips unknown extension names", () => {
    const result = buildExtensions({
      extensions: [{ name: "unknown", enabled: true }]
    })
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails (imports broken — old file not yet moved)**

```bash
bun --bun vitest run tests/executors/pi/extensions.test.ts
```

Expected: FAIL — cannot find module `../../../src/executors/pi/extensions/extensions.js`

- [ ] **Step 3: Create the new extensions.ts in the package**

Create `src/executors/pi/extensions/extensions.ts`. Same logic as current flat file, but `ExtensionFactory` type narrows to `(pi: ExtensionAPI) => void`:

```typescript
import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../../../paths.js"
import { createRtkExtension } from "./rtk-extension.js"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import lsp from "@narumitw/pi-lsp"

export interface ExtensionEntry {
  name: string
  enabled: boolean
}

export interface ExtensionSettings {
  extensions?: ExtensionEntry[]
}

export function readExtensionSettings(): ExtensionSettings {
  try {
    const path = settingsPath()
    if (!Fs.existsSync(path)) return {}
    const raw = Fs.readFileSync(path, "utf-8")
    const parsed = Yaml.parse(raw) as ExtensionSettings
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
}

export type ExtensionFactory = (pi: ExtensionAPI) => void

export function buildExtensions(
  settings: ExtensionSettings
): ExtensionFactory[] {
  const entries = settings.extensions ?? []
  const factories: ExtensionFactory[] = []

  for (const entry of entries) {
    if (entry.enabled === false) continue

    switch (entry.name) {
      case "rtk":
        factories.push(createRtkExtension({ disabled: false }) as ExtensionFactory)
        break
      case "lsp":
        factories.push(lsp as ExtensionFactory)
        break
    }
  }

  return factories
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/executors/pi/extensions.test.ts
```

Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/pi/extensions/extensions.ts tests/executors/pi/extensions.test.ts
git commit -m "feat: move extensions registry into extensions package, narrow ExtensionFactory type"
```

---

### Task 3: Move and refactor rtk-extension.ts

**Files:**
- Create: `src/executors/pi/extensions/rtk-extension.ts`
- Modify: `tests/executors/pi/rtk-extension.test.ts`
- (Old file deleted in Task 7)

- [ ] **Step 1: Write the refactored test**

Update `tests/executors/pi/rtk-extension.test.ts` to use the `pi.on("tool_call")` pattern with `ExtensionAPI`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRtkExtension } from "../../../src/executors/pi/extensions/rtk-extension.js"
import * as ChildProcess from "node:child_process"

vi.mock("node:child_process")

describe("createRtkExtension", () => {
  it("returns a function (the extension factory)", () => {
    const factory = createRtkExtension({})
    expect(typeof factory).toBe("function")
  })

  it("returns no-op when disabled", () => {
    const factory = createRtkExtension({ disabled: true })
    const mockPi = { on: vi.fn() }
    factory(mockPi as any)
    expect(mockPi.on).not.toHaveBeenCalled()
  })

  describe("when enabled", () => {
    let handler: Function
    let mockPi: { on: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      handler = () => {}
      mockPi = {
        on: vi.fn((event: string, h: Function) => { handler = h })
      }
      vi.mocked(ChildProcess.spawnSync).mockReturnValue({
        status: 0,
        stdout: "",
        stderr: "",
        output: [],
        pid: 1,
        signal: null
      } as any)
    })

    it("registers a tool_call listener", () => {
      const factory = createRtkExtension({})
      factory(mockPi as any)
      expect(mockPi.on).toHaveBeenCalledWith("tool_call", expect.any(Function))
    })

    it("does nothing for non-bash tool calls", () => {
      const factory = createRtkExtension({})
      factory(mockPi as any)

      const event = { toolName: "read", input: { path: "foo.txt" } }
      handler(event)

      expect(ChildProcess.spawnSync).not.toHaveBeenCalled()
    })

    it("calls rewriteCommand for bash tool calls", () => {
      const factory = createRtkExtension({})
      factory(mockPi as any)

      const command = "npm install"
      const event = { toolName: "bash", input: { command } }
      handler(event)

      expect(ChildProcess.spawnSync).toHaveBeenCalledWith("rtk", ["rewrite", command], expect.any(Object))
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/executors/pi/rtk-extension.test.ts
```

Expected: FAIL — cannot find module `../../../src/executors/pi/extensions/rtk-extension.js`

- [ ] **Step 3: Create the refactored rtk-extension.ts**

Create `src/executors/pi/extensions/rtk-extension.ts`:

```typescript
import * as ChildProcess from "node:child_process"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export interface RtkExtensionOptions {
  disabled?: boolean
}

export function rewriteCommand(
  toolInput: { command: string },
  command: string
): void {
  try {
    const result = ChildProcess.spawnSync("rtk", ["rewrite", command], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000
    })
    if ((result.status === 0 || result.status === 3) && result.stdout !== command) {
      toolInput.command = result.stdout
    }
  } catch { }
}

export function createRtkExtension(options?: RtkExtensionOptions): (pi: ExtensionAPI) => void {
  if (options?.disabled) {
    return () => { }
  }

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event) => {
      if (event.toolName === "bash") {
        const command = (event.input as Record<string, unknown>).command as string | undefined
        if (command) rewriteCommand(event.input as { command: string }, command)
      }
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/executors/pi/rtk-extension.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/pi/extensions/rtk-extension.ts tests/executors/pi/rtk-extension.test.ts
git commit -m "feat: refactor RTK extension to ExtensionAPI pi.on pattern"
```

---

### Task 4: Move and refactor guideline-extension.ts

**Files:**
- Create: `src/executors/pi/extensions/guideline-extension.ts`
- Modify: `tests/executors/pi/guideline-extension.test.ts`
- (Old file deleted in Task 7)

- [ ] **Step 1: Write the refactored test**

Update `tests/executors/pi/guideline-extension.test.ts` to use the `pi.on("tool_call")` pattern returning `{ block: true, reason }`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { createGuidelineExtension } from "../../../src/executors/pi/extensions/guideline-extension.js"
import type { CompiledRule } from "../../../src/guidelines/types.js"

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    name: "no-npm",
    toolNames: ["bash"],
    target: "command",
    pattern: "^npm",
    reason: "Use pnpm.",
    compiledPattern: new RegExp(overrides.pattern ?? "^npm"),
    ...overrides
  }
}

describe("createGuidelineExtension", () => {
  it("returns a no-op factory when rules array is empty", () => {
    const ext = createGuidelineExtension([])
    const api = { on: vi.fn() }
    ext(api as any)
    expect(api.on).not.toHaveBeenCalled()
  })

  it("registers a tool_call listener when rules are present", () => {
    const ext = createGuidelineExtension([makeRule()])
    const api = { on: vi.fn() }
    ext(api as any)
    expect(api.on).toHaveBeenCalledWith("tool_call", expect.any(Function))
  })

  it("blocks tool call and returns reason when rule matches", async () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "bash",
      input: { command: "npm install" }
    }

    const result = await handler(evt)

    expect(result).toEqual({ block: true, reason: "Use pnpm." })
  })

  it("returns undefined when no rule matches", async () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "bash",
      input: { command: "pnpm install" }
    }

    const result = await handler(evt)

    expect(result).toBeUndefined()
  })

  it("returns undefined when tool does not match any rule toolNames", async () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "read",
      input: { path: "/tmp/x" }
    }

    const result = await handler(evt)

    expect(result).toBeUndefined()
  })

  it("joins multiple reasons when multiple rules match", async () => {
    const rules: CompiledRule[] = [
      makeRule(),
      { ...makeRule(), name: "no-npm-exec", compiledPattern: new RegExp("^npm "), reason: "Use pnpm dlx." }
    ]
    const ext = createGuidelineExtension(rules)
    let handler: Function = () => {}
    const api = {
      on: (_evt: string, h: Function) => { handler = h }
    }
    ext(api as any)

    const evt = {
      toolName: "bash",
      input: { command: "npm exec tsc" }
    }

    const result = await handler(evt)

    expect(result).toEqual({ block: true, reason: "Use pnpm.\nUse pnpm dlx." })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/executors/pi/guideline-extension.test.ts
```

Expected: FAIL — cannot find module `../../../src/executors/pi/extensions/guideline-extension.js`

- [ ] **Step 3: Create the refactored guideline-extension.ts**

Create `src/executors/pi/extensions/guideline-extension.ts`:

```typescript
import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent"
import { evaluateToolCall } from "../../../guidelines/rule-engine.js"
import type { CompiledRule } from "../../../guidelines/types.js"

export function createGuidelineExtension(
  rules: CompiledRule[]
): (pi: ExtensionAPI) => void {
  if (rules.length === 0) {
    return () => { }
  }

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
      const matches = evaluateToolCall(
        rules,
        event.toolName,
        (event.input as Record<string, unknown> | undefined) ?? {}
      )

      if (matches.length === 0) return undefined

      return { block: true, reason: matches.map(m => m.reason).join("\n") }
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/executors/pi/guideline-extension.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/pi/extensions/guideline-extension.ts tests/executors/pi/guideline-extension.test.ts
git commit -m "feat: refactor guideline extension to ExtensionAPI pi.on pattern with { block, reason } return"
```

---

### Task 5: Create workflow-extension.ts (new write_step_output extension)

**Files:**
- Create: `src/executors/pi/extensions/workflow-extension.ts`
- Modify: `tests/executors/pi/write-step-output-tool.test.ts` → renamed to `tests/executors/pi/workflow-extension.test.ts`
- (Old `write-step-output-tool.ts` deleted in Task 7)

- [ ] **Step 1: Write the test for the workflow extension**

Create `tests/executors/pi/workflow-extension.test.ts`:

```typescript
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

    expect(registerTool).toHaveBeenCalledWith("write_step_output", expect.objectContaining({
      label: "Write Step Output",
      name: undefined
    }))
  })

  it("tool execute writes output and returns success", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
    const result = await toolDef.execute("call-1", { input: { status: "done", repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect(result.details).toEqual({})
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("tool execute returns error when status is missing", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
    const result = await toolDef.execute("call-1", { input: { repo: "hamilton" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })

  it("tool execute returns error when input is an array", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
    const result = await toolDef.execute("call-1", { input: [1, 2, 3] as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("tool execute returns error when input is null", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
    const result = await toolDef.execute("call-1", { input: null as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })

  it("tool execute writes output JSON to the correct file path", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
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

    const toolDef = registerTool.mock.calls[0][1]
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

    const toolDef = registerTool.mock.calls[0][1]
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

    const toolDef = registerTool.mock.calls[0][1]
    const result = await toolDef.execute("call-1", { input: { status: "done", count: 42 } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("tool execute skips schema validation when schema is undefined", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-noschema", "step-noschema")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
    const result = await toolDef.execute("call-1", { input: { status: "done", anyField: "anyValue" } as any }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Step output written successfully")
  })

  it("calls onComplete callback on successful write", async () => {
    const registerTool = vi.fn()
    const onComplete = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1", undefined, onComplete)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
    await toolDef.execute("call-1", { input: { status: "done" } }, undefined, undefined, {} as any)

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("does not call onComplete on failed write", async () => {
    const registerTool = vi.fn()
    const onComplete = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "step-1", undefined, onComplete)
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][1]
    const result = await toolDef.execute("call-1", { input: { status: "" } }, undefined, undefined, {} as any)

    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
    expect(onComplete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/executors/pi/workflow-extension.test.ts
```

Expected: FAIL — cannot find module `../../../src/executors/pi/extensions/workflow-extension.js`

- [ ] **Step 3: Create the workflow-extension.ts**

Create `src/executors/pi/extensions/workflow-extension.ts`:

```typescript
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { validateAndWrite } from "../../../agent/write-step-output.js"

const paramsSchema = Type.Object({
  input: Type.Object({
    status: Type.String({ description: "Completion state: 'done', 'retry', or 'failed'" })
  }, { additionalProperties: true })
})

export function createWorkflowExtension(
  runId: string,
  stepId: string,
  outputSchema?: Record<string, unknown>,
  onComplete?: () => void
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool("write_step_output", {
      label: "Write Step Output",
      description: "Save your step results. The input must be a JSON object with a 'status' field (string). Call this exactly once when your step is complete. The file is written to the Hamilton run outputs directory.",
      parameters: paramsSchema,
      promptSnippet: "- write_step_output: saves your step results (call once when done, input must be a JSON object with 'status' field)",
      execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
        const result = validateAndWrite(runId, stepId, outputSchema, input)

        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {}
          }
        }

        onComplete?.()

        return {
          content: [{ type: "text" as const, text: "Step output written successfully." }],
          details: {}
        }
      }
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/executors/pi/workflow-extension.test.ts
```

Expected: 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/executors/pi/extensions/workflow-extension.ts tests/executors/pi/workflow-extension.test.ts
git commit -m "feat: add workflow extension providing write_step_output via pi.registerTool"
```

---

### Task 6: Update pi-executor.ts to use new package

**Files:**
- Modify: `src/executors/pi/pi-executor.ts`

- [ ] **Step 1: Update imports and wire workflow extension**

In `src/executors/pi/pi-executor.ts`, change lines 3-25 to update imports and the extension wiring.

Replace the import block (lines 3-25) and the extension wiring section (lines 112-119, 161-173) to use the new package paths and workflow extension.

```typescript
import { Effect, Data } from "effect"
import { EventBus } from "../../events/bus.js"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import {
  AuthStorage,
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent"
import type { Skill, ResourceDiagnostic } from "@earendil-works/pi-coding-agent"
import { getModel } from "@earendil-works/pi-ai"
import { piAgentDir } from "./paths.js"
import { subscribePiEvents } from "./streaming.js"

import * as Fs from "node:fs"
import * as Path from "node:path"
import { buildExtensions, readExtensionSettings, type ExtensionFactory } from "./extensions/extensions.js"
import { createWorkflowExtension } from "./extensions/workflow-extension.js"
import { stepOutputFile } from "../../paths.js"
import type { ResolvablePrompt } from "../../prompts/types.js"
import { createGuidelineExtension } from "./extensions/guideline-extension.js"
import type { CompiledRule } from "../../guidelines/types.js"
```

Then locate the section inside `executeWithPi` where `extensionFactories` is built (after line ~114). Replace:

```typescript
    const extSettings = readExtensionSettings()
    const extensionFactories = buildExtensions(extSettings)

    if (config.rules && config.rules.length > 0) {
      extensionFactories.push(createGuidelineExtension(config.rules) as ExtensionFactory)
    }
```

With (adding workflow extension after guidelines):

```typescript
    const extSettings = readExtensionSettings()
    const extensionFactories = buildExtensions(extSettings)

    if (config.rules && config.rules.length > 0) {
      extensionFactories.push(createGuidelineExtension(config.rules) as ExtensionFactory)
    }

    extensionFactories.push(
      createWorkflowExtension(
        config.runId,
        config.stepId,
        config.outputSchema,
        () => { sessionRef?.abort().catch(() => {}) }
      )
    )
```

Then remove the old `writeStepOutputTool` block (lines ~161-173) that creates the tool via `createWriteStepOutputTool` and passes it to `createAgentSession` as `customTools`. Remove the `let sessionRef` line that references `writeStepOutputTool` and instead declare `sessionRef` before the workflow extension push so it's in scope.

The full `executeWithPi` function after changes should look like this (key sections marked):

```typescript
export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError, EventBus> {
  return Effect.gen(function* (_) {
    const cwd = config.cwd ?? process.cwd()
    const agentDir = piAgentDir()
    const defaults = readDefaults(agentDir)

    const authStorage = AuthStorage.create(Path.join(agentDir, "auth.json"))
    const modelRegistry = ModelRegistry.create(authStorage, Path.join(agentDir, "models.json"))
    const settingsManager = SettingsManager.create(cwd, agentDir)

    const [provider, modelId] = parseModelString(config.model, defaults)
    const model = getModel(provider as "openai", modelId as Parameters<typeof getModel>[1])
    const thinkingLevel = mapThinkingLevel(config.settings?.thinking)

    const { systemPrompt, taskPrompt, guidelineFiles } = config.prompt

    const extSettings = readExtensionSettings()
    const extensionFactories = buildExtensions(extSettings)

    if (config.rules && config.rules.length > 0) {
      extensionFactories.push(createGuidelineExtension(config.rules) as ExtensionFactory)
    }

    const resolvedSkills = config.settings?.skills ?? null
    const loaderOptions: any = {
      cwd,
      agentDir,
      systemPromptOverride: () => systemPrompt,
      agentsFilesOverride: (current: any) => ({
        agentsFiles: [
          ...(current?.agentsFiles ?? []),
          ...guidelineFiles.map((f: {name: string; content: string}) => ({ path: f.name, content: f.content }))
        ]
      }),
      extensionFactories,
      settingsManager
    }

    if (!resolvedSkills || resolvedSkills.length === 0) {
      loaderOptions.noSkills = true
    } else {
      loaderOptions.skillsOverride = (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
        const skills: Skill[] = resolvedSkills.map((entry) => ({
          name: entry.name,
          description: entry.description,
          filePath: entry.filePath,
          baseDir: entry.baseDir,
          sourceInfo: createSyntheticSourceInfo(entry.filePath, {
            source: "hamilton",
            scope: "user" as const,
            origin: "package" as const,
            baseDir: entry.baseDir
          }),
          disableModelInvocation: false
        }))
        return { skills, diagnostics: base.diagnostics }
      }
    }

    const loader = new DefaultResourceLoader(loaderOptions)

    yield* _(Effect.promise(() => loader.reload()))

    let sessionRef: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null

    extensionFactories.push(
      createWorkflowExtension(
        config.runId,
        config.stepId,
        config.outputSchema,
        () => { sessionRef?.abort().catch(() => {}) }
      )
    )

    const sessionManager = SessionManager.inMemory()

    const { session } = yield* _(
      Effect.promise(() =>
        createAgentSession({
          model,
          thinkingLevel,
          tools: buildToolSet(config.settings?.tools),
          agentDir,
          authStorage,
          modelRegistry,
          resourceLoader: loader,
          sessionManager,
          settingsManager
        })
      )
    )

    sessionRef = session

    if (config.settings?.compactionEnabled) {
      (session as any).setAutoCompactionEnabled?.(true)
    }

    const handlePiEvent = subscribePiEvents(
      config.runId,
      config.stepId,
      () => {
        const stats = session.getSessionStats?.()
        return {
          inputTokens: stats?.tokens?.input ?? 0,
          outputTokens: stats?.tokens?.output ?? 0
        }
      }
    )

    const bus = yield* _(EventBus)

    const unsubscribe = session.subscribe((piEvent) => {
      Effect.runPromise(handlePiEvent(piEvent as Parameters<typeof handlePiEvent>[0]).pipe(
        Effect.provideService(EventBus, bus)
      ))
    })

    try {
      yield* _(Effect.promise(() => session.prompt(taskPrompt)))

      const outputPath = stepOutputFile(config.runId, config.stepId)
      const MAX_REMINDERS = 2
      let reminders = 0
      while (!Fs.existsSync(outputPath) && reminders < MAX_REMINDERS) {
        reminders++
        yield* _(
          Effect.promise(() =>
            session.prompt("REMINDER: You must call write_step_output to save your work. Call write_step_output now with your findings.")
          )
        )
      }
      if (!Fs.existsSync(outputPath)) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              stepId: config.stepId,
              message: `Step did not call write_step_output after ${reminders} reminders`
            })
          )
        )
      }

      const raw = Fs.readFileSync(outputPath, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed
    } catch (e) {
      const outputPath = stepOutputFile(config.runId, config.stepId)
      if (Fs.existsSync(outputPath)) {
        const raw = Fs.readFileSync(outputPath, "utf-8")
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return parsed
      }

      return yield* _(
        Effect.fail(
          new PiExecutionError({
            stepId: config.stepId,
            message: e instanceof Error ? e.message : String(e)
          })
        )
      )
    } finally {
      unsubscribe()
      session.dispose()
    }
  })
}
```

Key changes from current:
1. `extensionFactories.push(createWorkflowExtension(...))` added after the `sessionRef` declaration but before `createAgentSession`
2. `customTools: [writeStepOutputTool]` removed from `createAgentSession` call
3. `createWriteStepOutputTool` import and usage removed
4. `sessionRef` declaration moved before the workflow extension push
5. `onComplete` callback captures `sessionRef` in closure as before

- [ ] **Step 2: Run build to verify compilation**

```bash
bun run build
```

Expected: BUILD SUCCESS — no type errors

- [ ] **Step 3: Run all Pi executor tests to verify nothing is broken**

```bash
bun --bun vitest run tests/executors/pi/
```

Expected: All tests PASS (extensions, rtk-extension, guideline-extension, workflow-extension, streaming)

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "feat: wire workflow extension into pi-executor, remove write-step-output-tool direct wiring"
```

---

### Task 7: Delete old flat files

**Files:**
- Delete: `src/executors/pi/extensions.ts`
- Delete: `src/executors/pi/rtk-extension.ts`
- Delete: `src/executors/pi/guideline-extension.ts`
- Delete: `src/executors/pi/write-step-output-tool.ts`
- Delete: `tests/executors/pi/write-step-output-tool.test.ts`

- [ ] **Step 1: Delete the old flat source files**

```bash
rm src/executors/pi/extensions.ts
rm src/executors/pi/rtk-extension.ts
rm src/executors/pi/guideline-extension.ts
rm src/executors/pi/write-step-output-tool.ts
rm tests/executors/pi/write-step-output-tool.test.ts
```

- [ ] **Step 2: Run build to verify no references to deleted files**

```bash
bun run build
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Run the full test suite**

```bash
bun --bun vitest run
```

Expected: All 155+ tests PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete old flat extension files, now in extensions package"
```

---

### Task 8: Final build and test verification

- [ ] **Step 1: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All tests PASS

- [ ] **Step 2: Run install-local**

```bash
bun run install-local
```

Expected: Builds and symlinks successfully

- [ ] **Step 3: Commit (if any changes)**

If anything was changed during verification, commit. Otherwise this step is confirmation-only.

---

## Verification Checklist

After all tasks complete, verify:

1. `src/executors/pi/extensions/` contains four files: `extensions.ts`, `rtk-extension.ts`, `guideline-extension.ts`, `workflow-extension.ts`
2. Old flat files (`extensions.ts`, `rtk-extension.ts`, `guideline-extension.ts`, `write-step-output-tool.ts`) are deleted from `src/executors/pi/`
3. `bun run build` passes with no errors
4. `bun --bun vitest run` passes all tests (155+)
5. No imports anywhere reference the old flat file paths
