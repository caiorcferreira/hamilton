# Refactor Pi Logic into executors/pi Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Pi-specific code (pi-executor, rtk-extension, streaming, write-step-output-tool) into `src/executors/pi/`, extract generic validation core into `src/agent/write-step-output.ts`.

**Architecture:** Four file moves + one new file + import churn. `pi-executor.ts`, `rtk-extension.ts`, `streaming.ts`, and `write-step-output-tool.ts` move to `src/executors/pi/` with updated relative imports. `piAgentDir()` moves to `src/executors/pi/paths.ts`. The generic validation logic from `write-step-output-tool.ts` is extracted into `src/agent/write-step-output.ts` (no Pi SDK imports). All tests move accordingly.

**Tech Stack:** TypeScript, Effect-TS, `@earendil-works/pi-*`, bun

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/executors/pi/pi-executor.ts` | Move from `src/agent/` | Pi session creation + execution loop |
| `src/executors/pi/rtk-extension.ts` | Move from `src/agent/` | RTK tool-call rewriting extension |
| `src/executors/pi/streaming.ts` | Move from `src/observability/` | Pi event → EventBus translation |
| `src/executors/pi/paths.ts` | Create | `piAgentDir()` moved from `src/paths.ts` |
| `src/executors/pi/write-step-output-tool.ts` | Move from `src/agent/` | Pi tool wrapper (thin, imports generic core) |
| `src/agent/write-step-output.ts` | Create | Generic validation + file-writing core |
| `src/paths.ts` | Modify | Remove `piAgentDir()` |
| `src/workflow/runner.ts` | Modify | Update `executeWithPi` import path |
| `tests/executors/pi/rtk-extension.test.ts` | Move from `tests/agent/` | RTK extension tests |
| `tests/executors/pi/write-step-output-tool.test.ts` | Move from `tests/agent/` | Pi tool wrapper tests |
| `tests/executors/pi/streaming.test.ts` | Move from `tests/observability/` | Streaming tests |
| `tests/agent/write-step-output.test.ts` | Create | Tests for generic core |
| `tests/cli/run.test.ts` | Modify | Update mock path for pi-executor |

---

### Task 1: Create executors/pi/paths.ts + remove piAgentDir from src/paths.ts

**Files:**
- Create: `src/executors/pi/paths.ts`
- Modify: `src/paths.ts:54-56,75-89`

- [ ] **Step 1: Create the new paths file**

```ts
import * as Path from "node:path"
import { hamiltonHome } from "../../paths.js"

export function piAgentDir(): string {
  return Path.join(hamiltonHome(), "executors", "pi", "agent")
}
```

- [ ] **Step 2: Remove piAgentDir from src/paths.ts**

Remove lines 54-56:

```ts
export function piAgentDir(): string {
  return Path.join(hamiltonHome(), "executors", "pi", "agent")
}
```

In `ensureHamiltonHome()`, replace `piAgentDir()` on line 81 with the inline path:

```ts
    Path.join(hamiltonHome(), "executors", "pi", "agent"),
```

The `dirs` array (lines 76-83) becomes:

```ts
  const dirs = [
    hamiltonHome(),
    agentsDir(),
    workflowsDir(),
    runsDir(),
    Path.join(hamiltonHome(), "executors", "pi", "agent"),
    instructionDir()
  ]
```

- [ ] **Step 3: Verify build compiles**

Run: `bun run build`

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/paths.ts src/paths.ts
git commit -m "refactor: move piAgentDir to executors/pi/paths.ts"
```

---

### Task 2: Extract generic write-step-output core into src/agent/write-step-output.ts

**Files:**
- Create: `src/agent/write-step-output.ts`

- [ ] **Step 1: Write the generic core module**

```ts
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
```

No Pi SDK imports. No textContent helper. No defineTool. Pure validation + file-writing.

- [ ] **Step 2: Verify build compiles**

Run: `bun run build`

- [ ] **Step 3: Commit**

