import { Effect } from "effect"
import { loadRunState, RunStateError } from "../../workflow/state.js"

export type RunStatus = import("../../workflow/state.js").RunStatus

export function getRunStatus(runId: string): Effect.Effect<RunStatus, RunStateError> {
  return loadRunState(runId)
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

export function formatStatus(status: RunStatus): string {
  const lines: string[] = []

  const elapsed = computeElapsed(status.startedAt, status.completedAt)

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

  const currentIdx = status.steps.findIndex((s) => s.status === "running")
  if (status.currentStep && currentIdx >= 0) {
    const step = status.steps[currentIdx]
    lines.push(`Step:      ${currentIdx + 1}/${status.steps.length} \u2014 ${step.stepId} (agent: ${step.agentId})`)
  }

  const stepLine = status.steps.map((s) => `${s.stepId} ${stepIndicator(s.status)}`).join("  ")
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