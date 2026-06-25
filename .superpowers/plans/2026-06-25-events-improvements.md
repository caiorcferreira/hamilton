# Events Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich Hamilton events with model/provider/toolCallId/stopReason/cache fields from the new Pi SDK event structure, add `LlmThinking` and `LspDiagnostic` events, and remove the text buffering layer.

**Architecture:** Streaming helpers (`mapMessageEndToEvent`, `mapTurnEndToEvents`) extract typed events from raw Pi SDK payloads. The LSP extension receives the EventBus directly for diagnostic emission. Telemetry subscriber uses `toolCallId` from events instead of building synthetic IDs.

**Tech Stack:** TypeScript, Effect-TS, bun, vitest

---

### Task 1: Update Event Types

**Files:**
- Modify: `src/events/bus.ts:11-28`

- [ ] **Step 1: Add new fields to existing events and add LlmThinking + LspDiagnostic types**

Replace the `Event` type in `src/events/bus.ts` (lines 11-28) with:

```typescript
export type Event =
  | { readonly _tag: "WorkflowStarted"; readonly runId: string }
  | { readonly _tag: "TaskStarted"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskCompleted"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskFailed"; readonly runId: string; readonly taskId: string; readonly taskName: string; readonly message: string }
  | { readonly _tag: "TaskTimedOut"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskRetrying"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "TaskPaused"; readonly runId: string; readonly taskId: string; readonly taskName: string }
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string }
  | { readonly _tag: "LlmMessage"; readonly runId: string; readonly taskId: string; readonly text: string; readonly model?: string; readonly provider?: string }
  | { readonly _tag: "LlmThinking"; readonly runId: string; readonly taskId: string; readonly text: string; readonly model?: string; readonly provider?: string }
  | { readonly _tag: "ToolCall"; readonly runId: string; readonly taskId: string; readonly tool: string; readonly input: unknown; readonly toolCallId: string; readonly model?: string; readonly provider?: string; readonly isPartialUpdate?: boolean }
  | { readonly _tag: "ToolResult"; readonly runId: string; readonly taskId: string; readonly tool: string; readonly isError: boolean; readonly toolCallId: string }
  | { readonly _tag: "TurnEnd"; readonly runId: string; readonly taskId: string; readonly tokensIn: number; readonly tokensOut: number; readonly stopReason: string; readonly cacheRead: number; readonly cacheWrite: number; readonly model: string; readonly provider: string }
  | { readonly _tag: "TokenUsage"; readonly runId: string; readonly taskId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "PromptBuilt"; readonly runId: string; readonly taskId: string; readonly systemPrompt: string; readonly taskPrompt: string; readonly guidelineFiles: ReadonlyArray<string> }
  | { readonly _tag: "TurnStarted"; readonly runId: string; readonly taskId: string; readonly turnId: string; readonly turnIndex: number; readonly timestamp: string }
  | { readonly _tag: "ProviderRequestStarted"; readonly runId: string; readonly taskId: string; readonly turnId: string; readonly requestId: string; readonly provider: string; readonly model: string; readonly payloadSummary: string; readonly timestamp: string }
  | { readonly _tag: "ModelSelected"; readonly runId: string; readonly taskId: string; readonly provider: string; readonly model: string; readonly timestamp: string }
  | { readonly _tag: "LspDiagnostic"; readonly runId: string; readonly taskId: string; readonly filePath: string; readonly text: string }
```

- [ ] **Step 2: Run build to verify types compile**

```bash
bun run build
```

