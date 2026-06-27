import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { EventBus, EventBusLive } from "../../src/events/bus.js"
import { createSchema } from "../../src/db/schema.js"
import { DbWriter } from "../../src/db/subscribers.js"

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
        yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", taskId: "s1", tokensIn: 100, tokensOut: 50 }))
        yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", taskId: "s1", tokensIn: 150, tokensOut: 75 }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const events = db.prepare("SELECT tokens_in, tokens_out FROM token_events WHERE run_id = ? ORDER BY timestamp").all("r1") as any[]
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
        yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "s1" }))
        yield* _(bus.publish({ _tag: "TokenUsage", runId: "r1", taskId: "s1", tokensIn: 10, tokensOut: 5 }))
        yield* _(bus.publish({ _tag: "TaskCompleted", runId: "r1", taskId: "s1" }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const events = db.prepare("SELECT tokens_in FROM token_events WHERE run_id = ?").all("r1") as any[]
    expect(events).toHaveLength(1)
    expect(events[0].tokens_in).toBe(10)
  })

  it("ignores TokenUsage events without runId", async () => {
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* DbWriter(db)
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({ _tag: "TokenUsage", tokensIn: 100, tokensOut: 50 }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const events = db.prepare("SELECT COUNT(*) as count FROM token_events").get() as any
    expect(events.count).toBe(0)
  })

  it("stores TodoListUpdated events in workflow_state", async () => {
    const program = Effect.scoped(
      Effect.gen(function* (_) {
        yield* DbWriter(db)
        yield* _(Effect.sleep("10 millis"))
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "TodoListUpdated",
          runId: "r1",
          taskId: "t1",
          todos: [
            { content: "write tests", status: "completed", priority: "high" },
            { content: "implement feature", status: "in_progress", priority: "high" }
          ]
        }))
        yield* _(Effect.sleep("50 millis"))
      })
    )

    await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

    const row = db.prepare("SELECT value FROM workflow_state WHERE run_id = ? AND key = ?").get("r1", "todo_list:t1") as { value: string } | null
    expect(row).not.toBeNull()
    const parsed = JSON.parse(row!.value)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].content).toBe("write tests")
    expect(parsed[0].status).toBe("completed")
    expect(parsed[1].content).toBe("implement feature")
    expect(parsed[1].status).toBe("in_progress")
  })
})