import { Effect, Data } from "effect"
import { Database } from "bun:sqlite"
import { openDb } from "../workflow/state.js"
import {
  insertRun,
  insertSteps,
  getRunById,
  getStepsByRunId,
  updateStepStarted,
  updateStepCompleted,
  updateStepFailed,
  updateRunCompleted,
  updateRunFailed,
  setDurableDeferred,
  getDurableDeferred,
  updateRunContext
} from "../db/queries.js"
import { buildRunId, buildStepId } from "../workflow/engine.js"
import type { WorkflowSpec } from "../types.js"
import type { Context } from "../workflow/context.js"

function parseStepSlug(stepId: string, runId: string): string {
  const prefix = runId + "-"
  if (!stepId.startsWith(prefix)) return stepId
  const afterRun = stepId.slice(prefix.length)
  const lastDash = afterRun.lastIndexOf("-")
  if (lastDash === -1) return afterRun
  return afterRun.slice(0, lastDash)
}

export class EngineError extends Data.TaggedError("EngineError")<{
  runId: string
  message: string
}> {}

export type RunState = "idle" | "running" | "paused" | "completed" | "failed"

export type StepState = "pending" | "running" | "completed" | "failed"

const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  idle: ["running"],
  running: ["paused", "completed", "failed"],
  paused: ["running"],
  completed: [],
  failed: []
}

const STEP_TRANSITIONS: Record<StepState, StepState[]> = {
  pending: ["running"],
  running: ["completed", "failed"],
  completed: [],
  failed: []
}

const STEP_TRANSITION_MAP: Record<string, StepState> = {
  start: "running",
  complete: "completed",
  fail: "failed"
}

export interface WorkflowRuntime {
  readonly db: Database
  readonly runId: string
  readonly state: RunState
  readonly spec: WorkflowSpec

  readonly shouldExecuteStep: (stepId: string) => Effect.Effect<boolean, EngineError>
  readonly shouldPause: () => Effect.Effect<boolean, EngineError>
  readonly transitionStep: (stepId: string, transition: "start" | "complete" | "fail") => Effect.Effect<void, EngineError>
  readonly pause: () => Effect.Effect<void, EngineError>
  readonly complete: () => Effect.Effect<void, EngineError>
  readonly fail: (error: string) => Effect.Effect<void, EngineError>
  readonly close: () => Effect.Effect<void>
}

class WorkflowRuntimeImpl implements WorkflowRuntime {
  private _state: RunState
  private _stepStates: Map<string, StepState> = new Map()
  private _compoundStepIds: Map<string, string> = new Map()

  constructor(
    private readonly _db: Database,
    private readonly _runId: string,
    private readonly _spec: WorkflowSpec,
    initialState: RunState,
    stepStates: Map<string, StepState>,
    compoundStepIds: Map<string, string>
  ) {
    this._state = initialState
    this._stepStates = stepStates
    this._compoundStepIds = compoundStepIds
  }

  get db(): Database { return this._db }
  get runId(): string { return this._runId }
  get state(): RunState { return this._state }
  get spec(): WorkflowSpec { return this._spec }

  shouldExecuteStep(stepId: string): Effect.Effect<boolean, EngineError> {
    return Effect.sync(() => {
      const stepState = this._stepStates.get(stepId)
      return stepState !== "completed"
    })
  }

  shouldPause(): Effect.Effect<boolean, EngineError> {
    return Effect.sync(() => {
      const deferred = getDurableDeferred(this._db, `pause-${this._runId}`)
      return deferred !== null && deferred.state === "paused"
    })
  }

  transitionStep(stepId: string, transition: "start" | "complete" | "fail"): Effect.Effect<void, EngineError> {
    return Effect.gen(this, function* (_) {
      const currentStepState = this._stepStates.get(stepId) ?? "pending"
      const newStepState = STEP_TRANSITION_MAP[transition] as StepState
      const allowed = STEP_TRANSITIONS[currentStepState]

      if (!allowed.includes(newStepState)) {
        return yield* Effect.fail(
          new EngineError({
            runId: this._runId,
            message: `Invalid step transition: ${stepId} from ${currentStepState} via ${transition}`
          })
        )
      }

      const compoundId = this._compoundStepIds.get(stepId) ?? stepId
      const now = new Date().toISOString()
      if (transition === "start") {
        updateStepStarted(this._db, this._runId, compoundId, now)
      } else if (transition === "complete") {
        updateStepCompleted(this._db, this._runId, compoundId, now, {})
      } else {
        updateStepFailed(this._db, this._runId, compoundId, "Step failed")
      }

      this._stepStates.set(stepId, newStepState)
    })
  }

