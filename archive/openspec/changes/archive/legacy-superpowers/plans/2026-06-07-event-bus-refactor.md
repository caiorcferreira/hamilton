# EventBus Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace callback-based event plumbing (`onLog`, `onTokenEvent`, `onTokenUsage`, `onEvent`) with a unified Effect PubSub-backed EventBus. Three single-responsibility subscribers (FileLogger, DbWriter, CliRenderer) consume filtered event streams.

**Architecture:** A single `EventBus` service backed by `PubSub.unbounded<Event>()`. Subscribers use `createSubscriber(selector, handler)` which patterns `Effect.gen` + `forkScoped` + `Stream.tap` + `catchAll`. The `runWorkflow` effect provides `EventBusLive` and forks subscribers. The run-state-machine is unchanged — it handles its own DB state transitions. DbWriter handles only token-tracking (`insertTokenEvent`).

**Tech Stack:** TypeScript, Effect 3.21.3, `bun:sqlite`, vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/events/bus.ts` | Create | Event types, EventBus service, EventBusLive, createSubscriber |
| `src/observability/subscribers.ts` | Create | FileLogger subscriber |
| `src/db/subscribers.ts` | Create | DbWriter subscriber |
| `src/cli/subscribers.ts` | Create | CliRenderer subscriber |
| `src/observability/streaming.ts` | Modify | Remove SubscribeConfig, publish EventBus events directly |
| `src/agent/pi-executor.ts` | Modify | Remove onTokenUsage from config, inject EventBus |
| `src/workflow/runner.ts` | Modify | Remove onEvent/WorkflowEvent/emit, use EventBus, fork DbWriter |
| `src/cli/commands/run.ts` | Modify | Remove onEvent/formatEvent, wire FileLogger+CliRenderer |
| `src/cli/commands/resume.ts` | Modify | Remove onEvent callback |
| `tests/events/bus.test.ts` | Create | EventBus + createSubscriber unit tests |
| `tests/observability/subscribers.test.ts` | Create | FileLogger tests |
| `tests/db/subscribers.test.ts` | Create | DbWriter tests |
| `tests/cli/subscribers.test.ts` | Create | CliRenderer tests |
| `tests/observability/streaming.test.ts` | Modify | Update for new EventBus-based API |
| `tests/workflow/runner.test.ts` | Modify | Remove onEvent, provide EventBusLive |
| `tests/workflow/runner-regression.test.ts` | Modify | Remove onEvent, provide EventBusLive |
| `tests/cli/run.test.ts` | Modify | Provide EventBusLive |
| `tests/e2e/workflows.test.ts` | Modify | Remove onEvent, provide EventBusLive |

---

### Task 1: Create EventBus core (`src/events/bus.ts`)

**Files:**
- Create: `src/events/bus.ts`
- Create: `tests/events/bus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/events/bus.test.ts
import { describe, it, expect } from "vitest"
import { Effect, PubSub, Stream, Exit } from "effect"
import { Event, EventBus, EventBusLive, EventBusSubscriptionOperations, SubscriptionSelector, createSubscriber } from "../../src/events/bus.js"

describe("EventBus", () => {
  describe("publish + subscribeAll", () => {
    it("delivers published events to subscribeAll", async () => {
      const collected: Event[] = []

      const program = Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)

          const subscriber = bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
          const fiber = yield* _(Effect.forkScoped(subscriber))

          yield* _(bus.publish({ _tag: "WorkflowStarted", runId: "r1" }))
          yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "s1" }))
          yield* _(Effect.sleep("50 millis"))

          yield* _(Effect.fiberInterrupt(fiber))
        })
      )

      await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(EventBusLive)))

      expect(collected).toHaveLength(2)
      expect(collected[0]._tag).toBe("WorkflowStarted")
      expect(collected[1]._tag).toBe("StepStarted")
    })
  })

  describe("subscribeTo", () => {
    it("filters events by tag", async () => {
      const collected: Event[] = []

      const program = Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)

          const subscriber = bus.subscribeTo("TokenUsage").pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
          const fiber = yield* _(Effect.forkScoped(subscriber))

          yield* _(bus.publish({ _tag: "WorkflowStarted", runId: "r1" }))
          yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", stepId: "s1", tokensIn: 100, tokensOut: 50 }))
          yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "s1" }))
          yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", stepId: "s1", tokensIn: 200, tokensOut: 100 }))
          yield* _(Effect.sleep("50 millis"))

          yield* _(Effect.fiberInterrupt(fiber))
        })
      )

      await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(EventBusLive)))

      expect(collected).toHaveLength(2)
      expect(collected.every((e) => e._tag === "TokenUsage")).toBe(true)
      expect(collected[0]).toEqual({ _tag: "TokenUsage", runId: "r1", stepId: "s1", tokensIn: 100, tokensOut: 50 })
    })
  })
})

