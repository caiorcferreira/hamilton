import { Effect, Console } from "effect"
import { Event, createSubscriber } from "../events/bus.js"

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

const taskStartedAt = new Map<string, number>()
const taskTokens = new Map<string, { tokensIn: number; tokensOut: number }>()
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

      case "TaskStarted": {
        taskStartedAt.set(event.taskId, Date.now())
        taskTokens.set(event.taskId, { tokensIn: 0, tokensOut: 0 })
        return Console.log(`  Task ${event.taskName} (${shortId(event.taskId)}) started`)
      }

      case "TokenUsage": {
        if (event.taskId) {
          const current = taskTokens.get(event.taskId) ?? { tokensIn: 0, tokensOut: 0 }
          current.tokensIn += event.tokensIn
          current.tokensOut += event.tokensOut
          taskTokens.set(event.taskId, current)
        }
        totalTokensIn += event.tokensIn
        totalTokensOut += event.tokensOut
        return Effect.void
      }

      case "TaskCompleted": {
        const startAt = taskStartedAt.get(event.taskId)
        const elapsed = startAt ? Date.now() - startAt : 0
        const tokens = taskTokens.get(event.taskId) ?? { tokensIn: 0, tokensOut: 0 }
        const slug = event.taskName
        const id = shortId(event.taskId)
        const parts = [`  \u2713 ${slug} (${id}) completed (${formatDuration(elapsed)}`]
        if (tokens.tokensIn > 0 || tokens.tokensOut > 0) {
          parts.push(`, ${formatTokens(tokens.tokensIn)} in / ${formatTokens(tokens.tokensOut)} out`)
        }
        parts.push(")")
        taskStartedAt.delete(event.taskId)
        taskTokens.delete(event.taskId)
        return Console.log(parts.join(""))
      }

      case "TaskFailed": {
        return Console.log(`  \u2717 ${event.taskName} (${shortId(event.taskId)}) failed: ${event.message}`)
      }

      case "TaskTimedOut": {
        return Console.log(`  \u23F1 ${event.taskName} (${shortId(event.taskId)}) timed out`)
      }

      case "TaskRetrying": {
        return Console.log(`  \u21BB ${event.taskName} (${shortId(event.taskId)}) retrying`)
      }

      case "TaskPaused": {
        return Console.log(`  \u23F8 ${event.taskName} (${shortId(event.taskId)}) paused`)
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
