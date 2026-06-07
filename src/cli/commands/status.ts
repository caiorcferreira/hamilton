import { Args, Command } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import { Schema } from "@effect/schema"
import * as Fs from "node:fs"
import { loadRunState, RunStateError } from "../../workflow/state.js"
import { hamiltonHome, runDir, workflowsDir } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { collectReachableTasks, topologicalSort } from "../../workflow/engine.js"
import type { WorkflowSpec } from "../../types.js"
import { WorkflowSpecSchema } from "../../schemas.js"

export type RunStatus = import("../../workflow/state.js").RunStatus
type DecodedSpec = Schema.Schema.Type<typeof WorkflowSpecSchema>

export interface GetRunStatusOpts {
  runId: string
  loadSpec?: boolean
}

export function getRunStatus(opts: GetRunStatusOpts): Effect.Effect<{ status: RunStatus; spec: DecodedSpec | null }, RunStateError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new RunStateError({
        runId: opts.runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const status = yield* _(loadRunState(opts.runId))

    let spec: DecodedSpec | null = null
    if (opts.loadSpec) {
      spec = yield* _(
        loadWorkflowSpec(workflowsDir(), status.workflow).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        )
      )
    }

    return { status, spec }
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

function parseTaskSlug(taskId: string, runId: string): string {
  const prefix = runId + "-"
  if (!taskId.startsWith(prefix)) return taskId
  const afterRun = taskId.slice(prefix.length)
  const lastDash = afterRun.lastIndexOf("-")
  if (lastDash === -1) return afterRun
  const slug = afterRun.slice(0, lastDash)
  const instancePattern = /^(.+)-(\d+)$/
  const match = instancePattern.exec(slug)
  if (match) {
    return `${match[1]}/${match[2]}`
  }
  return slug
}

export function formatStatus(status: RunStatus, spec?: DecodedSpec): string {
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

  const tasksInOrder = status.tasks.map((t) => ({
    ...t,
    slug: parseTaskSlug(t.taskId, status.runId)
  }))

  if (spec) {
    const staticTasks = collectReachableTasks(spec.tasks as WorkflowSpec["tasks"], spec.run.entrypoint)
    const sorted = topologicalSort(staticTasks)
    const orderMap = new Map<string, number>()
    sorted.forEach((t, i) => orderMap.set(t.name, i))
    const expandedOrder = new Map<string, number>()
    tasksInOrder.forEach((t) => {
      const baseName = t.slug.includes("/")
        ? t.slug.split("/")[0]
        : t.slug
      if (orderMap.has(baseName)) {
        expandedOrder.set(t.slug, orderMap.get(baseName)!)
      } else {
        expandedOrder.set(t.slug, Infinity)
      }
    })
    tasksInOrder.sort((a, b) => {
      const aOrder = expandedOrder.get(a.slug) ?? Infinity
      const bOrder = expandedOrder.get(b.slug) ?? Infinity
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.slug.localeCompare(b.slug)
    })
  }

  const currentIdx = tasksInOrder.findIndex((t) => t.status === "running")
  if (status.currentTask && currentIdx >= 0) {
    const task = tasksInOrder[currentIdx]
    lines.push(`Task:      ${task.slug} (${currentIdx + 1}/${tasksInOrder.length})`)
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

  for (const t of tasksInOrder) {
    const indicator = taskIndicator(t.status)
    const isSubtask = t.slug.includes("/")
    const indent = isSubtask ? "   " : "  "
    const agentName = isSubtask ? "" : ` (${t.taskSlug})`
    lines.push(`${indent}${indicator}  ${t.slug}${agentName}`)
  }

  return lines.join("\n")
}

const runIdArg = Args.text({ name: "id" })

export const statusCommand = Command.make("status", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(getRunStatus({ runId: id, loadSpec: true }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Status not found: ${id}`)
      return
    }
    yield* Console.log(formatStatus(result.value.status, result.value.spec ?? undefined))
  })
).pipe(Command.withDescription("Show run status"))