Expected: tsc passes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/events/bus.ts
git commit -m "feat: add LlmThinking, LspDiagnostic events; enrich ToolCall/ToolResult/TurnEnd/LlmMessage"
```

---

### Task 2: Refactor Streaming with mapMessageEndToEvent and mapTurnEndToEvents

**Files:**
- Modify: `src/executors/pi/streaming.ts` (entire file)
- Modify: `tests/executors/pi/streaming.test.ts` (entire file)

- [ ] **Step 1: Write updated tests**

Replace `tests/executors/pi/streaming.test.ts` entirely with:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Stream } from "effect"
import { subscribePiEvents, mapMessageEndToEvent, mapTurnEndToEvents, type PiEvent } from "../../../src/executors/pi/streaming.js"
import { Event, EventBus, EventBusLive } from "../../../src/events/bus.js"

describe("mapMessageEndToEvent", () => {
  const runId = "run-1"
  const taskId = "task-1"

  it("returns LlmMessage when message has text content", () => {
    const event: PiEvent = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
        model: "glm-5.1",
        provider: "openai"
      }
    }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(1)
    expect(result[0]._tag).toBe("LlmMessage")
    if (result[0]._tag === "LlmMessage") {
      expect(result[0].text).toBe("Hello world")
      expect(result[0].model).toBe("glm-5.1")
      expect(result[0].provider).toBe("openai")
    }
  })

  it("returns LlmThinking when message has thinking content", () => {
    const event: PiEvent = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Let me think about this..." }],
        model: "glm-5.1",
        provider: "openai"
      }
    }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(1)
    expect(result[0]._tag).toBe("LlmThinking")
    if (result[0]._tag === "LlmThinking") {
      expect(result[0].text).toBe("Let me think about this...")
      expect(result[0].model).toBe("glm-5.1")
      expect(result[0].provider).toBe("openai")
    }
  })

  it("returns empty array when message has no content", () => {
    const event: PiEvent = {
      type: "message_end",
      message: { role: "assistant", content: [] }
    }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(0)
  })

  it("returns empty array when message is undefined", () => {
    const event: PiEvent = { type: "message_end" }
    const result = mapMessageEndToEvent(runId, taskId, event)
    expect(result).toHaveLength(0)
  })
})

describe("mapTurnEndToEvents", () => {
  const runId = "run-1"
  const taskId = "task-1"
  let lastStats: { inputTokens: number; outputTokens: number }

  beforeEach(() => {
    lastStats = { inputTokens: 50, outputTokens: 30 }
  })

  it("publishes ToolCall events for each tool call in message content", () => {
    const event: PiEvent = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-abc", name: "ls", arguments: { path: "/tmp" } },
        ],
        model: "glm-5.1",
        provider: "openai",
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
        stopReason: "toolUse"
      },
      toolResults: [
        { role: "toolResult", toolCallId: "call-abc", toolName: "ls", content: [{ type: "text", text: "file.txt" }], isError: false }
      ]
    }
    const currentStats = { inputTokens: 150, outputTokens: 80 }
    const results = mapTurnEndToEvents(runId, taskId, event, currentStats, lastStats)

    const toolCalls = results.filter(e => e._tag === "ToolCall")
    expect(toolCalls).toHaveLength(1)
    if (toolCalls[0]._tag === "ToolCall") {
      expect(toolCalls[0].tool).toBe("ls")
      expect(toolCalls[0].toolCallId).toBe("call-abc")
      expect(toolCalls[0].model).toBe("glm-5.1")
      expect(toolCalls[0].provider).toBe("openai")
    }

    const toolResults = results.filter(e => e._tag === "ToolResult")
    expect(toolResults).toHaveLength(1)
    if (toolResults[0]._tag === "ToolResult") {
      expect(toolResults[0].tool).toBe("ls")
      expect(toolResults[0].toolCallId).toBe("call-abc")
      expect(toolResults[0].isError).toBe(false)
    }

    const turnEnd = results.find(e => e._tag === "TurnEnd")
    expect(turnEnd).toBeDefined()
    if (turnEnd?._tag === "TurnEnd") {
      expect(turnEnd.stopReason).toBe("toolUse")
      expect(turnEnd.cacheRead).toBe(0)
      expect(turnEnd.cacheWrite).toBe(0)
      expect(turnEnd.model).toBe("glm-5.1")
      expect(turnEnd.provider).toBe("openai")
    }

    const tokenUsage = results.find(e => e._tag === "TokenUsage")
    expect(tokenUsage).toBeDefined()
    if (tokenUsage?._tag === "TokenUsage") {
      expect(tokenUsage.tokensIn).toBe(100)
      expect(tokenUsage.tokensOut).toBe(50)
    }
  })

  it("handles turn_end with no tool calls and no tool results", () => {
    const event: PiEvent = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        model: "glm-5.1",
        provider: "openai",
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
        stopReason: "stop"
      },
      toolResults: []
    }
    const currentStats = { inputTokens: 150, outputTokens: 80 }
    const results = mapTurnEndToEvents(runId, taskId, event, currentStats, lastStats)

    const toolCalls = results.filter(e => e._tag === "ToolCall")
    expect(toolCalls).toHaveLength(0)

    const toolResults = results.filter(e => e._tag === "ToolResult")
    expect(toolResults).toHaveLength(0)

    const turnEnd = results.find(e => e._tag === "TurnEnd")
    expect(turnEnd).toBeDefined()
    if (turnEnd?._tag === "TurnEnd") {
      expect(turnEnd.stopReason).toBe("stop")
    }
  })
})

describe("subscribePiEvents", () => {
  let sessionStats: { inputTokens: number; outputTokens: number }
  let handler: (event: PiEvent) => Effect.Effect<void, never, EventBus>

  beforeEach(() => {
    sessionStats = { inputTokens: 0, outputTokens: 0 }
    handler = subscribePiEvents("run-1", "task-1", () => sessionStats)
  })

  it("publishes LlmMessage on message_end with text content", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            model: "glm-5.1",
            provider: "openai"
          }
        }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const llmMsg = collected.find((e) => e._tag === "LlmMessage")
    expect(llmMsg).toBeDefined()
    if (llmMsg?._tag === "LlmMessage") {
      expect(llmMsg.text).toBe("Hello")
      expect(llmMsg.model).toBe("glm-5.1")
      expect(llmMsg.provider).toBe("openai")
    }
  })

  it("publishes LlmThinking on message_end with thinking content", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "Let me think..." }],
            model: "glm-5.1",
            provider: "openai"
          }
        }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const thinkingEvents = collected.filter((e) => e._tag === "LlmThinking")
    expect(thinkingEvents).toHaveLength(1)
  })

  it("publishes TurnEnd and TokenUsage on turn_end with computed deltas", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))

        sessionStats = { inputTokens: 100, outputTokens: 50 }
        yield* _(handler({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [],
            model: "glm-5.1",
            provider: "openai",
            usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
            stopReason: "stop"
          },
          toolResults: []
        }))

        sessionStats = { inputTokens: 250, outputTokens: 120 }
        yield* _(handler({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [],
            model: "glm-5.1",
            provider: "openai",
            usage: { input: 150, output: 70, cacheRead: 0, cacheWrite: 0, totalTokens: 220 },
            stopReason: "toolUse"
          },
          toolResults: []
        }))

        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const turnEnds = collected.filter((e) => e._tag === "TurnEnd")
    expect(turnEnds).toHaveLength(2)
    if (turnEnds[0]?._tag === "TurnEnd") {
      expect(turnEnds[0].tokensIn).toBe(100)
      expect(turnEnds[0].tokensOut).toBe(50)
    }
    if (turnEnds[1]?._tag === "TurnEnd") {
      expect(turnEnds[1].tokensIn).toBe(150)
      expect(turnEnds[1].tokensOut).toBe(70)
    }

    const tokenUsages = collected.filter((e) => e._tag === "TokenUsage")
    expect(tokenUsages).toHaveLength(2)
  })

  it("publishes ToolCall and ToolResult events from turn_end", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))

        sessionStats = { inputTokens: 100, outputTokens: 50 }
        yield* _(handler({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: "call-xyz", name: "ls", arguments: { path: "/tmp" } },
            ],
            model: "glm-5.1",
            provider: "openai",
            usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
            stopReason: "toolUse"
          },
          toolResults: [
            { role: "toolResult", toolCallId: "call-xyz", toolName: "ls", content: [{ type: "text", text: "file.txt" }], isError: false }
          ]
        }))

        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const toolCalls = collected.filter((e) => e._tag === "ToolCall")
    expect(toolCalls).toHaveLength(1)
    if (toolCalls[0]?._tag === "ToolCall") {
      expect(toolCalls[0].toolCallId).toBe("call-xyz")
      expect(toolCalls[0].tool).toBe("ls")
    }

    const toolResults = collected.filter((e) => e._tag === "ToolResult")
    expect(toolResults).toHaveLength(1)
    if (toolResults[0]?._tag === "ToolResult") {
      expect(toolResults[0].toolCallId).toBe("call-xyz")
      expect(toolResults[0].tool).toBe("ls")
    }
  })

  it("does not emit events for message_update", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "ignored" }
        }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))
    expect(collected).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/executors/pi/streaming.test.ts
```