```bash
git add src/agent/write-step-output.ts
git commit -m "feat: extract generic write-step-output validation core"
```

---

### Task 3: Move write-step-output-tool.ts to executors/pi/ with Pi wrapper

**Files:**
- Create: `src/executors/pi/write-step-output-tool.ts`
- Delete: `src/agent/write-step-output-tool.ts`

- [ ] **Step 1: Create the Pi wrapper in executors/pi/**

```ts
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { validateAndWrite } from "../../agent/write-step-output.js"

const paramsSchema = Type.Object({
  input: Type.Object({
    status: Type.String({ description: "Completion state: 'done', 'retry', or 'failed'" })
  }, { additionalProperties: true })
})

function textContent(text: string): { type: "text"; text: string } {
  return { type: "text", text }
}

export interface StepCompleteCallback {
  onStepComplete: () => void
}

export function createWriteStepOutputTool(
  runId: string,
  stepId: string,
  outputSchema?: Record<string, unknown>,
  cb?: StepCompleteCallback
): ToolDefinition<typeof paramsSchema> {
  return defineTool({
    name: "write_step_output",
    label: "Write Step Output",
    description: "Save your step results. The input must be a JSON object with a 'status' field (string). Call this exactly once when your step is complete. The file is written to the Hamilton run outputs directory.",
    parameters: paramsSchema,
    promptSnippet: "- write_step_output: saves your step results (call once when done, input must be a JSON object with 'status' field)",
    execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
      const result = validateAndWrite(runId, stepId, outputSchema, input)

      if (!result.success) {
        return {
          content: [textContent(`Error: ${result.error}`)],
          details: {}
        }
      }

      cb?.onStepComplete()

      return {
        content: [textContent("Step output written successfully.")],
        details: {}
      }
    }
  })
}
```

- [ ] **Step 2: Delete the old file**

```bash
rm src/agent/write-step-output-tool.ts
```

- [ ] **Step 3: Update pi-executor.ts import**

`pi-executor.ts` still imports from `./write-step-output-tool.js` — this import stays the same since both files move to the same directory. No change needed.

- [ ] **Step 4: Verify build compiles**

Run: `bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/executors/pi/write-step-output-tool.ts
git rm src/agent/write-step-output-tool.ts
git commit -m "refactor: move write-step-output-tool to executors/pi, delegate to generic core"
```

---

### Task 4: Move pi-executor.ts to executors/pi/

**Files:**
- Create: `src/executors/pi/pi-executor.ts`
- Delete: `src/agent/pi-executor.ts`

- [ ] **Step 1: Copy pi-executor.ts and update internal imports**

Copy the file content from `src/agent/pi-executor.ts` and update these imports:

Line 2: `../events/bus.js` → `../../events/bus.js`
Line 13: `../paths.js` → `./paths.js`
Line 14: `../observability/streaming.js` → `./streaming.js`
Line 18: `./write-step-output-tool.js` (unchanged, sibling)
Line 19: `./rtk-extension.js` (unchanged, sibling)
Line 20: `../paths.js` → `../../paths.js` (stepOutputFile comes from paths.ts, not executors/pi/paths.ts)

Wait — line 20 imports `stepOutputFile` from `../paths.js`. After the move, this should point to `../../paths.js` since `paths.ts` is two levels up (src/paths.ts). But actually we only moved `piAgentDir` to executors/pi/paths.ts. `stepOutputFile` is still in the main `paths.ts`. So yes, the import becomes `../../paths.js`.

Full updated imports for `src/executors/pi/pi-executor.ts`:

```ts
import { Effect, Data } from "effect"
import { EventBus } from "../../events/bus.js"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent"
import { getModel } from "@earendil-works/pi-ai"
import { piAgentDir } from "./paths.js"
import { subscribePiEvents } from "./streaming.js"

import * as Fs from "node:fs"
import * as Path from "node:path"
import { createWriteStepOutputTool } from "./write-step-output-tool.js"
import { createRtkExtension } from "./rtk-extension.js"
import { stepOutputFile } from "../../paths.js"
```

The rest of the file is identical.

- [ ] **Step 2: Delete the old file**

```bash
rm src/agent/pi-executor.ts
```

- [ ] **Step 3: Verify build compiles**

Run: `bun run build`

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git rm src/agent/pi-executor.ts
git commit -m "refactor: move pi-executor to executors/pi"
```

---

### Task 5: Move rtk-extension.ts and streaming.ts to executors/pi/

**Files:**
- Create: `src/executors/pi/rtk-extension.ts`
- Delete: `src/agent/rtk-extension.ts`
- Create: `src/executors/pi/streaming.ts`
- Delete: `src/observability/streaming.ts`

- [ ] **Step 1: Move rtk-extension.ts**

Copy `src/agent/rtk-extension.ts` to `src/executors/pi/rtk-extension.ts` with no changes (no internal imports that depend on location).

```bash
cp src/agent/rtk-extension.ts src/executors/pi/rtk-extension.ts
rm src/agent/rtk-extension.ts
```

- [ ] **Step 2: Move streaming.ts with updated import**

Copy `src/observability/streaming.ts` to `src/executors/pi/streaming.ts` with one import change:

Line 2: `../events/bus.js` → `../../events/bus.js`

```bash
cp src/observability/streaming.ts src/executors/pi/streaming.ts
```

Then edit `src/executors/pi/streaming.ts` — change line 2 from:

```ts
import { EventBus } from "../events/bus.js"
```

to:

```ts
import { EventBus } from "../../events/bus.js"
```

Delete old file:

```bash
rm src/observability/streaming.ts
```

- [ ] **Step 3: Verify build compiles**

Run: `bun run build`

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/rtk-extension.ts src/executors/pi/streaming.ts
git rm src/agent/rtk-extension.ts src/observability/streaming.ts
git commit -m "refactor: move rtk-extension and streaming to executors/pi"
```

---

### Task 6: Update runner.ts imports

**Files:**
- Modify: `src/workflow/runner.ts:7`

- [ ] **Step 1: Update the executeWithPi import**

Line 7: Change from:

```ts
import { executeWithPi } from "../agent/pi-executor.js"
```

to:

```ts
import { executeWithPi } from "../executors/pi/pi-executor.js"
```

- [ ] **Step 2: Verify build compiles**

Run: `bun run build`

- [ ] **Step 3: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "refactor: update runner import to executors/pi/pi-executor"
```

---

### Task 7: Move test files to tests/executors/pi/

**Files:**
- Create: `tests/executors/pi/rtk-extension.test.ts`
- Delete: `tests/agent/rtk-extension.test.ts`
- Create: `tests/executors/pi/write-step-output-tool.test.ts`
- Delete: `tests/agent/write-step-output-tool.test.ts`
- Create: `tests/executors/pi/streaming.test.ts`
- Delete: `tests/observability/streaming.test.ts`

- [ ] **Step 1: Create tests/executors/pi/ directory**

```bash
mkdir -p tests/executors/pi
```

- [ ] **Step 2: Move rtk-extension test with updated import**

Copy `tests/agent/rtk-extension.test.ts` to `tests/executors/pi/rtk-extension.test.ts`.

Update line 2 from:

```ts
import { createRtkExtension } from "../../src/agent/rtk-extension.js"
```

to:

```ts
import { createRtkExtension } from "../../../src/executors/pi/rtk-extension.js"
```

Delete old:

```bash
rm tests/agent/rtk-extension.test.ts
```

- [ ] **Step 3: Move write-step-output-tool test with updated import**

Copy `tests/agent/write-step-output-tool.test.ts` to `tests/executors/pi/write-step-output-tool.test.ts`.

Update line 2 from:

```ts
import { createWriteStepOutputTool } from "../../src/agent/write-step-output-tool.js"
```

to:

```ts
import { createWriteStepOutputTool } from "../../../src/executors/pi/write-step-output-tool.js"
```

Delete old:

```bash
rm tests/agent/write-step-output-tool.test.ts
```

- [ ] **Step 4: Move streaming test with updated import**

Copy `tests/observability/streaming.test.ts` to `tests/executors/pi/streaming.test.ts`.

Update line 3 from:

```ts
import { subscribePiEvents, type PiEvent } from "../../src/observability/streaming.js"
```

to:

```ts
import { subscribePiEvents, type PiEvent } from "../../../src/executors/pi/streaming.js"
```

Delete old:

```bash
rm tests/observability/streaming.test.ts
```

- [ ] **Step 5: Run the moved tests to verify**

```bash
bun --bun vitest run tests/executors/pi/
```

Expected: All tests pass (RTK: 5, write-step-output-tool: 9, streaming: should pass)

- [ ] **Step 6: Commit**

```bash
git add tests/executors/pi/
git rm tests/agent/rtk-extension.test.ts tests/agent/write-step-output-tool.test.ts tests/observability/streaming.test.ts
git commit -m "test: move Pi-specific tests to tests/executors/pi"
```

---

### Task 8: Create tests for generic write-step-output.ts

**Files:**
- Create: `tests/agent/write-step-output.test.ts`

- [ ] **Step 1: Write the test file**

```ts
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
    expect(result.error).toBeUndefined()

    const outputPath = Path.join(tmpDir, ".hamilton", "runs", "run-1", "step-outputs", "step-1.json")
    const raw = Fs.readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ status: "done", key: "val" })
  })

  it("returns error on duplicate write", () => {
    validateAndWrite("run-1", "step-1", undefined, { status: "done" })
    const result = validateAndWrite("run-1", "step-1", undefined, { status: "done" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("already written")
  })

  it("returns error when input is an array", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, [1, 2, 3])
    expect(result.success).toBe(false)
    expect(result.error).toContain("JSON object")
  })

  it("returns error when input is null", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, null)
    expect(result.success).toBe(false)
    expect(result.error).toContain("JSON object")
  })

  it("returns error when status field is missing", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, { repo: "hamilton" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required field 'status'")
  })

  it("returns error when status is empty", () => {
    const result = validateAndWrite("run-1", "step-1", undefined, { status: "" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required field 'status'")
  })

  it("validates with schema and rejects invalid output", () => {
    const schema = {
      type: "object",
      properties: { status: { type: "string" }, count: { type: "number" } },
      required: ["status", "count"]
    }
    const result = validateAndWrite("run-1", "step-1", schema, { status: "done", count: "not-a-number" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("schema validation")
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
```

- [ ] **Step 2: Run the tests**

Run: `bun --bun vitest run tests/agent/write-step-output.test.ts`
Expected: All 9 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/agent/write-step-output.test.ts
git commit -m "test: add tests for generic write-step-output validation core"
```

---

### Task 9: Update run.test.ts mock path

**Files:**
- Modify: `tests/cli/run.test.ts:7,10`

- [ ] **Step 1: Update the mock path**

Line 7: Change from:

```ts
import { PiExecutionError } from "../../src/agent/pi-executor.js"
```

to:

```ts
import { PiExecutionError } from "../../src/executors/pi/pi-executor.js"
```

Line 10: Change from:

```ts
vi.mock("../../src/agent/pi-executor.js", () => {
```

to:

```ts
vi.mock("../../src/executors/pi/pi-executor.js", () => {
```

- [ ] **Step 2: Run the test to verify**

Run: `bun --bun vitest run tests/cli/run.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/cli/run.test.ts
git commit -m "test: update run.test.ts mock path for executors/pi"
```

---

### Task 10: Run full test suite

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the full test suite**

```bash
bun --bun vitest run
```

Expected: All 254 tests pass (same count, files reorganized)

- [ ] **Step 2: Verify build**

```bash
bun run build
```

Expected: Exit 0

- [ ] **Step 3: Commit any final fixes**

```bash
git commit -am "chore: final fixes from full test suite"
```
