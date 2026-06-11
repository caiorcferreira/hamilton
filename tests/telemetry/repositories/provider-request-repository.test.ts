import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../../src/db/migrations.js"
import { makeProviderRequestRepository, ProviderRequestRepository } from "../../../src/telemetry/repositories/provider-request-repository.js"

function tempDb(): Database {
  const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-pr-"))
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

describe("ProviderRequestRepository", () => {
  let db: Database
  let repo: ProviderRequestRepository

  beforeEach(() => {
    db = tempDb()
    repo = makeProviderRequestRepository(db)
  })

  afterEach(() => {
    cleanupDb(db)
  })

  it("insert creates a row in provider_requests table", async () => {
    const exit = await Effect.runPromiseExit(
      repo.insert({
        id: "pr-1",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        provider: "openai",
        model: "gpt-5.1",
        payloadSummary: JSON.stringify({ type: "array", bytes: 500, lines: 10 }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM provider_requests WHERE id = ?").get("pr-1") as any
    expect(row.provider).toBe("openai")
    expect(row.model).toBe("gpt-5.1")
    expect(row.payload_summary).toContain("500")
    expect(row.status_code).toBeNull()
    expect(row.tokens_in).toBe(0)
    expect(row.completed_at).toBeNull()
  })

  it("complete updates status_code, headers, tokens, latency", async () => {
    await Effect.runPromiseExit(
      repo.insert({
        id: "pr-2",
        runId: "run-1",
        taskId: "task-1",
        turnId: "turn-1",
        provider: "anthropic",
        model: "claude-4",
        payloadSummary: JSON.stringify({ type: "object", bytes: 800, keys: ["messages"] }),
        startedAt: "2026-01-01T00:00:00Z"
      })
    )

    const exit = await Effect.runPromiseExit(
      repo.complete("pr-2", {
        statusCode: 200,
        headersSummary: JSON.stringify({ type: "object", bytes: 200, keys: ["content-type"] }),
        tokensIn: 150,
        tokensOut: 300,
        latencyMs: 1200,
        completedAt: "2026-01-01T00:00:01Z"
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const row = db.prepare("SELECT * FROM provider_requests WHERE id = ?").get("pr-2") as any
    expect(row.status_code).toBe(200)
    expect(row.headers_summary).toContain("content-type")
    expect(row.tokens_in).toBe(150)
    expect(row.tokens_out).toBe(300)
    expect(row.latency_ms).toBe(1200)
    expect(row.completed_at).toBe("2026-01-01T00:00:01Z")
  })
})