Expected: FAIL — `mapMessageEndToEvent` and `mapTurnEndToEvents` not exported yet.

- [ ] **Step 3: Implement the new streaming code**

Replace `src/executors/pi/streaming.ts` entirely with:

```typescript
import { Effect } from "effect"
import { EventBus, type Event } from "../../events/bus.js"

export interface PiEvent {
  type: string
  assistantMessageEvent?: { type: string; delta?: string }
  message?: {
    role?: string
    content?: Array<{
      type: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      arguments?: unknown
    }>
    model?: string
    provider?: string
    api?: string
    usage?: {
      input: number
      output: number
      cacheRead?: number
      cacheWrite?: number
      totalTokens: number
    }
    stopReason?: string
  }
  toolResults?: Array<{
    role: string
    toolCallId: string
    toolName: string
    content?: Array<{ type: string; text?: string }>
    isError: boolean
  }>
  [key: string]: unknown
}

export function mapMessageEndToEvent(runId: string, taskId: string, event: PiEvent): Event[] {
  const content = event.message?.content
  if (!content || content.length === 0) return []

  const model = event.message?.model
  const provider = event.message?.provider

  const events: Event[] = []

  for (const block of content) {
    if (block.type === "text" && block.text && event.message?.role !== "toolResult") {
      events.push({ _tag: "LlmMessage", runId, taskId, text: block.text, model, provider })
    }
    if (block.type === "thinking" && block.thinking) {
      events.push({ _tag: "LlmThinking", runId, taskId, text: block.thinking, model, provider })
    }
  }

  return events
}

export function mapTurnEndToEvents(
  runId: string,
  taskId: string,
  event: PiEvent,
  currentStats: { inputTokens: number; outputTokens: number },
  lastStats: { inputTokens: number; outputTokens: number }
): Event[] {
  const events: Event[] = []

  const model = event.message?.model ?? "unknown"
  const provider = event.message?.provider ?? "unknown"
  const usage = event.message?.usage
  const stopReason = event.message?.stopReason ?? "unknown"
  const cacheRead = usage?.cacheRead ?? 0
  const cacheWrite = usage?.cacheWrite ?? 0

  for (const block of event.message?.content ?? []) {
    if (block.type === "toolCall" && block.id && block.name) {
      events.push({
        _tag: "ToolCall",
        runId,
        taskId,
        tool: block.name,
        input: block.arguments ?? {},
        toolCallId: block.id,
        model,
        provider
      })
    }
  }

  for (const result of event.toolResults ?? []) {
    events.push({
      _tag: "ToolResult",
      runId,
      taskId,
      tool: result.toolName,
      isError: result.isError,
      toolCallId: result.toolCallId
    })
  }

  const tokensIn = currentStats.inputTokens - lastStats.inputTokens
  const tokensOut = currentStats.outputTokens - lastStats.outputTokens

  events.push({
    _tag: "TurnEnd",
    runId,
    taskId,
    tokensIn,
    tokensOut,
    stopReason,
    cacheRead,
    cacheWrite,
    model,
    provider
  })

  events.push({
    _tag: "TokenUsage",
    runId,
    taskId,
    tokensIn,
    tokensOut
  })

  return events
}

export function subscribePiEvents(
  runId: string,
  taskId: string,
  getSessionStats: () => { inputTokens: number; outputTokens: number }
): (event: PiEvent) => Effect.Effect<void, never, EventBus> {
  let lastStats = { inputTokens: 0, outputTokens: 0 }

  return (event: PiEvent) =>
    Effect.gen(function* (_) {
      const bus = yield* _(EventBus)

      switch (event.type) {
        case "message_end": {
          const events = mapMessageEndToEvent(runId, taskId, event)
          for (const ev of events) {
            yield* _(bus.publish(ev))
          }
          break
        }
        case "turn_end": {
          const current = getSessionStats()
          const events = mapTurnEndToEvents(runId, taskId, event, current, lastStats)
          lastStats = current
          for (const ev of events) {
            yield* _(bus.publish(ev))
          }
          break
        }
      }
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/executors/pi/streaming.test.ts
```

