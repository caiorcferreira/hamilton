# Refactor Event Architecture to Use Effect Event Bus

## Motivation

The current event plumbing is callback-based and tightly coupled:

- `SubscribeConfig` passes `onLog` and `onTokenEvent` callbacks directly into `subscribePiEvents`
- `pi-executor.ts` wires `onLog` → `appendStepLog`, `onTokenEvent` → both `appendStepLog` + optional `onTokenUsage`
- `runner.ts` passes `onEvent` callback for CLI/observability events
- `run.ts` formats `onEvent` calls into `Console.log`
- Token tracking uses a `Ref` updated via `onTokenUsage`, then flushed to DB with `insertTokenEvent` at step completion

This makes it hard to add/remove subscribers (e.g., a future WebSocket UI or metrics exporter) and makes event handling difficult to test in isolation.

**Goal:** Replace callback chains with a single unified Effect PubSub-backed EventBus. Decouple `onLog`, `onTokenEvent`, `onTokenUsage`, and `WorkflowEvent` callbacks into single-responsibility subscribers (file logger, DB writer, CLI renderer) that consume filtered event streams.

## Decision Log

| Decision | Rationale |
|---|---|
| Single unified bus for all events (workflow lifecycle + Pi streaming) | One source of truth, simpler than two buses. Future subscribers get everything from one place. |
| Filtered subscriptions via `subscribeTo(tag)` | Subscribers only receive events they care about. Cleaner subscriber code. |
| PubSub-backed, Stream-level filtering (not multi-PubSub routing) | Simplest, most idiomatic Effect. Performance gap negligible at this event volume. |
| Fire-and-forget isolation | A crashed subscriber never affects other subscribers or the publisher. No propagation. |
| `forkScoped` for subscriber lifecycle | Subscribers run in forked fibers, cleaned up when the parent Scope closes. No Layer ceremony. |
| `createSubscriber` abstraction for boilerplate reduction | All subscribers share the `Effect.gen` + `forkScoped` + `Stream.tap` + `catchAll` pattern. |

## Event Taxonomy

```ts
type Event =
  // ── Workflow lifecycle (replaces WorkflowEvent) ──
  | { readonly _tag: "WorkflowStarted"; readonly runId: string }
  | { readonly _tag: "StepStarted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepCompleted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepFailed"; readonly runId: string; readonly stepId: string; readonly message: string }
  | { readonly _tag: "StepTimedOut"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepRetrying"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepPaused"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string }

  // ── Pi streaming events (replaces onLog/onTokenEvent) ──
  | { readonly _tag: "LlmMessage"; readonly runId: string; readonly stepId: string; readonly text: string }
  | { readonly _tag: "ToolCall"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly input: unknown }
  | { readonly _tag: "ToolResult"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly isError: boolean }
  | { readonly _tag: "TurnEnd"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "TokenUsage"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }

  // ── Internal bookkeeping ──
  | { readonly _tag: "PromptBuilt"; readonly runId: string; readonly stepId: string; readonly systemPrompt: string; readonly taskPrompt: string }
```

- `StepFailed` replaces the unnamed error path where runner emitted `workflow_completed` with an error. Now a first-class event.
- `TokenUsage` is kept separate from `TurnEnd` — `TurnEnd` is per-turn logging, `TokenUsage` is the cumulative signal for DB/token-tracking. Different subscribers care about different ones.
- Every event carries `runId` and `stepId` where applicable.

## EventBus Service

```ts
// src/events/bus.ts

import { Effect, PubSub, Stream, Context, Layer } from "effect"

export type Event = /* ... as above ... */

export type EventBusSubscriptionOperations = {
  readonly subscribeAll: Stream.Stream<Event>
  readonly subscribeTo: <T extends Event["_tag"]>(
    tag: T
  ) => Stream.Stream<Extract<Event, { readonly _tag: T }>>
}

export class EventBus extends Context.Tag("EventBus")<
  EventBus,
  {
    readonly publish: (event: Event) => Effect.Effect<void>
  } & EventBusSubscriptionOperations
>() {}

export const EventBusLive = Layer.scoped(
  EventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<Event>()

    return {
      publish: (event) => PubSub.publish(pubsub, event),
      subscribeAll: Stream.fromPubSub(pubsub),
      subscribeTo: <T extends Event["_tag"]>(tag: T) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter(
            (event): event is Extract<Event, { readonly _tag: T }> =>
              event._tag === tag
          )
        )
    }
  })
)
```

## Subscriber Abstraction

```ts
// src/events/bus.ts

export type SubscriptionSelector<E extends Event> =
  (bus: EventBusSubscriptionOperations) => Stream.Stream<E>

export const createSubscriber = <E extends Event>(
  select: SubscriptionSelector<E>,
  handler: (event: E) => Effect.Effect<void>
): Effect.Effect<void, never, Scope | EventBus> =>
  Effect.gen(function* () {
    const bus = yield* EventBus
    yield* Effect.forkScoped(
      select(bus).pipe(
        Stream.tap((event) => handler(event).pipe(Effect.catchAll(() => Effect.void))),
        Stream.runDrain
      )
    )
  })
```

