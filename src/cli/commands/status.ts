import { Args, Command } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import { loadRunState, RunStateError } from "../../workflow/state.js"
import { hamiltonHome, runDir } from "../../paths.js"

export type RunStatus = import("../../workflow/state.js").RunStatus

export function getRunStatus(runId: string): Effect.Effect<RunStatus, RunStateError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new RunStateError({
        runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    return yield* _(loadRunState(runId))
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

function stepIndicator(status: string): string {
  if (status === "completed") return "\u2713"
  if (status === "running") return "\u23F3"
  if (status === "failed") return "\u2717"
  return "\u25CB"
}

function parseStepSlug(stepId: string, runId: string): string {
  const prefix = runId + "-"
  if (!stepId.startsWith(prefix)) return stepId
  const afterRun = stepId.slice(prefix.length)
  const lastDash = afterRun.lastIndexOf("-")
  if (lastDash === -1) return afterRun
  return afterRun.slice(0, lastDash)
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

  const stepsInOrder = status.steps.map((s, idx) => ({
    ...s,
    slug: parseStepSlug(s.stepId, status.runId),
    order: idx
  }))

  const currentIdx = stepsInOrder.findIndex((s) => s.status === "running")
  if (status.currentStep && currentIdx >= 0) {
    const step = stepsInOrder[currentIdx]
    lines.push(`Step:      ${step.slug} (${currentIdx + 1}/${stepsInOrder.length}) \u2014 agent: ${step.agentSlug}`)
  }

  const stepLine = stepsInOrder.map((s, idx) => `${s.slug}(${idx + 1}/${stepsInOrder.length}) ${stepIndicator(s.status)}`).join("  ")
  lines.push(`Steps:     ${stepLine}`)

  const tokensIn = status.totalTokensIn.toLocaleString()
  const tokensOut = status.totalTokensOut.toLocaleString()
  lines.push(`Tokens:    ${tokensIn} in / ${tokensOut} out`)

  if (status.errorMessage) {
    lines.push(`Errors:    ${status.errorMessage}`)
  } else {
    lines.push(`Errors:    none`)
  }

  return lines.join("\n")
}

const runIdArg = Args.text({ name: "id" })

export const statusCommand = Command.make("status", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(getRunStatus(id))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Status not found: ${id}`)
      return
    }
    yield* Console.log(formatStatus(result.value))
  })
).pipe(Command.withDescription("Show run status"))