Expected: ALL PASS.

- [ ] **Step 5: Run full test suite to catch regressions**

```bash
bun --bun vitest run
```

- [ ] **Step 6: Run build**

```bash
bun run build
```

Expected: tsc passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/executors/pi/streaming.ts tests/executors/pi/streaming.test.ts
git commit -m "feat: add mapMessageEndToEvent, mapTurnEndToEvents; remove message_update and tool_execution cases"
```

---

### Task 3: LSP Extension — Emit Diagnostic Events

**Files:**
- Modify: `src/executors/pi/extensions/lsp-autocheck-extension.ts:17-62`

- [ ] **Step 1: Update LSP extension code**

Replace the function signature and body of `createLspAutocheckExtension` (lines 17-62) in `src/executors/pi/extensions/lsp-autocheck-extension.ts`:

First add the Effect import at the top (line 1 currently imports from `@narumitw/pi-lsp`):

```typescript
import { Effect } from "effect"
import { EventBus } from "../../../events/bus.js"
```

Replace lines 17-62 with:

```typescript
export function createLspAutocheckExtension(bus: EventBus, runId: string, taskId: string): (pi: ExtensionAPI) => void {
  try {
    const { adapters, timeoutMs } = loadRuntime()
    if (adapters.length === 0) return () => {}

    return (pi: ExtensionAPI) => {
      pi.on("tool_result", async (event: ToolResultEvent) => {
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
          if (diagnosticsText) {
            Effect.runPromise(bus.publish({
              _tag: "LspDiagnostic",
              runId,
              taskId,
              filePath,
              text: diagnosticsText
            }))
          }

          if (!diagnosticsText) return undefined

          return {
            content: [
              { type: "text", text: `\n${diagnosticsText}\n` },
              ...event.content
            ]
          }
        } catch (err) {
          console.warn("[lsp-autocheck] diagnostics failed:", err)
          return undefined
        }
      })
    }
  } catch (err) {
    console.warn("[lsp-autocheck] loadRuntime failed:", err)
    return () => {}
  }
}
```

- [ ] **Step 2: Run build to verify types compile**

```bash
bun run build
```

Expected: tsc error on `pi-executor.ts` because `createLspAutocheckExtension()` is called without arguments. This is expected — we wire the bus in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/executors/pi/extensions/lsp-autocheck-extension.ts
git commit -m "feat: add bus parameter to createLspAutocheckExtension; emit LspDiagnostic events"
```

