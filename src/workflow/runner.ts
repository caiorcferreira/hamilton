import { Effect, Schedule, Duration } from "effect"
import * as Path from "node:path"
import { WorkflowSpec } from "../types.js"
import { buildAgentPrompt, extractContextFromOutput } from "../agent/activity.js"
import { loadPersona } from "../agent/persona.js"
import { mergeContext } from "../workflow/context.js"
import { computeStepOrder, buildRunId, resolveStepTimeout } from "../workflow/engine.js"
import { createRunDir, writeInput, writeStepOutput, appendStepLog, writeSummary } from "../observability/run-dir.js"
import { agentsDir } from "../paths.js"

export interface WorkflowEvent {
  type: string
  runId: string
  stepId?: string
  message?: string
  timestamp: string
  data?: Record<string, unknown>
}

export interface WorkflowRunnerConfig {
  executeStep: (params: {
    prompt: string
    stepId: string
    agentId: string
    runId: string
    timeoutSeconds: number
  }) => Effect.Effect<Record<string, unknown>, Error>
  onEvent: (event: WorkflowEvent) => Effect.Effect<void>
  workflowsDir: string
}

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
  context: Record<string, string>
  startedAt: string
  completedAt: string
}

function emit(
  onEvent: WorkflowRunnerConfig["onEvent"],
  event: Omit<WorkflowEvent, "timestamp">
): Effect.Effect<void> {
  return onEvent({ ...event, timestamp: new Date().toISOString() })
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialContext: Record<string, string>,
  config: WorkflowRunnerConfig
): Effect.Effect<WorkflowResult, Error> {
  return Effect.gen(function* (_) {
    const runId = buildRunId(spec.id)
    const startedAt = new Date().toISOString()
    const runningContext: Record<string, string> = { ...initialContext }
    const stepResults: Record<string, string> = { ...spec.context }
    const stepOrder = computeStepOrder(spec)

    yield* createRunDir(runId)
    yield* writeInput(runId, { spec, initialContext })
    yield* emit(config.onEvent, { type: "workflow_started", runId })

    let workflowStatus: "completed" | "failed" | "paused" = "completed"

    for (const stepId of stepOrder) {
      const step = spec.steps.find((s) => s.id === stepId)!
      const agent = spec.agents.find((a) => a.id === step.agent)!
      const maxRetries = step.max_retries ?? 1
      const timeoutSeconds = resolveStepTimeout(spec, agent.id)

      yield* emit(config.onEvent, { type: "step_started", runId, stepId })

      const persona = yield* Effect.match(loadPersona(Path.join(agentsDir(), agent.id)), {
        onSuccess: (p) => p,
        onFailure: () => ({ agents: "", identity: "", soul: "" } as const)
      })

      const prompt = buildAgentPrompt({
        agentsMd: persona.agents,
        identityMd: persona.identity,
        soulMd: persona.soul,
        stepInput: step.input,
        context: runningContext
      })

      yield* appendStepLog(runId, stepId, { event: "prompt_built" })

      const output = yield* config
        .executeStep({
          prompt,
          stepId,
          agentId: agent.id,
          runId,
          timeoutSeconds
        })
        .pipe(
          Effect.timeout(Duration.seconds(timeoutSeconds)),
          Effect.retry(
            Schedule.recurs(maxRetries - 1).pipe(
              Schedule.tapInput((_error: unknown) =>
                Effect.gen(function* () {
                  yield* emit(config.onEvent, {
                    type: "step_retry",
                    runId,
                    stepId,
                    message: "Retrying step"
                  })
                  yield* appendStepLog(runId, stepId, { event: "retry" })
                }).pipe(Effect.catchAll(() => Effect.void))
              )
            )
          )
        )

      if (output === undefined || output === null) {
        yield* emit(config.onEvent, { type: "step_timeout", runId, stepId, message: "step timed out" })
        workflowStatus = "failed"
        break
      }
      yield* appendStepLog(runId, stepId, { event: "completed" })
      yield* writeStepOutput(runId, stepId, output)

      const extracted = extractContextFromOutput(output)
      Object.assign(runningContext, extracted)
      Object.assign(runningContext, mergeContext(runningContext, output))

      if (output.status && typeof output.status === "string") {
        stepResults[stepId] = output.status
      }

      yield* emit(config.onEvent, { type: "step_completed", runId, stepId })
    }

    const completedAt = new Date().toISOString()
    const summary = { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt }
    yield* writeSummary(runId, summary)
    yield* emit(config.onEvent, { type: "workflow_completed", runId })

    return { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt }
  })
}