describe("createSubscriber", () => {
  it("calls handler for each matching event", async () => {
    const collected: string[] = []

    const testSubscriber = createSubscriber(
      ((bus: EventBusSubscriptionOperations) => bus.subscribeTo("StepStarted")) as SubscriptionSelector<Extract<Event, { _tag: "StepStarted" }>>,
      (event) => Effect.sync(() => collected.push(event.stepId))
    )

    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* testSubscriber
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "step-a" }))
        yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "step-b" }))
        yield* _(bus.publish({ _tag: "StepCompleted", runId: "r1", stepId: "step-a" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    expect(collected).toEqual(["step-a", "step-b"])
  })

  it("isolates handler errors so one failure does not stop the subscriber", async () => {
    const collected: string[] = []

    const testSubscriber = createSubscriber(
      (bus: EventBusSubscriptionOperations) => bus.subscribeAll,
      (event) => {
        if (event._tag === "StepStarted" && event.stepId === "fail-here") {
          return Effect.fail(new Error("boom"))
        }
        return Effect.sync(() => collected.push(event._tag))
      }
    )

    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* testSubscriber
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "fail-here" }))
        yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "step-b" }))
        yield* _(bus.publish({ _tag: "StepCompleted", runId: "r1", stepId: "step-c" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    expect(collected).toEqual(["StepStarted", "StepCompleted"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/events/bus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/events/bus.ts
import { Effect, PubSub, Stream, Context, Layer, Scope } from "effect"

export type Event =
  | { readonly _tag: "WorkflowStarted"; readonly runId: string }
  | { readonly _tag: "StepStarted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepCompleted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepFailed"; readonly runId: string; readonly stepId: string; readonly message: string }
  | { readonly _tag: "StepTimedOut"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepRetrying"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepPaused"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string }
  | { readonly _tag: "LlmMessage"; readonly runId: string; readonly stepId: string; readonly text: string }
  | { readonly _tag: "ToolCall"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly input: unknown }
  | { readonly _tag: "ToolResult"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly isError: boolean }
  | { readonly _tag: "TurnEnd"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "TokenUsage"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "PromptBuilt"; readonly runId: string; readonly stepId: string; readonly systemPrompt: string; readonly taskPrompt: string }

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
  Effect.gen(function* (_) {
    const pubsub = yield* _(PubSub.unbounded<Event>())

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
    } as EventBus["Service"]
  })
)

export type SubscriptionSelector<E extends Event> =
  (bus: EventBusSubscriptionOperations) => Stream.Stream<E>

export const createSubscriber = <E extends Event>(
  select: SubscriptionSelector<E>,
  handler: (event: E) => Effect.Effect<void>
): Effect.Effect<void, never, Scope | EventBus> =>
  Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    yield* _(Effect.forkScoped(
      select(bus).pipe(
        Stream.tap((event) => handler(event).pipe(Effect.catchAll(() => Effect.void))),
        Stream.runDrain
      )
    ))
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/events/bus.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/events/bus.ts tests/events/bus.test.ts
git commit -m "feat: add EventBus service with PubSub-backed publish/subscribe"
```

---

### Task 2: Create FileLogger subscriber (`src/observability/subscribers.ts`)

**Files:**
- Create: `src/observability/subscribers.ts`
- Create: `tests/observability/subscribers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/observability/subscribers.test.ts
import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { EventBus, EventBusLive } from "../../src/events/bus.js"
import { FileLogger } from "../../src/observability/subscribers.js"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

describe("FileLogger", () => {
  it("writes step-scoped events to appendStepLog via JSONL", async () => {
    const tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-filelogger-"))
    const origHome = process.env.HOME
    process.env.HOME = tmpHome

    try {
      Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "runs", "r1", "logs"), { recursive: true })

      const program = Effect.scoped(
        Effect.gen(function* (_) {
          yield* FileLogger
          yield* _(Effect.sleep("10 millis"))
          const bus = yield* _(EventBus)
          yield* _(bus.publish({ _tag: "LlmMessage", runId: "r1", stepId: "s1", text: "hello" }))
          yield* _(bus.publish({ _tag: "ToolCall", runId: "r1", stepId: "s1", tool: "bash", input: { cmd: "ls" } }))
          yield* _(Effect.sleep("50 millis"))
        })
      )

      await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

      const logPath = Path.join(tmpHome, ".hamilton", "runs", "r1", "logs", "s1.jsonl")
      const content = Fs.readFileSync(logPath, "utf-8").trim().split("\n")
      expect(content).toHaveLength(2)

      const e1 = JSON.parse(content[0]!)
      expect(e1.event).toBe("llm_message")
      expect(e1.text).toBe("hello")

      const e2 = JSON.parse(content[1]!)
      expect(e2.event).toBe("tool_call")
      expect(e2.tool).toBe("bash")
    } finally {
      process.env.HOME = origHome
      Fs.rmSync(tmpHome, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/observability/subscribers.test.ts`
Expected: FAIL — `FileLogger` not exported

- [ ] **Step 3: Write minimal implementation**

```ts
// src/observability/subscribers.ts
import { Effect } from "effect"
import { Event, createSubscriber } from "../events/bus.js"
import { appendStepLog } from "./run-dir.js"

export const FileLogger = createSubscriber(
  (bus) => bus.subscribeAll,
  (event: Event) => {
    if ("stepId" in event && event.stepId) {
      return appendStepLog(event.runId, event.stepId, formatForFile(event)).pipe(
        Effect.catchAll(() => Effect.void)
      )
    }
    return Effect.void
  }
)

function formatForFile(event: Event): Record<string, unknown> {
  switch (event._tag) {
    case "LlmMessage":
      return { event: "llm_message", text: event.text, step_id: event.stepId }
    case "ToolCall":
      return { event: "tool_call", tool: event.tool, input: event.input, step_id: event.stepId }
    case "ToolResult":
      return { event: "tool_result", tool: event.tool, isError: event.isError, step_id: event.stepId }
    case "TurnEnd":
      return { event: "turn_end", tokens_in: event.tokensIn, tokens_out: event.tokensOut, step_id: event.stepId }
    case "TokenUsage":
      return { event: "token_usage", tokens_in: event.tokensIn, tokens_out: event.tokensOut, step_id: event.stepId }
    default:
      return { ...event }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/observability/subscribers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/observability/subscribers.ts tests/observability/subscribers.test.ts
git commit -m "feat: add FileLogger subscriber"
```

---

### Task 3: Create DbWriter subscriber (`src/db/subscribers.ts`)

**Files:**
- Create: `src/db/subscribers.ts`
- Create: `tests/db/subscribers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/subscribers.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { EventBus, EventBusLive } from "../../src/events/bus.js"
import { createSchema } from "../../src/db/schema.js"

function getTokenEvents(database: Database, runId: string): { tokens_in: number; tokens_out: number }[] {
  return database.prepare("SELECT tokens_in, tokens_out FROM token_events WHERE run_id = ? ORDER BY timestamp").all(runId) as any[]
}

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-dbw-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

import { DbWriter } from "../../src/db/subscribers.js"

describe("DbWriter", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
    createSchema(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("writes TokenUsage events to the database", async () => {
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* DbWriter(db)
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", stepId: "s1", tokensIn: 100, tokensOut: 50 }))
        yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", stepId: "s1", tokensIn: 150, tokensOut: 75 }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const events = getTokenEvents(db, "r1")
    expect(events).toHaveLength(2)
    expect(events[0].tokens_in).toBe(100)
    expect(events[0].tokens_out).toBe(50)
    expect(events[1].tokens_in).toBe(150)
    expect(events[1].tokens_out).toBe(75)
  })

  it("ignores non-TokenUsage events", async () => {
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* DbWriter(db)
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "s1" }))
        yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", stepId: "s1", tokensIn: 10, tokensOut: 5 }))
        yield* _(bus.publish({ _tag: "StepCompleted", runId: "r1", stepId: "s1" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const events = getTokenEvents(db, "r1")
    expect(events).toHaveLength(1)
    expect(events[0].tokens_in).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/db/subscribers.test.ts`
Expected: FAIL — `DbWriter` not exported

- [ ] **Step 3: Write minimal implementation**

```ts
// src/db/subscribers.ts
import { Effect } from "effect"
import { Database } from "bun:sqlite"
import { Event, createSubscriber, EventBus, Scope } from "../events/bus.js"
import { insertTokenEvent } from "./queries.js"

export const DbWriter = (db: Database): Effect.Effect<void, never, Scope | EventBus> =>
  createSubscriber(
    (bus) => bus.subscribeAll,
    (event: Event) => {
      if (event._tag === "TokenUsage") {
        return Effect.sync(() =>
          insertTokenEvent(db, event.runId, event.stepId, "completion", event.tokensIn, event.tokensOut)
        )
      }
      return Effect.void
    }
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/db/subscribers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/subscribers.ts tests/db/subscribers.test.ts
git commit -m "feat: add DbWriter subscriber"
```

---

### Task 4: Create CliRenderer subscriber (`src/cli/subscribers.ts`)

**Files:**
- Create: `src/cli/subscribers.ts`
- Create: `tests/cli/subscribers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/subscribers.test.ts
import { describe, it, expect, vi } from "vitest"
import { Effect, Console } from "effect"
import { EventBus, EventBusLive } from "../../src/events/bus.js"
import { CliRenderer } from "../../src/cli/subscribers.js"

describe("CliRenderer", () => {
  it("prints formatted events to console", async () => {
    const logs: string[] = []
    const logLayer = Console.withConsole(
      Console.make({
        log: (s) => logs.push(s)
      })
    )

    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* CliRenderer
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "WorkflowStarted", runId: "r1" }))
        yield* _(bus.publish({ _tag: "StepStarted", runId: "r1", stepId: "s1" }))
        yield* _(bus.publish({ _tag: "StepCompleted", runId: "r1", stepId: "s1" }))
        yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: "r1" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(
      program.pipe(
        Effect.provide(EventBusLive),
        Effect.provide(logLayer)
      )
    )

    expect(logs[0]).toContain("r1")
    expect(logs[1]).toContain("s1")
    expect(logs.some((l) => l.includes("completed"))).toBe(true)
    expect(logs.some((l) => l.includes("finished"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/cli/subscribers.test.ts`
Expected: FAIL — `CliRenderer` not exported

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/subscribers.ts
import { Effect, Console } from "effect"
import { Event, createSubscriber } from "../events/bus.js"

function formatEvent(event: Event): string {
  switch (event._tag) {
    case "WorkflowStarted":
      return `Workflow started [${event.runId}]`
    case "StepStarted":
      return `  Step ${event.stepId} started`
    case "StepCompleted":
      return `  Step ${event.stepId} completed`
    case "StepFailed":
      return `  Step ${event.stepId} failed: ${event.message}`
    case "StepTimedOut":
      return `  Step ${event.stepId} timed out`
    case "StepRetrying":
      return `  Step ${event.stepId} retrying...`
    case "StepPaused":
      return `  Step ${event.stepId} paused`
    case "WorkflowCompleted":
      return `Workflow finished`
    default:
      return ""
  }
}

export const CliRenderer = createSubscriber(
  (bus) => bus.subscribeAll,
  (event: Event) => {
    const line = formatEvent(event)
    if (line) {
      return Console.log(line)
    }
    return Effect.void
  }
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/cli/subscribers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/subscribers.ts tests/cli/subscribers.test.ts
git commit -m "feat: add CliRenderer subscriber"
```

---

### Task 5: Refactor `subscribePiEvents` to publish via EventBus

**Files:**
- Modify: `src/observability/streaming.ts`
- Modify: `tests/observability/streaming.test.ts`

- [ ] **Step 1: Write the updated tests**

```ts
// tests/observability/streaming.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Exit, Stream } from "effect"
import { subscribePiEvents, type PiEvent } from "../../src/observability/streaming.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"

describe("subscribePiEvents", () => {
  let sessionStats: { inputTokens: number; outputTokens: number }
  let handler: (event: PiEvent) => Effect.Effect<void, never, EventBus>

  beforeEach(() => {
    sessionStats = { inputTokens: 0, outputTokens: 0 }
    handler = subscribePiEvents("run-1", "step-1", () => sessionStats)
  })

  it("publishes ToolCall event on tool_execution_start", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        const fiber = yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } }))
        yield* _(Effect.sleep("50 millis"))
        yield* _(Effect.fiberInterrupt(fiber))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    expect(collected).toHaveLength(1)
    expect(collected[0]._tag).toBe("ToolCall")
    if (collected[0]._tag === "ToolCall") {
      expect(collected[0].tool).toBe("bash")
    }
  })

  it("publishes LlmMessage event on message_end with buffered text", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        const fiber = yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } }))
        yield* _(handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } }))
        yield* _(handler({ type: "message_end" }))
        yield* _(Effect.sleep("50 millis"))
        yield* _(Effect.fiberInterrupt(fiber))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const llmMsg = collected.find((e) => e._tag === "LlmMessage")
    expect(llmMsg).toBeDefined()
    if (llmMsg?._tag === "LlmMessage") {
      expect(llmMsg.text).toBe("Hello world")
    }
  })

  it("publishes TurnEnd and TokenUsage on turn_end with computed deltas", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        const fiber = yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))

        sessionStats = { inputTokens: 100, outputTokens: 50 }
        yield* _(handler({ type: "turn_end" }))

        sessionStats = { inputTokens: 250, outputTokens: 120 }
        yield* _(handler({ type: "turn_end" }))

        yield* _(Effect.sleep("50 millis"))
        yield* _(Effect.fiberInterrupt(fiber))
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
    if (tokenUsages[0]?._tag === "TokenUsage") {
      expect(tokenUsages[0].tokensIn).toBe(100)
    }
    if (tokenUsages[1]?._tag === "TokenUsage") {
      expect(tokenUsages[1].tokensIn).toBe(250)
    }
  })

  it("resets buffer on tool_execution_start", async () => {
    const collected: Event[] = []
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        const bus = yield* _(EventBus)
        const fiber = yield* _(Effect.forkScoped(
          bus.subscribeAll.pipe(
            Stream.tap((e) => Effect.sync(() => collected.push(e))),
            Stream.runDrain
          )
        ))
        yield* _(Effect.sleep("10 millis"))
        yield* _(handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Some text" } }))
        yield* _(handler({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } }))
        yield* _(handler({ type: "message_end" }))
        yield* _(Effect.sleep("50 millis"))
        yield* _(Effect.fiberInterrupt(fiber))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const llmMsgs = collected.filter((e) => e._tag === "LlmMessage")
    expect(llmMsgs).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/observability/streaming.test.ts`
Expected: FAIL — type errors / missing EventBus context

- [ ] **Step 3: Rewrite `subscribePiEvents` implementation**

```ts
// src/observability/streaming.ts
import { Effect } from "effect"
import { Event, EventBus } from "../events/bus.js"

export interface PiEvent {
  type: string
  toolName?: string
  toolCallId?: string
  args?: unknown
  isError?: boolean
  assistantMessageEvent?: { type: string; delta?: string }
  message?: { content?: Array<{ type: string; text?: string }> }
  result?: unknown
  [key: string]: unknown
}

export function subscribePiEvents(
  runId: string,
  stepId: string,
  getSessionStats: () => { inputTokens: number; outputTokens: number }
): (event: PiEvent) => Effect.Effect<void, never, EventBus> {
  let buffer = ""
  let lastStats = { inputTokens: 0, outputTokens: 0 }

  return (event: PiEvent) =>
    Effect.gen(function* (_) {
      const bus = yield* _(EventBus)

      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
            buffer += event.assistantMessageEvent.delta
          }
          break
        case "message_end":
          if (buffer) {
            const text = buffer
            buffer = ""
            yield* _(bus.publish({ _tag: "LlmMessage", runId, stepId, text }))
          }
          break
        case "tool_execution_start":
          buffer = ""
          yield* _(
            bus.publish({
              _tag: "ToolCall",
              runId,
              stepId,
              tool: event.toolName ?? "unknown",
              input: event.args ?? {}
            })
          )
          break
        case "tool_execution_end":
          yield* _(
            bus.publish({
              _tag: "ToolResult",
              runId,
              stepId,
              tool: event.toolName ?? "unknown",
              isError: event.isError ?? false
            })
          )
          break
        case "turn_end":
          const current = getSessionStats()
          const tokensIn = current.inputTokens - lastStats.inputTokens
          const tokensOut = current.outputTokens - lastStats.outputTokens
          lastStats = current

          yield* _(bus.publish({ _tag: "TurnEnd", runId, stepId, tokensIn, tokensOut }))
          yield* _(bus.publish({ _tag: "TokenUsage", runId, stepId, tokensIn, tokensOut }))
          break
      }
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/observability/streaming.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/observability/streaming.ts tests/observability/streaming.test.ts
git commit -m "refactor: rewrite subscribePiEvents to publish via EventBus"
```

---

### Task 6: Refactor `pi-executor.ts` to use EventBus

**Files:**
- Modify: `src/agent/pi-executor.ts`

- [ ] **Step 1: Build to verify current code compiles**

Run: `bun run build`
Expected: PASS (this confirms baseline)

- [ ] **Step 2: Remove `onTokenUsage` from `PiExecutorConfig` and update `executeWithPi`**

In `src/agent/pi-executor.ts`:

Remove `onTokenUsage` from the `PiExecutorConfig` interface (line 38):
```
// Remove this line:
  onTokenUsage?: (tokensIn: number, tokensOut: number) => void
```

Replace the `subscribePiEvents` call (lines 150-172) with:

```ts
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
```

Remove the import of `appendStepLog` from line 14:
```ts
// Remove this line:
import { appendStepLog } from "../observability/run-dir.js"
```

The final `executeWithPi` signature stays the same. Only the internal wiring changes.

- [ ] **Step 3: Build to verify it compiles**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Run all tests to verify no regressions**

Run: `bun --bun vitest run`
Expected: existing tests may fail due to runner/run changes — expected at this stage

- [ ] **Step 5: Commit**

```bash
git add src/agent/pi-executor.ts
git commit -m "refactor: remove onTokenUsage callback, use EventBus in pi-executor"
```

---

### Task 7: Refactor `runner.ts` to use EventBus

**Files:**
- Modify: `src/workflow/runner.ts`
- Modify: `tests/workflow/runner.test.ts`
- Modify: `tests/workflow/runner-regression.test.ts`

- [ ] **Step 1: Write updated runner tests**

```ts
// tests/workflow/runner.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import type { WorkflowSpec } from "../../src/types.js"
import { WorkflowSlug, AgentSlug, StepSlug } from "../../src/types.js"
import { EventBus, EventBusLive } from "../../src/events/bus.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

const testSpec: WorkflowSpec = {
  slug: "test-flow" as WorkflowSlug,
  name: "Test Flow",
  version: 1,
  agents: [
    { slug: "agent-a" as AgentSlug, role: "coding" as const, workspace: { baseDir: ".", files: {} } }
  ],
  steps: [
    { slug: "step-1" as StepSlug, agent: "agent-a" as AgentSlug, input: "Do something" },
    { slug: "step-2" as StepSlug, agent: "agent-a" as AgentSlug, input: "Do another thing" }
  ]
}

describe("runWorkflow", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-runner-"))
    process.env.HOME = tmpHome

    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "agents", "agent-a"), { recursive: true })
    Fs.writeFileSync(Path.join(hh, "agents", "agent-a", "AGENTS.md"), "Test agent")

    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes all steps and returns completed", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(testSpec, { task: "test" }, {
          workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
        }).pipe(Effect.provide(EventBusLive))
      )
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults["step-1"]).toBe("done")
      expect(result.value.stepResults["step-2"]).toBe("done")
    }
  })

  it("fails when persona not found", async () => {
    const specNoAgent: WorkflowSpec = {
      ...testSpec,
      agents: [
        { slug: "no-such-agent" as AgentSlug, role: "coding" as const, workspace: { baseDir: ".", files: {} } }
      ],
      steps: [
        { slug: "step-1" as StepSlug, agent: "no-such-agent" as AgentSlug, input: "Do something" }
      ]
    }

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(specNoAgent, { task: "test" }, {
          workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
        }).pipe(Effect.provide(EventBusLive))
      )
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Write updated runner-regression tests**

```ts
// tests/workflow/runner-regression.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import type { WorkflowSpec } from "../../src/types.js"
import { WorkflowSlug, AgentSlug, StepSlug } from "../../src/types.js"
import { EventBus, EventBusLive } from "../../src/events/bus.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

const testSpec: WorkflowSpec = {
  slug: "test-flow" as WorkflowSlug,
  name: "Test Flow",
  version: 1,
  agents: [
    { slug: "agent-a" as AgentSlug, role: "coding" as const, workspace: { baseDir: ".", files: {} } }
  ],
  steps: [
    { slug: "step-1" as StepSlug, agent: "agent-a" as AgentSlug, input: "Do something" }
  ]
}

describe("runWorkflow regression tests", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-regression-"))
    process.env.HOME = tmpHome

    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "agents", "agent-a"), { recursive: true })
    Fs.writeFileSync(Path.join(hh, "agents", "agent-a", "AGENTS.md"), "Test agent")

    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("emits prompt_built event with system_prompt and task_prompt", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(testSpec, { task: "test" }, {
          workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
        }).pipe(Effect.provide(EventBusLive))
      )
    )

    expect(Exit.isSuccess(result)).toBe(true)

    const logDir = Path.join(tmpHome, ".hamilton", "runs")
    const runDirs = Fs.readdirSync(logDir)
    expect(runDirs.length).toBeGreaterThan(0)

    const runId = runDirs[0]!
    const logsDir = Path.join(logDir, runId, "logs")
    const logFiles = Fs.readdirSync(logsDir).filter(f => f.endsWith(".jsonl"))
    expect(logFiles.length).toBeGreaterThan(0)

    for (const lf of logFiles) {
      const content = Fs.readFileSync(Path.join(logsDir, lf), "utf-8")
      for (const line of content.trim().split("\n")) {
        if (!line.trim()) continue
        const parsed = JSON.parse(line)
        if (parsed._tag === "PromptBuilt") {
          expect(parsed).toHaveProperty("systemPrompt")
          expect(parsed).toHaveProperty("taskPrompt")
          expect(typeof parsed.systemPrompt).toBe("string")
          expect(typeof parsed.taskPrompt).toBe("string")
          expect(parsed.systemPrompt.length).toBeGreaterThan(0)
          return
        }
      }
    }
  })

  it("emits workflow_started as first event", async () => {
    await Effect.runPromise(
      Effect.scoped(
        runWorkflow(testSpec, { task: "test" }, {
          workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
        }).pipe(Effect.provide(EventBusLive))
      )
    )

    const logDir = Path.join(tmpHome, ".hamilton", "runs")
    const runDirs = Fs.readdirSync(logDir)
    const runId = runDirs[0]!
    const eventsPath = Path.join(logDir, runId, "events.jsonl")
    const content = Fs.readFileSync(eventsPath, "utf-8").trim().split("\n")
    const firstEvent = JSON.parse(content[0]!)
    expect(firstEvent.event).toBe("workflow_started")
  })

  it("records token events in the database", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(testSpec, { task: "test" }, {
          workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
        }).pipe(Effect.provide(EventBusLive))
      )
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const { Database } = require("bun:sqlite")
      const db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
      const rows = db.prepare("SELECT * FROM token_events WHERE run_id = ?").all(result.value.runId)
      db.close()
      expect(rows.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun --bun vitest run tests/workflow/runner.test.ts tests/workflow/runner-regression.test.ts`
Expected: FAIL — type errors from `onEvent` removal

- [ ] **Step 4: Rewrite runner.ts**

Remove the following from `src/workflow/runner.ts`:

1. Remove `WorkflowEvent` interface (lines 23-30)
2. Remove `onEvent` from `WorkflowRunnerConfig` (line 33)
3. Remove `emit` helper function (lines 46-51)
4. Remove `import { insertTokenEvent, updateStepCompleted } from "../db/queries.js"` (line 20)

Remove `appendStepLog` from the run-dir import (line 14-19), leaving:
```ts
import {
  createRunDir,
  writeInput,
  writeStepOutput,
  writeSummary,
  appendEngineLog
} from "../observability/run-dir.js"
```

Remove `import { Ref } from "effect"` from line 1 — keep `Effect, Schedule, Duration` only

Add import:
```ts
import { EventBus } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"
```

Replace every `emit(config.onEvent, ...)` call with `bus.publish(...)`. The mapping:

| Old | New |
|---|---|
| `emit(config.onEvent, { type: "workflow_started", runId })` | `bus.publish({ _tag: "WorkflowStarted", runId })` |
| `emit(config.onEvent, { type: "step_started", runId, stepId })` | `bus.publish({ _tag: "StepStarted", runId, stepId })` |
| `emit(config.onEvent, { type: "step_completed", runId, stepId })` | `bus.publish({ _tag: "StepCompleted", runId, stepId })` |
| `emit(config.onEvent, { type: "step_timeout", runId, stepId, message: "..." })` | `bus.publish({ _tag: "StepTimedOut", runId, stepId })` |
| `emit(config.onEvent, { type: "step_retry", runId, stepId, message: "..." })` | `bus.publish({ _tag: "StepRetrying", runId, stepId })` |
| `emit(config.onEvent, { type: "step_paused", runId, stepId, message: "..." })` | `bus.publish({ _tag: "StepPaused", runId, stepId })` |
| `emit(config.onEvent, { type: "workflow_completed", runId })` | `bus.publish({ _tag: "WorkflowCompleted", runId })` |
| Error catchAll: `emit(config.onEvent, { type: "workflow_completed", runId, message: String(error) })` | `bus.publish({ _tag: "WorkflowCompleted", runId, message: String(error) })` |

Remove the `tokenRef` and its usage (lines 93, 115, 198-199):
```ts
// Remove this line:
const tokenRef = yield* _(Ref.make({ in: 0, out: 0 }))
```
```ts
// Remove this line (before each step):
yield* _(Ref.set(tokenRef, { in: 0, out: 0 }))
```
```ts
// Remove this callback (lines 198-199):
onTokenUsage: (tokensIn, tokensOut) =>
  Ref.update(tokenRef, (prev) => ({ in: prev.in + tokensIn, out: prev.out + tokensOut }))
```

Remove the token DB write block (lines 227-232):
```ts
// Remove these lines:
const stepTokens = yield* _(Ref.get(tokenRef))
const compoundId = ctx.compoundStepIds.get(stepSlug) ?? stepSlug

yield* _(Effect.sync(() => {
  insertTokenEvent(ctx.db, runId, compoundId, "completion", stepTokens.in, stepTokens.out)
}).pipe(Effect.catchAll(() => Effect.void)))
```

Replace the `appendStepLog({ event: "prompt_built", ... })` call (line 175) with:
```ts
yield* _(bus.publish({
  _tag: "PromptBuilt",
  runId,
  stepId,
  systemPrompt: prompt.systemPrompt,
  taskPrompt: prompt.taskPrompt
}))
```

Remove all remaining `appendStepLog` direct calls for step completion/retry — these are now handled by FileLogger via bus events:
```ts
// Remove: yield* _(appendStepLog(runId, stepId, { event: "completed" }))
// Remove: yield* _(appendStepLog(runId, stepId, { event: "retry" }))
```

Add `DbWriter` fork after `ctx.db` is available (after line 76, after `const runId = ctx.runId`). Add `const bus = yield* _(EventBus)` near the top of the `body` effect:
```ts
const bus = yield* _(EventBus)
yield* _(DbWriter(ctx.db))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun --bun vitest run tests/workflow/runner.test.ts tests/workflow/runner-regression.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/runner.test.ts tests/workflow/runner-regression.test.ts
git commit -m "refactor: replace onEvent callback with EventBus in runner"
```

---

### Task 8: Refactor CLI commands to wire subscribers

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/resume.ts`
- Modify: `tests/cli/run.test.ts`
- Modify: `tests/cli/resume.test.ts`

- [ ] **Step 1: Write updated `run.test.ts`**

```ts
// tests/cli/run.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { executeRun } from "../../src/cli/commands/run.js"
import { PiExecutionError } from "../../src/agent/pi-executor.js"
import { EventBusLive } from "../../src/events/bus.js"
import { FileLogger } from "../../src/observability/subscribers.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {
      constructor(props: { stepId: string; message: string }) {
        super(props.message)
        this.name = "PiExecutionError"
      }
    }
  }
})

const validYaml = `slug: test-wf
name: Test Workflow
version: 1
agents:
  - slug: agent-1
    role: coding
    workspace:
      baseDir: .
      files: {}
steps:
  - slug: step-1
    agent: agent-1
    input: "Do the thing"
`

describe("executeRun", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-run-"))
    process.env.HOME = tmpHome

    const wfDir = Path.join(tmpHome, ".hamilton", "workflows", "test-wf")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), validYaml)

    const agentDir = Path.join(tmpHome, ".hamilton", "agents", "agent-1")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "Test agent")
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes a workflow and returns completed result", async () => {
    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "test-wf",
        prompt: "Fix the bug"
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const r = result.value
      expect(r.status).toBe("completed")
      expect(r.stepResults["step-1"]).toBe("done")
      expect(typeof r.runId).toBe("string")
      expect(r.runId).toContain("test-wf")
    }
  })

  it("returns failed status when executeWithPi fails", async () => {
    const { executeWithPi } = await import("../../src/agent/pi-executor.js")
    vi.mocked(executeWithPi).mockImplementationOnce(
      () => Effect.fail(new PiExecutionError({ stepId: "step-1", message: "agent error" }))
    )

    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "test-wf",
        prompt: "Fix the bug"
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("failed")
    }
  })

  it("fails when workflow slug does not exist", async () => {
    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "nonexistent",
        prompt: "Fix the bug"
      })
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Update `run.ts` — rewrite `executeRun`**

```ts
// src/cli/commands/run.ts
import { Args, Command } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import { workflowsDir, hamiltonHome, runDir } from "../../paths.js"
import { resolveWorkflowSlug } from "../../workflow/resolver.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow } from "../../workflow/runner.js"
import type { WorkflowSpec as WfSpec } from "../../types.js"
import { EventBusLive } from "../../events/bus.js"
import { FileLogger } from "../../observability/subscribers.js"

export interface RunParams {
  workflowSlug: string
  prompt: string
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
}

export function executeRun(params: RunParams): Effect.Effect<RunResult, Error> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new Error('Hamilton is not initialized. Run "hamilton init" first.')))
    }
    const wfDir = workflowsDir()
    const availableSlugs = yield* _(
      Effect.try({
        try: () => {
          if (!Fs.existsSync(wfDir)) return [] as string[]
          return Fs.readdirSync(wfDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        },
        catch: () => [] as string[]
      }).pipe(Effect.orElseSucceed(() => [] as string[]))
    )

    const resolvedSlug = resolveWorkflowSlug(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug)

    const result = yield* _(
      runWorkflow(spec as unknown as WfSpec, { task: params.prompt }, {
        workflowsDir: wfDir
      }).pipe(
        Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
      )
    )

    return {
      runId: result.runId,
      status: result.status,
      stepResults: result.stepResults
    }
  })
}

const slug = Args.text({ name: "slug" })
const prompt = Args.text({ name: "prompt" }).pipe(Args.repeated)

export const runCommand = Command.make("run", { slug, prompt }, ({ slug, prompt }) =>
  Effect.gen(function* (_) {
    const promptText = prompt.join(" ")
    const result = yield* _(
      Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            yield* FileLogger
            return yield* executeRun({ workflowSlug: slug, prompt: promptText })
          }).pipe(Effect.provide(EventBusLive))
        )
      )
    )
    if (Exit.isFailure(result)) {
      yield* Console.error(`Workflow failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Run ID: ${result.value.runId}`)
    yield* Console.log(`Status: ${result.value.status}`)
    for (const [step, status] of Object.entries(result.value.stepResults)) {
      yield* Console.log(`  ${step}: ${status}`)
    }
  })
).pipe(Command.withDescription("Run a workflow"))
```

- [ ] **Step 3: Update `resume.ts`**

In `src/cli/commands/resume.ts`, update the `runWorkflow` call to remove `onEvent`:

```ts
    const result = yield* _(
      runWorkflow(spec as unknown as WorkflowSpec, context, {
        workflowsDir: wfDir
      }, runId).pipe(
        Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
      )
    )
```

Remove the import of `WorkflowEvent` and `runWorkflow` from runner if they are no longer needed. Add `EventBusLive` and `FileLogger` wiring:

```ts
import { EventBusLive } from "../../events/bus.js"
import { FileLogger } from "../../observability/subscribers.js"
```

Wrap the `runWorkflow` call:
```ts
    const result = yield* _(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          return yield* runWorkflow(spec as unknown as WorkflowSpec, context, {
            workflowsDir: wfDir
          }, runId).pipe(
            Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
          )
        }).pipe(Effect.provide(EventBusLive))
      )
    )
```

- [ ] **Step 4: Run the CLI tests**

Run: `bun --bun vitest run tests/cli/run.test.ts tests/cli/resume.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/run.ts src/cli/commands/resume.ts tests/cli/run.test.ts tests/cli/resume.test.ts
git commit -m "refactor: wire FileLogger+EventBus in CLI commands, remove onEvent"
```

---

### Task 9: Update e2e test

**Files:**
- Modify: `tests/e2e/workflows.test.ts`

- [ ] **Step 1: Update the e2e test**

```ts
// tests/e2e/workflows.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec } from "../../src/workflow/loader.js"
import { runWorkflow } from "../../src/workflow/runner.js"
import { workflowsDir, runDir } from "../../src/paths.js"
import { EventBus, EventBusLive } from "../../src/events/bus.js"

const stepResponses: Record<string, Record<string, unknown>> = {
  triage: { status: "done", repo: "/tmp/test-repo", branch: "bugfix-login", severity: "high", affected_area: "src/auth.ts", reproduction: "open /login", problem_statement: "race condition in session" },
  investigate: { status: "done", root_cause: "session expiry race condition", fix_approach: "add mutex around session update" },
  setup: { status: "done", build_cmd: "npm run build", test_cmd: "npm test", baseline: "all pass" },
  fix: { status: "done", changes: "added mutex", regression_test: "test/session-race.test.ts" },
  verify: { status: "done", verified: "fix confirmed correct" }
}

vi.mock("../../src/agent/pi-executor.js", () => ({
  executeWithPi: vi.fn((config: { stepId: string }) => {
    const slug = Object.keys(stepResponses).find((k) => config.stepId.includes(k)) ?? config.stepId
    return Effect.succeed(stepResponses[slug] ?? { status: "done" })
  }),
  PiExecutionError: class PiExecutionError extends Error {}
}))

describe("end-to-end workflow execution", () => {
  let testHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-e2e-" + Date.now())
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("completes the bug-fix workflow with mock agents", async () => {
    const wfSrc = Path.join(process.cwd(), "workflows", "bug-fix")
    const wfDest = Path.join(workflowsDir(), "bug-fix")
    Fs.mkdirSync(wfDest, { recursive: true })
    Fs.cpSync(wfSrc, wfDest, { recursive: true })

    const spec = await Effect.runPromise(loadWorkflowSpec(workflowsDir(), "bug-fix"))

    for (const agent of spec.agents) {
      const agentDir = Path.join(testHome, ".hamilton", "agents", agent.slug)
      Fs.mkdirSync(agentDir, { recursive: true })
      Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "You are a " + agent.role + " agent")
      Fs.writeFileSync(Path.join(agentDir, "IDENTITY.md"), "Name: " + agent.slug)
      Fs.writeFileSync(Path.join(agentDir, "SOUL.md"), "Professional")
    }

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runWorkflow(spec, { task: "fix login bug" }, {
          workflowsDir: wfDest
        }).pipe(Effect.provide(EventBusLive))
      )
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const r = result.value
      expect(r.status).toBe("completed")
      expect(r.stepResults).toHaveProperty("triage")
      expect(r.stepResults).toHaveProperty("investigate")
      expect(r.stepResults).toHaveProperty("setup")
      expect(r.stepResults).toHaveProperty("fix")
      expect(r.stepResults).toHaveProperty("verify")

      expect(r.context).toHaveProperty("repo")
      expect(r.context).toHaveProperty("root_cause")

      const rd = runDir(r.runId)
      expect(Fs.existsSync(Path.join(rd, "input.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "summary.json"))).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the e2e test**

Run: `bun --bun vitest run tests/e2e/workflows.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/workflows.test.ts
git commit -m "refactor: update e2e test to use EventBus"
```

---

### Task 10: Full regression run

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun --bun vitest run`
Expected: all 155+ tests PASS

- [ ] **Step 2: Run build to verify compilation**

Run: `bun run build`
Expected: PASS with no errors

- [ ] **Step 3: Commit if any final fixes were needed**

```bash
git add -A
git commit -m "chore: final cleanup for EventBus refactor"
```