---

### Task 4: Wire EventBus to LSP Extension in pi-executor.ts

**Files:**
- Modify: `src/executors/pi/pi-executor.ts:136-139,217`

- [ ] **Step 1: Move LSP autocheck extension creation after bus is available**

Remove lines 136-139 in `src/executors/pi/pi-executor.ts`:

```typescript
    const lspEntry = extSettings.extensions?.find((e) => e.name === "lsp")
    if (lspEntry && lspEntry.enabled !== false && lspEntry.parameters?.autoCheck !== false) {
      extensionFactories.push(createLspAutocheckExtension())
    }
```

And add after line 217 (`const bus = yield* _(EventBus)`):

```typescript
    const lspEntry = extSettings.extensions?.find((e) => e.name === "lsp")
    if (lspEntry && lspEntry.enabled !== false && lspEntry.parameters?.autoCheck !== false) {
      extensionFactories.push(createLspAutocheckExtension(bus, config.runId, config.taskId))
    }
```

- [ ] **Step 2: Run build to verify types compile**

```bash
bun run build
```

Expected: tsc passes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "feat: wire EventBus to LSP autocheck extension"
```

---

### Task 5: Update formatForFile

**Files:**
- Modify: `src/observability/subscribers.ts:19-26`
- Modify: `tests/observability/subscribers.test.ts:39-53`

- [ ] **Step 1: Update formatForFile switch cases**

Replace lines 19-26 in `src/observability/subscribers.ts`:

```typescript
    case "LlmMessage":
      return { event: "llm_message", text: event.text, task_id: event.taskId, model: event.model, provider: event.provider }
    case "LlmThinking":
      return { event: "llm_thinking", text: event.text, task_id: event.taskId, model: event.model, provider: event.provider }
    case "ToolCall":
      return { event: "tool_call", tool: event.tool, input: event.input, task_id: event.taskId, tool_call_id: event.toolCallId, model: event.model, provider: event.provider }
    case "ToolResult":
      return { event: "tool_result", tool: event.tool, isError: event.isError, task_id: event.taskId, tool_call_id: event.toolCallId }
    case "TurnEnd":
      return { event: "turn_end", tokens_in: event.tokensIn, tokens_out: event.tokensOut, task_id: event.taskId, stop_reason: event.stopReason, cache_read: event.cacheRead, cache_write: event.cacheWrite, model: event.model, provider: event.provider }
