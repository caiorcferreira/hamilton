import { Effect, Schedule, Duration } from "effect"
import * as Path from "node:path"
import { WorkflowSpec } from "../types.js"
import { buildAgentPrompt, extractContextFromOutput } from "../agent/activity.js"
import { loadPersona } from "../agent/persona.js"
import { loadAgentSettings } from "../agent/config.js"
import { createRtkExtension } from "../agent/rtk-extension.js"
import { executeWithPi } from "../agent/pi-executor.js"
import { mergeContext } from "../workflow/context.js"
import { computeStepOrder, buildRunId, resolveStepTimeout } from "../workflow/engine.js"
import {
  initializeRun,
  checkpointStepStart,
  checkpointStepComplete,
  checkpointStepFailed,
  markRunCompleted,
  markRunFailed,
  closeEngine,
  getDeferredState
} from "../workflow/workflow-engine.js"
import { createRunDir, writeInput, writeStepOutput, appendStepLog, writeSummary, appendEngineLog } from "../observability/run-dir.js"
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

    const ctx = yield* initializeRun(spec, runId, runningContext)

    yield* createRunDir(runId)
    yield* writeInput(runId, { spec, initialContext })
    yield* emit(config.onEvent, { type: "workflow_started", runId })
    yield* appendEngineLog(runId, { event: "workflow_started", workflowId: spec.id })

    let workflowStatus: "completed" | "failed" | "paused" = "completed"

    const body = Effect.gen(function* () {
      for (const stepId of stepOrder) {
        const step = spec.steps.find((s) => s.id === stepId)!
        const agent = spec.agents.find((a) => a.id === step.agent)!
        const maxRetries = step.max_retries ?? 1
        const timeoutSeconds = resolveStepTimeout(spec, agent.id)
        const model = agent.model

        const deferred = yield* getDeferredState(ctx, `${runId}:${stepId}`)
        if (deferred?.state === "paused") {
          yield* emit(config.onEvent, { type: "step_paused", runId, stepId, message: "step paused via deferred state" })
          workflowStatus = "paused"
          break
        }

        yield* checkpointStepStart(ctx, stepId)
        yield* emit(config.onEvent, { type: "step_started", runId, stepId })
        yield* appendEngineLog(runId, { event: "step_started", stepId })

        const persona = yield* Effect.match(loadPersona(Path.join(agentsDir(), agent.id)), {
          onSuccess: (p) => p,
          onFailure: () => ({ agents: "", identity: "", soul: "" } as const)
        })

        const agentSettings = yield* Effect.match(loadAgentSettings(Path.join(agentsDir(), agent.id)), {
          onSuccess: (s) => s,
          onFailure: () => ({}) as Record<string, never>
        })

        const prompt = buildAgentPrompt({
          agentsMd: persona.agents,
          identityMd: persona.identity,
          soulMd: persona.soul,
          stepInput: step.input,
          context: runningContext
        })

        yield* appendStepLog(runId, stepId, { event: "prompt_built" })

        const rtkExtension = createRtkExtension({
          model: model ?? agentSettings.model,
          disabled: process.env.RTK_DISABLED === "1"
        })

        const output = yield* executeWithPi({
          prompt,
          stepId,
          agentId: agent.id,
          runId,
          timeoutSeconds: timeoutSeconds,
          model,
          extensions: [rtkExtension],
          settings: {
            thinking: agentSettings.thinking,
            tools: agentSettings.tools,
            skills: agentSettings.skills
          }
        }).pipe(
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
          yield* checkpointStepFailed(ctx, stepId, "timeout")
          yield* appendEngineLog(runId, { event: "step_timeout", stepId })
          workflowStatus = "failed"
          break
        }

        yield* checkpointStepComplete(ctx, stepId, { output: JSON.stringify(output) })
        yield* appendStepLog(runId, stepId, { event: "completed" })
        yield* writeStepOutput(runId, stepId, output)

        const extracted = extractContextFromOutput(output)
        Object.assign(runningContext, extracted)
        Object.assign(runningContext, mergeContext(runningContext, output))

        if (output.status && typeof output.status === "string") {
          stepResults[stepId] = output.status
        }

        yield* emit(config.onEvent, { type: "step_completed", runId, stepId })
        yield* appendEngineLog(runId, { event: "step_completed", stepId })
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus === "completed") {
        yield* markRunCompleted(ctx)
      } else if (workflowStatus === "failed") {
        yield* markRunFailed(ctx, workflowStatus)
      }

      const summary = { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt }
      yield* writeSummary(runId, summary)
      yield* emit(config.onEvent, { type: "workflow_completed", runId })
      yield* appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus })

      return { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt } as WorkflowResult
    })

    return yield* body.pipe(
      Effect.ensuring(closeEngine(ctx))
    )
  })
}