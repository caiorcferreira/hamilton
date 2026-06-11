import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit, Scope } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import { makeTurnRepository } from "../../src/telemetry/repositories/turn-repository.js"
import { makeToolCallRepository } from "../../src/telemetry/repositories/tool-call-repository.js"
import { makeProviderRequestRepository } from "../../src/telemetry/repositories/provider-request-repository.js"
import { TelemetrySubscriber } from "../../src/telemetry/subscriber.js"
import { EventBus, EventBusLive } from "../../src/events/bus.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-sub-"))
  const dbPath = Path.join(dir, "test.db")
  const db = new Database(dbPath)
  ;(db as any)._tempDir = dir
  migrate(db)
  return db
}

function cleanupDb(db: Database) {
  const dir = (db as any)._tempDir as string
  db.close()
  if (dir) Fs.rmSync(dir, { recursive: true, force: true })
}

describe("TelemetrySubscriber", () => {
  let db: Database

  beforeEach(() => {
    db = tempDb()
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("writes turn rows on TurnStarted + TurnEnd events", async () => {
    const turnRepo = makeTurnRepository(db)
    const tcRepo = makeToolCallRepository(db)
    const prRepo = makeProviderRequestRepository(db)
    const shouldWrite = () => true

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(TelemetrySubscriber({
            turn: turnRepo,
            toolCall: tcRepo,
            providerRequest: prRepo,
            shouldWrite
          }))
          yield* _(Effect.sleep("5 millis"))
          yield* _(bus.publish({
            _tag: "TurnStarted",
            runId: "run-1",
            taskId: "task-1",
            turnId: "turn-1",
            turnIndex: 0,
            timestamp: "2026-01-01T00:00:00Z"
          }))
          yield* _(bus.publish({
            _tag: "TurnEnd",
            runId: "run-1",
            taskId: "task-1",
            tokensIn: 100,
            tokensOut: 200
          }))
          yield* _(Effect.sleep("5 millis"))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    const row = db.prepare("SELECT * FROM turns WHERE id = ?").get("turn-1") as any
    expect(row).not.toBeNull()
    expect(row.turn_index).toBe(0)
    expect(row.stop_reason).toBe("end_turn")
    expect(row.tool_result_count).toBe(0)
  })

  it("writes tool_call row on ToolCall + ToolResult events", async () => {
    const turnRepo = makeTurnRepository(db)
    const tcRepo = makeToolCallRepository(db)
    const prRepo = makeProviderRequestRepository(db)
    const shouldWrite = () => true

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(TelemetrySubscriber({
            turn: turnRepo,
            toolCall: tcRepo,
            providerRequest: prRepo,
            shouldWrite
          }))
          yield* _(Effect.sleep("5 millis"))
          yield* _(bus.publish({
            _tag: "TurnStarted",
            runId: "run-1",
            taskId: "task-1",
            turnId: "turn-1",
            turnIndex: 0,
            timestamp: "2026-01-01T00:00:00Z"
          }))
          yield* _(bus.publish({
            _tag: "ToolCall",
            runId: "run-1",
            taskId: "task-1",
            tool: "bash",
            input: { command: "ls" }
          }))
          yield* _(bus.publish({
            _tag: "ToolResult",
            runId: "run-1",
            taskId: "task-1",
            tool: "bash",
            isError: false
          }))
          yield* _(Effect.sleep("5 millis"))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    const rows = db.prepare("SELECT * FROM tool_calls").all() as any[]
    expect(rows.length).toBe(1)
    expect(rows[0].tool_name).toBe("bash")
    expect(rows[0].completed_at).not.toBeNull()
  })

  it("honors shouldWrite = false (db disabled)", async () => {
    const turnRepo = makeTurnRepository(db)
    const tcRepo = makeToolCallRepository(db)
    const prRepo = makeProviderRequestRepository(db)
    const shouldWrite = () => false

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(TelemetrySubscriber({
            turn: turnRepo,
            toolCall: tcRepo,
            providerRequest: prRepo,
            shouldWrite
          }))
          yield* _(Effect.sleep("5 millis"))
          yield* _(bus.publish({
            _tag: "TurnStarted",
            runId: "run-1",
            taskId: "task-1",
            turnId: "turn-1",
            turnIndex: 0,
            timestamp: "now"
          }))
          yield* _(Effect.sleep("5 millis"))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    const rows = db.prepare("SELECT * FROM turns").all() as any[]
    expect(rows.length).toBe(0)
  })
})