```

Add after the `ModelSelected` case:

```typescript
    case "LspDiagnostic":
      return { event: "lsp_diagnostic", file_path: event.filePath, text: event.text, task_id: event.taskId }
```

- [ ] **Step 2: Update formatForFile test cases**

In `tests/observability/subscribers.test.ts`, replace lines 39-53 with:

```typescript
    {
      input: { _tag: "LlmMessage", runId: "r1", taskId: "t1", text: "hi", model: "glm-5.1", provider: "openai" },
      expected: { event: "llm_message", text: "hi", task_id: "t1", model: "glm-5.1", provider: "openai" },
    },
    {
      input: { _tag: "LlmThinking", runId: "r1", taskId: "t1", text: "let me think", model: "glm-5.1", provider: "openai" },
      expected: { event: "llm_thinking", text: "let me think", task_id: "t1", model: "glm-5.1", provider: "openai" },
    },
    {
      input: { _tag: "ToolCall", runId: "r1", taskId: "t1", tool: "bash", input: { cmd: "ls" }, toolCallId: "call-1", model: "glm-5.1", provider: "openai" },
      expected: { event: "tool_call", tool: "bash", input: { cmd: "ls" }, task_id: "t1", tool_call_id: "call-1", model: "glm-5.1", provider: "openai" },
    },
    {
      input: { _tag: "ToolResult", runId: "r1", taskId: "t1", tool: "bash", isError: false, toolCallId: "call-1" },
      expected: { event: "tool_result", tool: "bash", isError: false, task_id: "t1", tool_call_id: "call-1" },
    },
    {
      input: { _tag: "TurnEnd", runId: "r1", taskId: "t1", tokensIn: 10, tokensOut: 20, stopReason: "toolUse", cacheRead: 100, cacheWrite: 0, model: "glm-5.1", provider: "openai" },
      expected: { event: "turn_end", tokens_in: 10, tokens_out: 20, task_id: "t1", stop_reason: "toolUse", cache_read: 100, cache_write: 0, model: "glm-5.1", provider: "openai" },
    },
