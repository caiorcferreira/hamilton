# Tool-Based Agent Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `parseAgentOutput` text parsing with a `write_step_output` custom Pi tool that agents call to save their results as JSON to `~/.hamilton/runs/<run-id>/step-outputs/<step-id>.json`.

**Architecture:** A custom Pi tool registered via `customTools` in `createAgentSession` validates JSON input (must be an object with a `status` string field) and writes the output file. The `buildAgentPrompt` function adds a "Hamilton Workflow System" section (before identity/soul/context/agents) explaining the tool contract. `executeWithPi` reads the output file after `session.prompt()` completes instead of parsing assistant text.

**Tech Stack:** TypeScript, Effect-TS, Pi SDK (`@earendil-works/pi-coding-agent`), typebox, bun:sqlite

**Design doc:** `docs/plans/2026-06-06-hamilton-tool-based-output-design.md`

---

### Task 1: Create `write_step_output` tool

**Files:**
- Create: `src/agent/write-step-output-tool.ts`

- [ ] **Step 1: Write the tool module**

```typescript
import * as Fs from "node:fs"
import * as Path from "node:path"
import { stepOutputsDir, stepOutputFile } from "../paths.js"
import type { ToolDefinition } from "@earendil-works/pi-coding-agent"
import { defineTool } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

const paramsSchema = Type.Object({
  input: Type.String({ description: "JSON string with your results. Must be an object with a 'status' field." })
})

export function createWriteStepOutputTool(runId: string, stepId: string): ToolDefinition<typeof paramsSchema> {
  return defineTool({
    name: "write_step_output",
    label: "Write Step Output",
    description: "Save your step results as JSON. The input must be a valid JSON object with a 'status' field (string). Call this exactly once when your step is complete. The file is written to the Hamilton run outputs directory.",
    parameters: paramsSchema,
    promptSnippet: "- write_step_output: saves your step results as JSON (call once when done, input must be valid JSON with 'status' field)",
    execute: async (_toolCallId, { input }, _signal) => {
      const outputsDir = stepOutputsDir(runId)
      const outputPath = stepOutputFile(runId, stepId)

      if (Fs.existsSync(outputPath)) {
        return {
          content: "Error: Output already written for this step. write_step_output can only be called once.",
          isError: true
        }
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(input)
      } catch {
        return {
          content: "Error: Invalid JSON input. Please provide a valid JSON string.",
          isError: true
        }
      }

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
          content: "Error: Input must be a JSON object (not an array, null, or primitive value).",
          isError: true
        }
      }

      const obj = parsed as Record<string, unknown>
      if (typeof obj.status !== "string") {
        return {
          content: "Error: Missing required field 'status' (must be a string). Example: { \"status\": \"done\", ... }",
          isError: true
        }
      }

      Fs.mkdirSync(outputsDir, { recursive: true })
      Fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2))

      return {
        content: "Step output written successfully to " + outputPath
      }
    }
  })
}
```

### Task 2: Add Hamilton section to `buildAgentPrompt`

**Files:**
- Modify: `src/agent/activity.ts:21-47`

- [ ] **Step 1: Update `buildAgentPrompt` to include Hamilton section first and remove JSON instruction**

Replace the entire `buildAgentPrompt` function body (lines 21-47) with:

```typescript
export function buildAgentPrompt(params: PromptParams): BuiltPrompt {
  const systemParts: string[] = []

  systemParts.push(`## Hamilton Workflow System

You are executing a step within a Hamilton workflow. A workflow is a sequence of steps
that pass context between them. Your job is to complete one step and save your result.

### How to finish your step

When you have completed your work, call the write_step_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent steps.

IMPORTANT:
- You MUST call write_step_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field`)

  if (params.identityMd) {
    systemParts.push(`Your role: ${params.identityMd}`)
  }

  if (params.soulMd) {
    systemParts.push(`Your style: ${params.soulMd}`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextLines = Object.entries(params.context)
      .map(([key, value]) => `  ${key}: ${value}`)
      .join("\n")
    systemParts.push(`Context from previous steps:\n${contextLines}`)
  }

  systemParts.push(params.agentsMd)

  const resolvedInput = resolveTemplate(params.stepInput, params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: resolvedInput
  }
}
```

### Task 3: Remove `parseAgentOutput` and `AgentOutputParseError`

**Files:**
- Modify: `src/agent/activity.ts:17-19` (remove `AgentOutputParseError` class)
- Modify: `src/agent/activity.ts:49-68` (remove `parseAgentOutput` function)

- [ ] **Step 1: Remove `AgentOutputParseError` class**

Delete lines 17-19:
```typescript
export class AgentOutputParseError extends Data.TaggedError("AgentOutputParseError")<{
  message: string
}>() {}
```

- [ ] **Step 2: Remove `parseAgentOutput` function**

Delete lines 49-68 (the entire function).

- [ ] **Step 3: Remove unused `Data` import if no longer needed**

Check if `Data` is still used in the file. `Data` was only used by `AgentOutputParseError`. Remove the `Data` import from line 1:

Before:
```typescript
import { Data, Effect } from "effect"
```

After:
```typescript
import { Effect } from "effect"
```

### Task 4: Update activity tests

**Files:**
- Modify: `tests/agent/activity.test.ts`

- [ ] **Step 1: Remove `parseAgentOutput` import and tests**

Remove `parseAgentOutput` from the import on line 5:

Before:
```typescript
import {
  buildAgentPrompt,
  parseAgentOutput,
  extractContextFromOutput,
  PromptParams
} from "../../src/agent/activity.js"
```

After:
```typescript
import {
  buildAgentPrompt,
  extractContextFromOutput,
  PromptParams
} from "../../src/agent/activity.js"
```

