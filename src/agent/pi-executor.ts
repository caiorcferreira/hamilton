import { Effect, Data } from "effect"

export interface PiExecutorConfig {
  prompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  extensions?: Array<(pi: unknown) => void>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[]
  }
  logCallback?: (event: Record<string, unknown>) => Effect.Effect<void>
}

export class PiExecutionError extends Data.TaggedError("PiExecutionError")<{
  stepId: string
  message: string
}> {}

export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError> {
  return Effect.gen(function* () {
    if (config.logCallback) {
      yield* config.logCallback({
        event: "pi_session_started",
        step_id: config.stepId,
        agent_id: config.agentId
      })
    }

    // pi-agent-core integration point.
    // The exact API depends on @earendil-works/pi-agent-core internals.
    // Expected pattern:
    //   import { createAgent } from "@earendil-works/pi-agent-core"
    //   const agent = createAgent({ model: config.model ?? "default" })
    //   const session = agent.startSession({ systemPrompt: config.prompt })
    //   for await (const message of session.messages) {
    //     yield* config.logCallback({ event: message.type, ...message })
    //   }
    //   const result = await session.result
    //   return result

    return yield* Effect.fail(
      new PiExecutionError({
        stepId: config.stepId,
        message: "pi-agent-core integration not yet implemented"
      })
    )
  })
}