## Subscribers

### FileLogger — `src/observability/subscribers.ts`

- Calls `appendStepLog` for every event (JSONL to step log file)
- Subscribes via `subscribeAll`
- Replaces scattered `appendStepLog` calls across runner and pi-executor

### DbWriter — `src/db/subscribers.ts`

- Handles all DB-side effects for step lifecycle and token tracking
- Subscribes via `subscribeAll` and dispatches internally on `_tag` (single fiber maintains event order)
- Handles events: `"StepStarted"`, `"StepCompleted"`, `"StepFailed"`, `"TokenUsage"`
- Replaces direct `insertTokenEvent` and `updateStepCompleted` calls in runner
- Gets `Database` via Effect service context (runner provides it via `DatabaseService` or equivalent)

### CliRenderer — `src/cli/subscribers.ts`

- Formats and prints events to `Console.log` for CLI output
- Subscribes to `"WorkflowStarted"`, `"StepStarted"`, `"StepCompleted"`, `"StepFailed"`, `"StepTimedOut"`, `"StepRetrying"`, `"StepPaused"`, `"WorkflowCompleted"`
- Replaces `formatEvent` + `onEvent` callback in `run.ts`

## Data Flow

```
pi-executor.ts → bus.publish(LlmMessage) / bus.publish(TurnEnd)
runner.ts      → bus.publish(StepStarted) / bus.publish(StepCompleted) / etc.
streaming.ts   → parse PiEvent → bus.publish(Event)

                  ┌──────────┐
                  │ EventBus │
                  └────┬─────┘
           ┌───────────┼───────────┐
           ▼           ▼           ▼
     FileLogger    DbWriter    CliRenderer
```

### Per-File Changes

**Modified: `src/observability/streaming.ts`**
- Remove `SubscribeConfig` interface (previously held `onLog`/`onTokenEvent` callbacks)
- `subscribePiEvents` receives `EventBus` from Effect context, publishes `Event`s directly instead of calling callbacks

**Modified: `src/agent/pi-executor.ts`**
- Remove `onTokenUsage` from `PiExecutorConfig`
- Get `EventBus` from Effect service context
- Pass bus to `subscribePiEvents`

**Modified: `src/workflow/runner.ts`**
- Remove `onEvent` from `WorkflowRunnerConfig`
- Delete `WorkflowEvent` type and `emit` helper
- Replace all `emit(config.onEvent, ...)` with `bus.publish(...)`
- Remove `Ref`-based token tracking and direct `insertTokenEvent` calls (DbWriter subscriber handles it)
- Get `EventBus` from Effect service context

**Modified: `src/cli/commands/run.ts`**
- Remove `onEvent` callback construction and `formatEvent` function
- CliRenderer subscriber handles all CLI output

**Modified: `src/cli/commands/resume.ts`**
- Same treatment as `run.ts` — remove `onEvent` wiring

### Wiring at the Call Site

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    yield* FileLogger
    yield* DbWriter
    yield* CliRenderer
    yield* runWorkflow(spec, context, config)
  })
)

program.pipe(Effect.provide(EventBusLive))
```

In MCP/programmatic mode, `CliRenderer` is simply omitted from the wiring.

## Error Isolation

Each subscriber's per-event handler is wrapped with `Effect.catchAll` inside `createSubscriber`. A single bad event (e.g., DB write failure) is silently dropped for that subscriber. The subscriber fiber stays alive. A subscriber fiber dying catastrophically (fiber crash, not per-event error) is acceptable — it is not restarted.

## Unchanged Files

- `src/observability/run-dir.ts` — `appendStepLog`, `appendEngineLog`, `writeStepOutput`, `writeSummary` remain unchanged; FileLogger and runner call them
- `src/db/queries.ts` — `insertTokenEvent`, `updateStepCompleted`, etc. remain unchanged; DbWriter calls them
- `src/observability/logger.ts` — Effect-level logger, orthogonal to this change
- `src/workflow/engine.ts`, `src/workflow/context.ts`, `src/workflow/loader.ts`, `src/workflow/resolver.ts`, `src/workflow/run-state-machine.ts` — not affected
- `src/agent/persona.ts`, `src/agent/config.ts`, `src/agent/activity.ts`, `src/agent/rtk-extension.ts`, `src/agent/write-step-output-tool.ts` — not affected

## Testing Strategy

- Unit tests for each subscriber: provide a mock `EventBus` with a manual `PubSub`, publish events, assert side effects
- `subscribePiEvents` test: verify it parses Pi events into the correct `Event` shape and publishes
- `EventBus` service test: verify `subscribeTo` filtering delivers only matching tagged events
- Runner tests: update to provide `EventBusLive`, assert events are published (not callback invocations)
- `createSubscriber` test: verify error isolation (handler throwing does not kill the fiber)
