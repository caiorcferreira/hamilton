import { Effect, Data } from "effect"
import { Database } from "bun:sqlite"
import { openDb } from "../workflow/state.js"
import {
  insertRun,
  insertTasks,
  insertTask,
  getRunById,
  getTasksByRunId,
  updateTaskStarted,
  updateTaskCompleted,
  updateTaskFailed,
  updateRunCompleted,
  updateRunFailed,
  setDurableDeferred,
  getDurableDeferred,
  updateRunContext
} from "../db/queries.js"
import { buildRunId, buildTaskId } from "../workflow/engine.js"
import type { WorkflowSpec } from "../types.js"
import type { Context } from "../workflow/context.js"

function parseTaskSlug(taskId: string, runId: string): string {
  const prefix = runId + "-"
  if (!taskId.startsWith(prefix)) return taskId
  const afterRun = taskId.slice(prefix.length)
  const lastDash = afterRun.lastIndexOf("-")
  if (lastDash === -1) return afterRun
  return afterRun.slice(0, lastDash)
}

export class EngineError extends Data.TaggedError("EngineError")<{
  runId: string
  message: string
}> {}

export type RunState = "idle" | "running" | "paused" | "completed" | "failed"

export type TaskState = "pending" | "running" | "completed" | "failed"

const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  idle: ["running"],
  running: ["paused", "completed", "failed"],
  paused: ["running"],
  completed: [],
  failed: []
}

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending: ["running"],
  running: ["completed", "failed"],
  completed: [],
  failed: []
}

const TASK_TRANSITION_MAP: Record<string, TaskState> = {
  start: "running",
  complete: "completed",
  fail: "failed"
}

export interface WorkflowRuntime {
  readonly db: Database
  readonly runId: string
  readonly state: RunState
  readonly spec: WorkflowSpec
  readonly compoundTaskIds: ReadonlyMap<string, string>

  readonly shouldExecuteTask: (taskName: string) => Effect.Effect<boolean, EngineError>
  readonly shouldPause: () => Effect.Effect<boolean, EngineError>
  readonly transitionTask: (taskName: string, transition: "start" | "complete" | "fail") => Effect.Effect<void, EngineError>
  readonly insertDynamicTask: (taskName: string, agentName: string) => Effect.Effect<void, EngineError>
  readonly pause: () => Effect.Effect<void, EngineError>
  readonly complete: () => Effect.Effect<void, EngineError>
  readonly fail: (error: string) => Effect.Effect<void, EngineError>
  readonly close: () => Effect.Effect<void>
}

class WorkflowRuntimeImpl implements WorkflowRuntime {
  private _state: RunState
  private _taskStates: Map<string, TaskState> = new Map()
  private _compoundTaskIds: Map<string, string> = new Map()

  constructor(
    private readonly _db: Database,
    private readonly _runId: string,
    private readonly _spec: WorkflowSpec,
    initialState: RunState,
    taskStates: Map<string, TaskState>,
    compoundTaskIds: Map<string, string>
  ) {
    this._state = initialState
    this._taskStates = taskStates
    this._compoundTaskIds = compoundTaskIds
  }

  get db(): Database { return this._db }
  get runId(): string { return this._runId }
  get state(): RunState { return this._state }
  get spec(): WorkflowSpec { return this._spec }
  get compoundTaskIds(): ReadonlyMap<string, string> { return this._compoundTaskIds }

  shouldExecuteTask(taskName: string): Effect.Effect<boolean, EngineError> {
    return Effect.sync(() => {
      const taskState = this._taskStates.get(taskName)
      return taskState !== "completed"
    })
  }

  shouldPause(): Effect.Effect<boolean, EngineError> {
    return Effect.sync(() => {
      const deferred = getDurableDeferred(this._db, `pause-${this._runId}`)
      return deferred !== null && deferred.state === "paused"
    })
  }

  transitionTask(taskName: string, transition: "start" | "complete" | "fail"): Effect.Effect<void, EngineError> {
    return Effect.gen(this, function* (_) {
      const currentTaskState = this._taskStates.get(taskName) ?? "pending"
      const newTaskState = TASK_TRANSITION_MAP[transition] as TaskState
      const allowed = TASK_TRANSITIONS[currentTaskState]

      if (!allowed.includes(newTaskState)) {
        return yield* Effect.fail(
          new EngineError({
            runId: this._runId,
            message: `Invalid task transition: ${taskName} from ${currentTaskState} via ${transition}`
          })
        )
      }

      const compoundId = this._compoundTaskIds.get(taskName) ?? taskName
      const now = new Date().toISOString()
      if (transition === "start") {
        updateTaskStarted(this._db, this._runId, compoundId, now)
      } else if (transition === "complete") {
        updateTaskCompleted(this._db, this._runId, compoundId, now, {})
      } else {
        updateTaskFailed(this._db, this._runId, compoundId, "Task failed")
      }

      this._taskStates.set(taskName, newTaskState)
    })
  }

  insertDynamicTask(taskName: string, agentName: string): Effect.Effect<void, EngineError> {
    return Effect.sync(() => {
      const taskId = buildTaskId(this._runId, taskName)
      insertTask(this._db, this._runId, taskId, agentName)
      this._taskStates.set(taskName, "pending")
      this._compoundTaskIds.set(taskName, taskId)
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

function collectAllTaskNames(spec: WorkflowSpec): Array<{ taskName: string; agentName: string }> {
  const result: Array<{ taskName: string; agentName: string }> = []

  function walk(tasks: WorkflowSpec["tasks"]): void {
    for (const t of tasks) {
      if (t.agent) {
        result.push({ taskName: t.name, agentName: t.agent.executorRef })
      }
      if (t.tasks) {
        walk(t.tasks)
      }
    }
  }

  walk(spec.tasks)
  return result
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

      const taskRows = getTasksByRunId(db, existingRunId)
      const taskStates = new Map<string, TaskState>()
      const compoundTaskIds = new Map<string, string>()
      for (const task of taskRows) {
        const state = task.status as TaskState
        const slug = parseTaskSlug(task.id, existingRunId)
        taskStates.set(slug, state)
        compoundTaskIds.set(slug, task.id)
      }

      const deferredTasks = taskRows.filter((t) => t.status === "deferred")
      for (const t of deferredTasks) {
        db.prepare(
          `UPDATE tasks SET status = 'pending' WHERE id = ?`
        ).run(t.id)
        const slug = parseTaskSlug(t.id, existingRunId)
        taskStates.set(slug, "pending")
      }

      updateRunContext(db, existingRunId, JSON.stringify(context))

      db.prepare(
        `UPDATE runs SET status = 'running' WHERE id = ?`
      ).run(existingRunId)

      return new WorkflowRuntimeImpl(db, existingRunId, spec, "running", taskStates, compoundTaskIds)
    }

    const runId = buildRunId(spec.name)

    insertRun(db, runId, spec.name, new Date().toISOString())
    const taskEntries = collectAllTaskNames(spec)
    insertTasks(db, runId, taskEntries.map((t) => ({ taskSlug: t.taskName, agentName: t.agentName })))
    updateRunContext(db, runId, JSON.stringify(context))

    const taskRows = getTasksByRunId(db, runId)
    const taskStates = new Map<string, TaskState>()
    const compoundTaskIds = new Map<string, string>()
    for (const task of taskRows) {
      const slug = parseTaskSlug(task.id, runId)
      taskStates.set(slug, "pending")
      compoundTaskIds.set(slug, task.id)
    }

    return new WorkflowRuntimeImpl(db, runId, spec, "running", taskStates, compoundTaskIds)
  })
}