```

And add `TaskStarted`, `TaskCompleted`, `TaskFailed`, `TaskTimedOut`, `TaskRetrying`, `TaskPaused` test cases with missing `taskName` field:

Replace the `TaskStarted` case (line 12):

```typescript
    {
      input: { _tag: "TaskStarted", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_started", task_id: "t1" },
    },
```

Replace lines 13-34 (the task event cases) to include `taskName`:

```typescript
    {
      input: { _tag: "TaskCompleted", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_completed", task_id: "t1" },
    },
    {
      input: { _tag: "TaskFailed", runId: "r1", taskId: "t1", taskName: "test", message: "boom" },
      expected: { event: "task_failed", task_id: "t1", message: "boom" },
    },
    {
      input: { _tag: "TaskTimedOut", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_timed_out", task_id: "t1" },
    },
    {
      input: { _tag: "TaskRetrying", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_retrying", task_id: "t1" },
    },
    {
      input: { _tag: "TaskPaused", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_paused", task_id: "t1" },
    },
```

Add at the end of the cases array (before `]`):

```typescript
    {
      input: { _tag: "LspDiagnostic", runId: "r1", taskId: "t1", filePath: "/src/test.ts", text: "error: unused variable" },
      expected: { event: "lsp_diagnostic", file_path: "/src/test.ts", text: "error: unused variable", task_id: "t1" },
    },
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
bun --bun vitest run tests/observability/subscribers.test.ts
```

Expected: ALL PASS.

- [ ] **Step 4: Run build**

```bash
bun run build
```

Expected: tsc passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/observability/subscribers.ts tests/observability/subscribers.test.ts
git commit -m "feat: add LlmThinking, LspDiagnostic, enriched fields to formatForFile"
```

---

### Task 6: Update Telemetry Subscriber to Use toolCallId and stopReason

**Files:**
- Modify: `src/telemetry/subscriber.ts:21-22,44,51-52,60,74`

- [ ] **Step 1: Update telemetry subscriber code**

Remove the `buildCallId` function (lines 21-22):

```typescript
  const buildCallId = (runId: string, taskId: string, tool: string) =>
    runId + "-" + taskId + "-" + tool
```

Update the `TurnEnd` handler (line 44) — replace `"end_turn"` with `event.stopReason`:

```typescript
          stopReason: event.stopReason,
```

Update the `ToolCall` handler for `isPartialUpdate` (lines 50-55):

```typescript
      if (event._tag === "ToolCall" && event.isPartialUpdate) {
        return repos.toolCall.incrementPartialUpdates(event.toolCallId).pipe(
          Effect.catchAll(() => Effect.void)
        )
      }
```

Update the `ToolCall` handler for non-partial (lines 57-71) — replace `callId` with `event.toolCallId`:

```typescript
      if (event._tag === "ToolCall" && !event.isPartialUpdate) {
        const turnId = currentTurns.get(turnKey(event.runId, event.taskId))
        if (!turnId) return Effect.void
        const argsSummary = JSON.stringify(summarizeToolArgs(event.input))
        return repos.toolCall.insert({
          id: event.toolCallId,
          runId: event.runId,
          taskId: event.taskId,
          turnId,
          toolName: event.tool,
          argsSummary,
          startedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }
```

Update the `ToolResult` handler (lines 73-81):

```typescript
      if (event._tag === "ToolResult") {
        const resultSummary = "{}"
        return repos.toolCall.finish(event.toolCallId, {
          resultSummary,
          isError: event.isError,
          completedAt: new Date().toISOString()
        }).pipe(Effect.catchAll(() => Effect.void))
      }
```

- [ ] **Step 2: Update telemetry subscriber test**

In `tests/telemetry/subscriber.test.ts`, update the `TurnEnd` publish (line 65-71) to include required new fields:

```typescript
          yield* _(bus.publish({
            _tag: "TurnEnd",
            runId: "run-1",
            taskId: "task-1",
            tokensIn: 100,
            tokensOut: 200,
            stopReason: "toolUse",
            cacheRead: 0,
            cacheWrite: 0,
            model: "glm-5.1",
            provider: "openai"
          }))
```

Update the test assertion on stop_reason (line 81):

```typescript
    expect(row.stop_reason).toBe("toolUse")
```

Update the ToolCall publish (lines 110-116) to include `toolCallId`:

```typescript
          yield* _(bus.publish({
            _tag: "ToolCall",
            runId: "run-1",
            taskId: "task-1",
            tool: "bash",
            input: { command: "ls" },
            toolCallId: "call-bash"
          }))
```

Update the ToolResult publish (lines 117-123) to include `toolCallId`:

```typescript
          yield* _(bus.publish({
            _tag: "ToolResult",
            runId: "run-1",
            taskId: "task-1",
            tool: "bash",
            isError: false,
            toolCallId: "call-bash"
          }))
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
bun --bun vitest run tests/telemetry/subscriber.test.ts
```

Expected: ALL PASS.

- [ ] **Step 4: Run build**

```bash
bun run build
```

Expected: tsc passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/subscriber.ts tests/telemetry/subscriber.test.ts
git commit -m "feat: use event.toolCallId and event.stopReason in telemetry subscriber"
```

---

### Task 7: Full Test Suite and Build Verification

- [ ] **Step 1: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All 155+ tests pass. If any failures, fix before continuing.

- [ ] **Step 2: Run build**

```bash
bun run build
```

Expected: tsc passes with no errors.

- [ ] **Step 3: Final review**

```bash
git diff --stat HEAD~6..HEAD
```

Verify all 6 commits touch the expected files and nothing unexpected slipped in.
