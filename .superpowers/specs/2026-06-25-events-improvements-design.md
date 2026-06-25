# Events Improvements Design

## Context

The Pi SDK has changed its event structure. `turn_end` now carries the full assistant message (with tool calls, usage, model, provider, stop reason) plus a `toolResults` array. `message_end` carries the full message content block(s) with model/provider metadata. The Hamilton event system needs to adapt to extract richer data from these Pi events.

## Event Type Changes (`src/events/bus.ts`)

Add new fields to existing event types:

| Event | New Fields |
|-------|-----------|
| `LlmMessage` | `model?: string`, `provider?: string` |
| `ToolCall` | `toolCallId: string`, `model?: string`, `provider?: string` |
| `ToolResult` | `toolCallId: string` |
| `TurnEnd` | `stopReason: string`, `cacheRead: number`, `cacheWrite: number`, `model: string`, `provider: string` |

Add new event types:

| Event | Fields |
|-------|--------|
| `LlmThinking` | `_tag: "LlmThinking"`, `runId: string`, `taskId: string`, `text: string`, `model?: string`, `provider?: string` |
| `LspDiagnostic` | `_tag: "LspDiagnostic"`, `runId: string`, `taskId: string`, `filePath: string`, `text: string` |

## Stream Event Processing (`src/executors/pi/streaming.ts`)

Remove the `message_update` case entirely. No buffers remain.

Remove the `tool_execution_start` and `tool_execution_end` cases from the switch.

### `mapMessageEndToEvent(event): Event[]`

Extract content blocks from `event.message.content[]`:

- If content block is `type: "text"` and role is `"assistant"` → `LlmMessage` with `text` from the block
- If content block is `type: "thinking"` → `LlmThinking` with `thinking` text from the block
- Both events include `model` and `provider` from `event.message`

### `mapTurnEndToEvents(event): Event[]`

- For each `toolCall` block in `event.message.content[]` → `ToolCall` with `toolCallId` from the block, `model`/`provider` from `event.message`
- For each entry in `event.toolResults[]` → `ToolResult` with `toolCallId`, `tool`, `isError` from the entry
- `TurnEnd` with `stopReason`, `cacheRead`, `cacheWrite`, `model`, `provider` from `event.message.usage` and `event.message`
- `TokenUsage` with token delta calculation (unchanged: uses `getSessionStats()`)

The `subscribePiEvents` switch handles only `message_end` (delegates to `mapMessageEndToEvent`) and `turn_end` (delegates to `mapTurnEndToEvents`). All events from both helpers are published via `EventBus`.

Keep the existing `getSessionStats` parameter and token delta tracking for `TokenUsage`.

The `PiEvent` interface is updated to expose the fields needed by the helpers: `message`, `message.content`, `message.usage`, `message.api`, `message.provider`, `message.model`, `message.stopReason`, `toolResults`.

## LSP Diagnostic Events (`src/executors/pi/extensions/lsp-autocheck-extension.ts`)

`createLspAutocheckExtension` gains a required parameter: `bus: EventBus`.

When diagnostics are found (non-zero count), the extension publishes an `LspDiagnostic` event via `Effect.runPromise(bus.publish({...}))`. The existing behavior of prepending diagnostic text to the tool result content is preserved — event emission is additive, not a replacement.

The extension call site in `src/executors/pi/pi-executor.ts` moves from line 138 to after `const bus = yield* _(EventBus)` (line 217) so the bus is available. The call becomes `extensionFactories.push(createLspAutocheckExtension(bus))`.

## Subscriber Updates

### `src/observability/subscribers.ts`

`formatForFile` gains:
- `LlmThinking` case: `{ event: "llm_thinking", text, task_id, model, provider }`
- `LspDiagnostic` case: `{ event: "lsp_diagnostic", file_path, text, task_id }`
- `ToolCall` gains `tool_call_id`, `model`, `provider` fields
- `ToolResult` gains `tool_call_id` field
- `TurnEnd` gains `stop_reason`, `cache_read`, `cache_write`, `model`, `provider` fields
- `LlmMessage` gains `model`, `provider` fields


### `src/telemetry/subscriber.ts`

- `ToolCall` handler: use `event.toolCallId` directly as the call ID instead of building a synthetic `runId + "-" + taskId + "-" + tool`
- `ToolResult` handler: use `event.toolCallId` directly as the call ID
- `TurnEnd` handler: pass `event.stopReason` to `repos.turn.finish` instead of hardcoded `"end_turn"`

### Other subscribers

`src/cli/subscribers.ts` and `src/db/subscribers.ts` need no changes — they handle only `WorkflowStarted`, `TaskStarted`, `TaskCompleted`, `TaskFailed`, `TaskTimedOut`, `TaskRetrying`, `TaskPaused`, `WorkflowCompleted`, `TokenUsage`, and `ModelSelected`.

## Files Changed

- `src/events/bus.ts` — event type definitions
- `src/executors/pi/streaming.ts` — Pi event processing, helpers, remove old cases
- `src/executors/pi/extensions/lsp-autocheck-extension.ts` — bus parameter, diagnostic events
- `src/executors/pi/pi-executor.ts` — wire bus to LSP extension
- `src/observability/subscribers.ts` — `formatForFile` cases
- `src/telemetry/subscriber.ts` — use `toolCallId`, pass `stopReason`

## Not in Scope

- `TurnStarted`, `ProviderRequestStarted`, `ModelSelected` events (existing dead events, not touched)
- CLI renderer changes (unaffected)
- DB subscriber changes (unaffected)
- Compaction events or other Pi extension behaviors
- Any buffer mechanism (none remain after `message_update` removal)