Remove the entire `parseAgentOutput` describe block (lines 66-97).

- [ ] **Step 2: Update `buildAgentPrompt` test assertions**

The test on line 34 expects `"When complete, respond with a JSON object containing your results."` in the task prompt. This line is no longer appended. Change lines 33-34:

Before:
```typescript
    expect(result.taskPrompt).toContain("Fix the bug")
    expect(result.taskPrompt).toContain("When complete, respond with a JSON object containing your results.")
```

After:
```typescript
    expect(result.taskPrompt).toContain("Fix the bug")
```

Remove the assertion at line 62 that also checks for the JSON instruction:

Before (line 62):
```typescript
    expect(result.taskPrompt).toContain("Fix the bug")
```

This is the same test that was updated above. No change needed — the line already exists and stays.

### Task 5: Add Hamilton section test to activity tests

**Files:**
- Modify: `tests/agent/activity.test.ts`

- [ ] **Step 1: Add test for Hamilton system prompt section**

Insert after the `"omits role and style sections when empty"` test (after line 63):

```typescript
  it("includes Hamilton Workflow System section as first section", () => {
    const params: PromptParams = {
      agentsMd: "You are a coder.",
      identityMd: "Senior Developer",
      soulMd: "Concise and direct",
      stepInput: "Fix the bug",
      context: {}
    }
    const result = buildAgentPrompt(params)
    const sections = result.systemPrompt.split("\n\n")
    expect(sections[0]).toContain("Hamilton Workflow System")
  })
```

### Task 6: Write tool unit tests

**Files:**
- Create: `tests/agent/write-step-output-tool.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
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
    const result = await tool.execute("call-1", { input: '{"status":"done","repo":"hamilton"}' }, undefined)

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain("Step output written successfully")
  })

  it("returns error when input is not valid JSON", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: "not json" }, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Invalid JSON")
  })

  it("returns error when input is not an object", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: "[1,2,3]" }, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("JSON object")
  })

  it("returns error when input is null", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: "null" }, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("JSON object")
  })

  it("returns error when status field is missing", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: '{"repo":"hamilton"}' }, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Missing required field 'status'")
  })

  it("returns error when status field is not a string", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: '{"status":42}' }, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Missing required field 'status'")
  })

  it("rejects duplicate calls (write-once)", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    await tool.execute("call-1", { input: '{"status":"done"}' }, undefined)
    const result = await tool.execute("call-2", { input: '{"status":"done"}' }, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Output already written")
  })

  it("writes output JSON to the correct file path", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    await tool.execute("call-1", { input: '{"status":"done","key":"val"}' }, undefined)

    const outputPath = Path.join(tmpDir, ".hamilton", "runs", "run-1", "step-outputs", "step-1.json")
    const raw = Fs.readFileSync(outputPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ status: "done", key: "val" })
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bun --bun vitest run tests/agent/write-step-output-tool.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/agent/write-step-output-tool.test.ts
git commit -m "test: add write_step_output tool unit tests"
```

### Task 7: Integrate tool into `executeWithPi` and read output from file

**Files:**
- Modify: `src/agent/pi-executor.ts`

- [ ] **Step 1: Add import for write_step_output tool**

Add after line 17 (`import * as Path from "node:path"`):

```typescript
import { createWriteStepOutputTool } from "./write-step-output-tool.js"
import { stepOutputFile } from "../paths.js"
```

- [ ] **Step 2: Remove `parseAgentOutput` import**

Remove line 15:
```typescript
import { parseAgentOutput } from "../agent/activity.js"
```

- [ ] **Step 3: Register the custom tool in `createAgentSession`**

In the `executeWithPi` function, after line 119 (`yield* _(Effect.promise(() => loader.reload()))`), add tool creation:

Replace lines 123-137 (the `createAgentSession` call) with:

```typescript
    const writeStepOutputTool = createWriteStepOutputTool(config.runId, config.stepId)

    const { session } = yield* _(
      Effect.promise(() =>
        createAgentSession({
          model,
          thinkingLevel,
          tools: config.settings?.tools ?? [],
          customTools: [writeStepOutputTool],
          agentDir,
          authStorage,
          modelRegistry,
          resourceLoader: loader,
          sessionManager,
          settingsManager
        })
      )
    )
```

- [ ] **Step 4: Remove `extractTextContent` function**

Delete lines 77-93 (the entire `extractTextContent` function).

- [ ] **Step 5: Replace text-parsing with file-read in the try block**

Replace lines 155-194 (the entire try block body after `session.prompt`) with:

```typescript
    try {
      yield* _(Effect.promise(() => session.prompt(config.taskPrompt)))

      const outputPath = stepOutputFile(config.runId, config.stepId)
      if (!Fs.existsSync(outputPath)) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              stepId: config.stepId,
              message: "Step did not call write_step_output"
            })
          )
        )
      }

      const raw = Fs.readFileSync(outputPath, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed
    } catch (e) {
      return yield* _(
        Effect.fail(
          new PiExecutionError({
            stepId: config.stepId,
            message: e instanceof Error ? e.message : String(e)
          })
        )
      )
    } finally {
```

### Task 8: Verify everything builds

**Files:** none (verification only)

- [ ] **Step 1: Run the build**

```bash
bun run build
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run tests**

```bash
bun --bun vitest run
```

Expected: all tests pass. The `parseAgentOutput` test block has been removed, so the test count will decrease by 4. Updated `buildAgentPrompt` tests should pass.

### Task 9: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add src/agent/write-step-output-tool.ts src/agent/activity.ts src/agent/pi-executor.ts tests/agent/activity.test.ts
git commit -m "feat: replace parseAgentOutput with write_step_output Pi tool"
```
