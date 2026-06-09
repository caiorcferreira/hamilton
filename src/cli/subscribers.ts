import { Effect, Console } from "effect"
import { Event, createSubscriber } from "../events/bus.js"

function extractSlug(taskId: string, runId: string): string {
  const prefix = runId + "-"
  if (!taskId.startsWith(prefix)) return taskId
  const afterRun = taskId.slice(prefix.length)
  const lastDash = afterRun.lastIndexOf("-")
  if (lastDash === -1) return afterRun
  return afterRun.slice(0, lastDash)
}

function shortId(taskId: string): string {
  return taskId.split("-").pop() ?? taskId
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min}m ${rem}s`
}

const stepStartedAt = new Map<string, number>()
const stepTokens = new Map<string, { tokensIn: number; tokensOut: number }>()
let workflowStartedAt = 0
let totalTokensIn = 0
let totalTokensOut = 0

export const CliRenderer = createSubscriber(
  (bus) => bus.subscribeAll,
  (event: Event) => {
    switch (event._tag) {
      case "WorkflowStarted":
        workflowStartedAt = Date.now()
        return Console.log(`Workflow ${event.runId} started`)

      case "StepStarted": {
        stepStartedAt.set(event.stepId, Date.now())
        stepTokens.set(event.stepId, { tokensIn: 0, tokensOut: 0 })
        const slug = extractSlug(event.stepId, event.runId)
        return Console.log(`  Step ${slug} (${shortId(event.stepId)}) started`)
      }

      case "TokenUsage": {
        const current = stepTokens.get(event.stepId) ?? { tokensIn: 0, tokensOut: 0 }
        current.tokensIn += event.tokensIn
        current.tokensOut += event.tokensOut
        stepTokens.set(event.stepId, current)
        totalTokensIn += event.tokensIn
        totalTokensOut += event.tokensOut
        return Effect.void
      }

      case "StepCompleted": {
        const startAt = stepStartedAt.get(event.stepId)
        const elapsed = startAt ? Date.now() - startAt : 0
        const tokens = stepTokens.get(event.stepId) ?? { tokensIn: 0, tokensOut: 0 }
        const slug = extractSlug(event.stepId, event.runId)
        const id = shortId(event.stepId)
        const parts = [`  \u2713 ${slug} (${id}) completed (${formatDuration(elapsed)}`]
        if (tokens.tokensIn > 0 || tokens.tokensOut > 0) {
          parts.push(`, ${formatTokens(tokens.tokensIn)} in / ${formatTokens(tokens.tokensOut)} out`)
        }
        parts.push(")")
        stepStartedAt.delete(event.stepId)
        stepTokens.delete(event.stepId)
        return Console.log(parts.join(""))
      }

      case "StepFailed": {
        const slug = extractSlug(event.stepId, event.runId)
        return Console.log(`  \u2717 ${slug} (${shortId(event.stepId)}) failed: ${event.message}`)
      }

      case "StepTimedOut": {
        const slug = extractSlug(event.stepId, event.runId)
        return Console.log(`  \u23F1 ${slug} (${shortId(event.stepId)}) timed out`)
      }

      case "StepRetrying": {
        const slug = extractSlug(event.stepId, event.runId)
        return Console.log(`  \u21BB ${slug} (${shortId(event.stepId)}) retrying`)
      }

      case "StepPaused": {
        const slug = extractSlug(event.stepId, event.runId)
        return Console.log(`  \u23F8 ${slug} (${shortId(event.stepId)}) paused`)
      }

      case "WorkflowCompleted": {
        const elapsed = workflowStartedAt ? Date.now() - workflowStartedAt : 0
        const parts = [`Workflow ${event.runId} completed (${formatDuration(elapsed)}`]
        if (totalTokensIn > 0 || totalTokensOut > 0) {
          parts.push(`, ${formatTokens(totalTokensIn)} in / ${formatTokens(totalTokensOut)} out`)
        }
        parts.push(")")
        if (event.message) {
          parts.push(`: ${event.message}`)
        }
        totalTokensIn = 0
        totalTokensOut = 0
        workflowStartedAt = 0
        return Console.log(parts.join(""))
      }

      default:
        return Effect.void
    }
  }
)
