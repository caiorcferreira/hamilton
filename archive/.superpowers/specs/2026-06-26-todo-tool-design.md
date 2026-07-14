# Todo/Task Tracking Tool — Design Spec

**Date:** 2026-06-26
**Status:** approved

## Goal

Add a `todowrite` tool to the agent for tracking sub-steps within a single workflow task. Mimics opencode/claude-code's `todowrite` behavior: the agent passes a full task list each call, and the tool validates constraints.

## Scope

No new files. Types added to `src/types.ts`, events added to `src/events/bus.ts`, tool registered inside `src/executors/pi/extensions/workflow-extension.ts`, subscribers updated.

---

## Architecture

The tool lives inside the existing `workflow-extension.ts` alongside `write_task_output` and `git_diff`. It registers via `pi.registerTool(defineTool({...}))` inside `createWorkflowExtension`. An in-memory `Map<string, TodoItem[]>` keyed by `taskId` scoped to the Pi session stores the list. On each call the agent passes the full array — the tool validates constraints and either accepts it or returns an error.

Events are published to the Hamilton EventBus so existing observability subscribers can record todo changes.

```
Agent calls todowrite([...]) 
  → tool handler validates
    → on success: store in Map, publish TodoListUpdated, return ok
    → on constraint violation: publish TodoConstraintError, return error
    → on malformed input: return error (no event)
```

## Types

```typescript
// src/types.ts
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TodoPriority = "high" | "medium" | "low"

export interface TodoItem {
  content: string
  status: TodoStatus
  priority: TodoPriority
}
```

## Events

```typescript
// src/events/bus.ts — additions to Event union
| { readonly _tag: "TodoListUpdated"; readonly runId: string; readonly taskId: string; readonly todos: TodoItem[] }
| { readonly _tag: "TodoConstraintError"; readonly runId: string; readonly taskId: string; readonly message: string }
```

## Tool Handler

Inside `createWorkflowExtension`, registers `todowrite`:

- **Input**: array of `{ content: string, status: TodoStatus, priority: TodoPriority }`
- **Validation rules**:
  - Input must be an array (not null, not object)
  - Every item must have non-empty `content`, valid `status` enum, valid `priority` enum
  - Exactly one item with `status: "in_progress"`, OR zero if all items are `completed` or `cancelled`
- **On success**: stores list in session-scoped `Map`, publishes `TodoListUpdated`, returns confirmation
- **On constraint violation**: publishes `TodoConstraintError` with explanation (e.g. "Expected exactly 1 in_progress item, found 2"), returns error message to agent
- **On malformed input**: returns descriptive error with expected schema, no event emitted
- **In-memory only**: the Map dies with the Pi session, no cleanup needed

## Prompt Snippet

```text
- todowrite: track your sub-steps as a structured task list. Pass the FULL array each call. Each item has: content (string), status ("pending"|"in_progress"|"completed"|"cancelled"), priority ("high"|"medium"|"low"). Exactly ONE item must be in_progress at a time (or zero if all done). Use when the task has 3+ distinct steps. Skip for single straightforward actions.
```

Injected via `promptSnippet` on the Pi SDK `ToolDefinition`. Appears automatically in the Pi SDK-generated tool list in the system prompt (existing `appendSystemPrompt` path).

## Subscribers

### FileLogger (`src/observability/subscribers.ts`)

No code changes needed. Both `TodoListUpdated` and `TodoConstraintError` carry `taskId`, so the existing `subscribeAll` + `appendTaskLog` path fires. The `formatForFile` default case (line 54) serializes unknown event types to snake_case JSON automatically.

### DbWriter (`src/db/subscribers.ts`)

Adds handler for `TodoListUpdated`: stores the todo list JSON in the `workflow_state` table under key `todo_list:<taskId>` via existing `setWorkflowState`. `TodoConstraintError` is not persisted to DB — the error already appears in the tool result JSONL log, and storing validation errors would create noise.

No schema migration needed — reuses the existing `workflow_state` table.

## Extension Wiring (`src/executors/pi/pi-executor.ts`)

`createWorkflowExtension` gains an `EventBus` parameter so the tool handler can publish events. The bus is already yielded from the Effect context at line 119, right before the extension is created. Pass it through:

```typescript
createWorkflowExtension(
  config.runId,
  config.taskId,
  config.outputSchema,
  () => { sessionRef?.abort().catch(() => { }) },
  bus  // new
)
```

## Testing strategy

- `tests/executors/pi/extensions/workflow-extension.test.ts`: new tests for todowrite validation (single in_progress constraint, valid enums, malformed input, empty content rejection)
- `tests/db/subscribers.test.ts`: verify `TodoListUpdated` event writes to `workflow_state`
- `tests/observability/subscribers.test.ts`: verify `TodoListUpdated` and `TodoConstraintError` appear in JSONL output
