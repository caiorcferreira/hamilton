# Redact Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi SDK extension that scans tool output for secrets using `@secretlint/core` and redacts them with `[REDACTED:Type]` placeholders before the output reaches the model.

**Architecture:** Single extension file (`createRedactExtension` factory) that hooks `pi.on("tool_result")`, scans each `TextContent` block via `lintSource`, replaces detected secret character ranges with `[REDACTED:<messageId>]`, and returns mutated `content`. Wired unconditionally in `pi-executor.ts`. Always-on, no settings YAML entry.

**Tech Stack:** TypeScript, bun, Effect-TS, `@secretlint/core`, `@secretlint/secretlint-rule-preset-recommend`, vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/executors/pi/extensions/redact-extension.ts` | Create | Extension factory + `redactText` helper |
| `tests/executors/pi/redact-extension.test.ts` | Create | All test cases, mocked secretlint |
| `src/executors/pi/pi-executor.ts:20-24` | Modify | Import `createRedactExtension` and push it into factories |
| `package.json` | Modify | Add two secretlint dependencies |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add secretlint packages**

Run:
```bash
bun add @secretlint/core @secretlint/secretlint-rule-preset-recommend
```

Expected: Dependencies added to `package.json` with exact versions (bun's default is pinned). `bun.lock` updated.

- [ ] **Step 2: Verify install**

Run:
```bash
bun run build
```

Expected: Build succeeds (secretlint types are available but no code imports them yet).

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add @secretlint/core and @secretlint/secretlint-rule-preset-recommend"
```

---

### Task 2: Create test file for the redact extension

**Files:**
- Create: `tests/executors/pi/redact-extension.test.ts`

- [ ] **Step 1: Create the test file with all test cases**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRedactExtension } from "../../../src/executors/pi/extensions/redact-extension.js"

vi.mock("@secretlint/core", () => ({
  lintSource: vi.fn()
}))

import { lintSource } from "@secretlint/core"

function makeTextBlock(text: string) {
  return { type: "text" as const, text }
}

function makeImageBlock() {
  return { type: "image" as const, data: "base64...", mimeType: "image/png" }
}

function makeToolResultEvent(content: Array<{ type: string; text?: string }>) {
  return {
    type: "tool_result" as const,
    toolCallId: "call-1",
    toolName: "bash",
    input: { command: "cat .env" },
    content: content as any,
    isError: false,
    details: undefined
  }
}

