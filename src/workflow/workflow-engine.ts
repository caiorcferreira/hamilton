import { Effect, Data } from "effect"
import Database from "better-sqlite3"
import { openDb } from "../workflow/state.js"
import {
  insertRun,
  insertSteps,
  updateStepStarted,
  updateStepCompleted,
  updateStepFailed,
  insertTokenEvent,
  updateRunCompleted,
  updateRunFailed,
  setWorkflowState,
  getWorkflowState,
  setDurableDeferred,
  getDurableDeferred,
  updateRunContext
} from "../db/queries.js"
import type { WorkflowSpec } from "../types.js"

export class EngineError extends Data.TaggedError("EngineError")<{
  runId: string
  message: string
}> {}

export interface EngineContext {
  db: Database.Database
  runId: string
}

export function initializeRun(
  spec: WorkflowSpec,
  runId: string,
  context: Record<string, string>
): Effect.Effect<EngineContext, EngineError> {
  return Effect.gen(function* () {
    const db = yield* openDb().pipe(
      Effect.mapError((e) => new EngineError({ runId, message: String(e) }))
    )

    insertRun(db, runId, spec.id, new Date().toISOString())
    insertSteps(db, runId, spec.steps.map((s) => ({ stepId: s.id, agentId: s.agent })))
    updateRunContext(db, runId, JSON.stringify(context))

    return { db, runId }
  })
}

export function checkpointStepStart(
  ctx: EngineContext,
  stepId: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateStepStarted(ctx.db, ctx.runId, stepId, new Date().toISOString())
  })
}

export function checkpointStepComplete(
  ctx: EngineContext,
  stepId: string,
  data: { tokensIn?: number; tokensOut?: number; output?: string }
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateStepCompleted(ctx.db, ctx.runId, stepId, new Date().toISOString(), data)
  })
}

export function checkpointStepFailed(
  ctx: EngineContext,
  stepId: string,
  error: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateStepFailed(ctx.db, ctx.runId, stepId, error)
  })
}

export function checkpointTokenEvent(
  ctx: EngineContext,
  stepId: string,
  eventType: string,
  tokensIn: number,
  tokensOut: number
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    insertTokenEvent(ctx.db, ctx.runId, stepId, eventType, tokensIn, tokensOut)
  })
}

export function markRunCompleted(
  ctx: EngineContext
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateRunCompleted(ctx.db, ctx.runId, new Date().toISOString())
  })
}

export function markRunFailed(
  ctx: EngineContext,
  error: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateRunFailed(ctx.db, ctx.runId, error)
  })
}

export function closeEngine(ctx: EngineContext): Effect.Effect<void> {
  return Effect.sync(() => {
    ctx.db.close()
  })
}

export function writeDurableState(
  ctx: EngineContext,
  key: string,
  value: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    setWorkflowState(ctx.db, ctx.runId, key, value)
  })
}

export function readDurableState(
  ctx: EngineContext,
  key: string
): Effect.Effect<string | null, EngineError> {
  return Effect.sync(() => {
    return getWorkflowState(ctx.db, ctx.runId, key)
  })
}

export function setDeferredState(
  ctx: EngineContext,
  deferredId: string,
  state: string,
  value?: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    setDurableDeferred(ctx.db, deferredId, ctx.runId, state, value)
  })
}

export function getDeferredState(
  ctx: EngineContext,
  deferredId: string
): Effect.Effect<{ state: string; value: string | null } | null, EngineError> {
  return Effect.sync(() => {
    return getDurableDeferred(ctx.db, deferredId)
  })
}