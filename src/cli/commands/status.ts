import { Args, Command } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import { loadRunState, RunStateError } from "../../workflow/state.js"
import { hamiltonHome, runDir } from "../../paths.js"

export type RunStatus = import("../../workflow/state.js").RunStatus

export interface GetRunStatusOpts {
  runId: string
}

export function getRunStatus(opts: GetRunStatusOpts): Effect.Effect<RunStatus, RunStateError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new RunStateError({
        runId: opts.runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const status = yield* _(loadRunState(opts.runId))

    return status
  })
}

function computeElapsed(start: string, end?: string | null): string {
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const diffSec = Math.max(0, Math.floor((endMs - startMs) / 1000))

  if (diffSec < 60) return `${diffSec}s`

  const min = Math.floor(diffSec / 60)
  const sec = diffSec % 60
  return `${min}m ${sec}s`
}

function taskIndicator(status: string): string {
  if (status === "completed") return "\u2713"
  if (status === "running") return "\u23F3"
  if (status === "failed") return "\u2717"
  return "\u25CB"
}

export function formatStatus(status: RunStatus): string {
  const lines: string[] = []

  const elapsed = computeElapsed(status.startedAt, status.completedAt)

  lines.push(`Run folder: ${runDir(status.runId)}/`)

  if (status.status === "completed") {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    completed (${elapsed} total)`)
  } else if (status.status === "failed") {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    failed (${elapsed} elapsed)`)
  } else {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    running (${elapsed} elapsed)`)
  }

  lines.push(`Run ID:    ${status.runId}`)

  const tasks = status.tasks

  let currentTaskName: string | null = null
  if (status.currentTask) {
    const colocated = tasks.find((t) => t.taskId === status.currentTask)
    if (colocated) {
      currentTaskName = colocated.taskName
    }
  }
  if (currentTaskName) {
    const currentIdx = tasks.findIndex((t) => t.taskName === currentTaskName)
    if (currentIdx >= 0) {
      lines.push(`Task:      ${currentTaskName} (${currentIdx + 1}/${tasks.length})`)
    }
  }

  const tokensIn = status.totalTokensIn.toLocaleString()
  const tokensOut = status.totalTokensOut.toLocaleString()
  lines.push(`Tokens:    ${tokensIn} in / ${tokensOut} out`)

  if (status.errorMessage) {
    lines.push(`Errors:    ${status.errorMessage}`)
  } else {
    lines.push(`Errors:    none`)
  }

  lines.push("")
  lines.push("Tasks:")

  for (const t of tasks) {
    const isCurrent = currentTaskName !== null && t.taskName === currentTaskName
    const indicator = isCurrent ? "\u23F3" : taskIndicator(t.status)
    const isSubtask = t.taskName.includes("/")
    const indent = isSubtask ? "   " : "  "
    const agentName = isSubtask ? "" : ` (${t.taskName})`
    lines.push(`${indent}${indicator}  ${t.taskName}${agentName}`)
  }

  return lines.join("\n")
}

const runIdArg = Args.text({ name: "id" })

export const statusCommand = Command.make("status", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(getRunStatus({ runId: id }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Status not found: ${id}`)
      return
    }
    yield* Console.log(formatStatus(result.value))
  })
).pipe(Command.withDescription("Show run status"))