describe("createRedactExtension", () => {
  let handler: Function
  let mockPi: { on: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    handler = () => {}
    mockPi = {
      on: vi.fn((_event: string, h: Function) => { handler = h })
    }
    vi.clearAllMocks()
  })

  it("registers a tool_result listener", () => {
    const factory = createRedactExtension()
    factory(mockPi as any)
    expect(mockPi.on).toHaveBeenCalledWith("tool_result", expect.any(Function))
  })

  it("returns undefined when no secrets are found", async () => {
    vi.mocked(lintSource).mockResolvedValue({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([makeTextBlock("hello world this is safe text with enough length")])
    const result = await handler(event)

    expect(result).toBeUndefined()
  })

  it("redacts a single secret with [REDACTED:Type] placeholder", async () => {
    vi.mocked(lintSource).mockResolvedValue({
      messages: [
        {
          message: "GitHub Token found",
          messageId: "GitHubToken",
          range: [11, 51] as [number, number],
          severity: "error"
        }
      ],
      filePath: "",
      sourceContent: "",
      sourceContentType: "text"
    } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const text = "GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890"
    const event = makeToolResultEvent([makeTextBlock(text)])
    const result = await handler(event)

    expect(result).toBeDefined()
    expect((result as any).content[0].text).toBe("GH_TOKEN=[REDACTED:GitHubToken]")
  })

  it("redacts multiple secrets preserving right-to-left offset order", async () => {
    vi.mocked(lintSource).mockResolvedValue({
      messages: [
        {
          message: "AWS Key found",
          messageId: "AWSAccessKeyID",
          range: [0, 20] as [number, number],
          severity: "error"
        },
        {
          message: "GitHub Token found",
          messageId: "GitHubToken",
          range: [21, 61] as [number, number],
          severity: "error"
        }
      ],
      filePath: "",
      sourceContent: "",
      sourceContentType: "text"
    } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const text = "AKIAIOSFODNN7EXAMPLE\nghp_abcdefghijklmnopqrstuvwxyz1234567890"
    const event = makeToolResultEvent([makeTextBlock(text)])
    const result = await handler(event)

    expect((result as any).content[0].text).toBe("[REDACTED:AWSAccessKeyID]\n[REDACTED:GitHubToken]")
  })

  it("passes output through unredacted when lintSource throws", async () => {
    vi.mocked(lintSource).mockRejectedValue(new Error("secretlint internal error"))

    const factory = createRedactExtension()
    factory(mockPi as any)

    const text = "some text with a fake secret that crashes the linter to trigger error path"
    const event = makeToolResultEvent([makeTextBlock(text)])
    const result = await handler(event)

    expect(result).toBeUndefined()
  })

  it("passes output through unredacted when lintSource times out after 2s", async () => {
    vi.useFakeTimers()
    vi.mocked(lintSource).mockImplementation(() => new Promise(() => {})) // never resolves

    const factory = createRedactExtension()
    factory(mockPi as any)

    const text = "some text with enough characters to pass the minimum length check"
    const event = makeToolResultEvent([makeTextBlock(text)])
    const resultPromise = handler(event)

    vi.advanceTimersByTime(2100)
    const result = await resultPromise

    expect(result).toBeUndefined()
    vi.useRealTimers()
  })

  it("skips text shorter than 20 characters", async () => {
    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([makeTextBlock("short")])
    const result = await handler(event)

    expect(result).toBeUndefined()
    expect(lintSource).not.toHaveBeenCalled()
  })

  it("passes image blocks through untouched", async () => {
    vi.mocked(lintSource).mockResolvedValue({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([makeImageBlock()])
    const result = await handler(event)

    expect(result).toBeUndefined()
    expect(lintSource).not.toHaveBeenCalled()
  })

  it("scans text blocks while leaving image blocks unchanged in mixed content", async () => {
    vi.mocked(lintSource).mockResolvedValue({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([
      makeImageBlock(),
      makeTextBlock("hello world this is safe text with enough length"),
      makeImageBlock()
    ])
    const result = await handler(event)

    expect(result).toBeUndefined()
    expect(lintSource).toHaveBeenCalledTimes(1)
  })

  it("redacts text in one block while leaving other blocks unchanged", async () => {
    vi.mocked(lintSource).mockImplementation((opts: any) => {
      const secretText = "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
      if ((opts.source.content as string).includes(secretText)) {
        return Promise.resolve({
          messages: [
            {
              message: "GitHub Token found",
              messageId: "GitHubToken",
              range: [0, secretText.length] as [number, number],
              severity: "error"
            }
          ],
          filePath: "",
          sourceContent: "",
          sourceContentType: "text"
        } as any)
      }
      return Promise.resolve({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)
    })

    const factory = createRedactExtension()
    factory(mockPi as any)

    const secretText = "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
    const safeText = "this is normal output with enough length to be scanned"
    const event = makeToolResultEvent([
      makeTextBlock(safeText),
      makeTextBlock(secretText)
    ])
    const result = await handler(event)

    expect((result as any).content[0].text).toBe(safeText)
    expect((result as any).content[1].text).toBe("[REDACTED:GitHubToken]")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/executors/pi/redact-extension.test.ts
```

Expected: All tests FAIL because `createRedactExtension` is not yet implemented.

- [ ] **Step 3: Commit**

```bash
git add tests/executors/pi/redact-extension.test.ts
git commit -m "test: add redact extension tests"
```

---

### Task 3: Implement the redact extension

**Files:**
- Create: `src/executors/pi/extensions/redact-extension.ts`

- [ ] **Step 1: Create the extension file**

```typescript
import type { ExtensionAPI, ToolResultEvent, ToolResultEventResult } from "@earendil-works/pi-coding-agent"
import { lintSource } from "@secretlint/core"
import { creator } from "@secretlint/secretlint-rule-preset-recommend"

function isTextContent(block: unknown): block is { type: "text"; text: string } {
  return typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "text"
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

async function redactText(text: string): Promise<string | null> {
  if (text.length < 20) return null

  try {
    const result = await withTimeout(
      lintSource({
        source: {
          contentType: "text",
          content: text,
          filePath: "tool-output.txt",
          ext: ".txt"
        },
        options: {
          config: {
            rules: [
              { id: "@secretlint/secretlint-rule-preset-recommend", rule: creator }
            ]
          },
          noPhysicFilePath: true,
          maskSecrets: true
        }
      }),
      2000
    )

    if (result.messages.length === 0) return null

    const sorted = [...result.messages].sort((a, b) => b.range[0] - a.range[0])

    let redacted = text
    for (const msg of sorted) {
      const [start, end] = msg.range
      redacted = redacted.slice(0, start) + `[REDACTED:${msg.messageId}]` + redacted.slice(end)
    }

    return redacted
  } catch {
    console.warn("[redact-extension] secretlint scan failed or timed out")
    return null
  }
}

export function createRedactExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("tool_result", async (event: ToolResultEvent): Promise<ToolResultEventResult | undefined> => {
      let modified = false

      const newContent = await Promise.all(
        event.content.map(async (block) => {
          if (!isTextContent(block)) return block
          const redacted = await redactText(block.text)
          if (redacted === null) return block
          modified = true
          return { ...block, text: redacted }
        })
      )

      if (!modified) return undefined
      return { content: newContent }
    })
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bun --bun vitest run tests/executors/pi/redact-extension.test.ts
```

Expected: All 9 tests PASS.

- [ ] **Step 3: Run the full test suite to check for regressions**

```bash
bun run test
```

Expected: All 155+ existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/extensions/redact-extension.ts
git commit -m "feat: implement redact extension with secretlint"
```

---

### Task 4: Wire the redact extension into pi-executor.ts

**Files:**
- Modify: `src/executors/pi/pi-executor.ts:20-24`

- [ ] **Step 1: Add import and push the extension**

In `src/executors/pi/pi-executor.ts`, add the import after the existing extension imports (after line 24):

Add this import on a new line after the guideline extension import:
```typescript
import { createRedactExtension } from "./extensions/redact-extension.js"
```

Then after the `createWorkflowExtension` push on line 130, add:
```typescript
extensionFactories.push(createRedactExtension())
```

The relevant section of `pi-executor.ts` should look like:

```typescript
import { createRedactExtension } from "./extensions/redact-extension.js"

// ... (inside executeWithPi, after the createWorkflowExtension push)

    extensionFactories.push(
      createWorkflowExtension(
        config.runId,
        config.stepId,
        config.outputSchema,
        () => { sessionRef?.abort().catch(() => {}) }
      )
    )

    extensionFactories.push(createRedactExtension())
```

- [ ] **Step 2: Run the full test suite**

```bash
bun run test
```

Expected: All tests pass. No regressions.

- [ ] **Step 3: Run the build**

```bash
bun run build
```

Expected: TypeScript compilation succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "feat: wire redact extension into Pi executor"
```
