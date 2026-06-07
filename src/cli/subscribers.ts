import { Effect, Console } from "effect"
import { Event, createSubscriber } from "../events/bus.js"

function formatEvent(event: Event): string {
  switch (event._tag) {
    case "WorkflowStarted":
      return `Workflow started [${event.runId}]`
    case "StepStarted":
      return `  Step ${event.stepId} started`
    case "StepCompleted":
      return `  Step ${event.stepId} completed`
    case "StepFailed":
      return `  Step ${event.stepId} failed: ${event.message}`
    case "StepTimedOut":
      return `  Step ${event.stepId} timed out`
    case "StepRetrying":
      return `  Step ${event.stepId} retrying...`
    case "StepPaused":
      return `  Step ${event.stepId} paused`
    case "WorkflowCompleted":
      return `Workflow finished`
    default:
      return ""
  }
}

export const CliRenderer = createSubscriber(
  (bus) => bus.subscribeAll,
  (event: Event) => {
    const line = formatEvent(event)
    if (line) {
      return Console.log(line)
    }
    return Effect.void
  }
)