  pause(): Effect.Effect<void, EngineError> {
    return Effect.gen(this, function* (_) {
      const allowed = RUN_TRANSITIONS[this._state]
      if (!allowed.includes("paused" as RunState)) {
        return yield* Effect.fail(
          new EngineError({
            runId: this._runId,
            message: `Invalid run transition: from ${this._state} to paused`
          })
        )
      }

      setDurableDeferred(this._db, `pause-${this._runId}`, this._runId, "paused")
      this._db.prepare(
        `UPDATE runs SET status = 'paused' WHERE id = ?`
      ).run(this._runId)
      this._state = "paused"
    })
  }

  complete(): Effect.Effect<void, EngineError> {
    return Effect.gen(this, function* (_) {
      const allowed = RUN_TRANSITIONS[this._state]
      if (!allowed.includes("completed" as RunState)) {
        return yield* Effect.fail(
          new EngineError({
            runId: this._runId,
            message: `Invalid run transition: from ${this._state} to completed`
          })
        )
      }

      updateRunCompleted(this._db, this._runId, new Date().toISOString())
      this._state = "completed"
    })
  }

  fail(error: string): Effect.Effect<void, EngineError> {
    return Effect.gen(this, function* (_) {
      const allowed = RUN_TRANSITIONS[this._state]
      if (!allowed.includes("failed" as RunState)) {
        return yield* Effect.fail(
          new EngineError({
            runId: this._runId,
            message: `Invalid run transition: from ${this._state} to failed`
          })
        )
      }

      updateRunFailed(this._db, this._runId, error)
      this._state = "failed"
    })
  }

  close(): Effect.Effect<void> {
    return Effect.sync(() => {
      this._db.close()
    })
  }
}

export function createWorkflowRuntime(
  spec: WorkflowSpec,
  context: Context,
  existingRunId?: string
): Effect.Effect<WorkflowRuntime, EngineError> {
  return Effect.gen(function* () {
    const db = yield* openDb().pipe(
      Effect.mapError((e) => new EngineError({ runId: existingRunId ?? "new", message: String(e) }))
    )

    if (existingRunId) {
      const run = getRunById(db, existingRunId)
      if (!run) {
        db.close()
        return yield* Effect.fail(
          new EngineError({ runId: existingRunId, message: `Run not found: ${existingRunId}` })
        )
      }
      if (run.status !== "paused") {
        db.close()
        return yield* Effect.fail(
          new EngineError({ runId: existingRunId, message: `Run is not paused: ${run.status}` })
        )
      }

      const stepRows = getStepsByRunId(db, existingRunId)
      const stepStates = new Map<string, StepState>()
      const compoundStepIds = new Map<string, string>()
      for (const step of stepRows) {
        const state = step.status as StepState
        const slug = parseStepSlug(step.id, existingRunId)
        stepStates.set(slug, state)
        compoundStepIds.set(slug, step.id)
      }

      const deferredSteps = stepRows.filter((s) => s.status === "deferred")
      for (const s of deferredSteps) {
        db.prepare(
          `UPDATE steps SET status = 'pending' WHERE id = ?`
        ).run(s.id)
        const slug = parseStepSlug(s.id, existingRunId)
        stepStates.set(slug, "pending")
      }

      updateRunContext(db, existingRunId, JSON.stringify(context))

      db.prepare(
        `UPDATE runs SET status = 'running' WHERE id = ?`
      ).run(existingRunId)

      return new WorkflowRuntimeImpl(db, existingRunId, spec, "running", stepStates, compoundStepIds)
    }

    const runId = buildRunId(spec.slug)

    insertRun(db, runId, spec.slug, new Date().toISOString())
    insertSteps(db, runId, spec.steps.map((s) => ({ stepSlug: s.slug, agentSlug: s.agent })))
    updateRunContext(db, runId, JSON.stringify(context))

    const stepRows = getStepsByRunId(db, runId)
    const stepStates = new Map<string, StepState>()
    const compoundStepIds = new Map<string, string>()
    for (const step of stepRows) {
      const slug = parseStepSlug(step.id, runId)
      stepStates.set(slug, "pending")
      compoundStepIds.set(slug, step.id)
    }

    return new WorkflowRuntimeImpl(db, runId, spec, "running", stepStates, compoundStepIds)
  })
}