import { Effect, Schedule, Duration } from "effect"
import { WorkflowSpec } from "../types.js"
import { buildAgentPrompt, extractContextFromOutput } from "../agent/activity.js"
import { resolvePersona } from "../agent/persona.js"
import { loadAgentSettings } from "../agent/config.js"
import { createRtkExtension } from "../agent/rtk-extension.js"
import { executeWithPi } from "../agent/pi-executor.js"
import { mergeContext } from "../workflow/context.js"
import { computeStepOrder, resolveStepTimeout, buildStepId } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import {
  createRunDir,
  writeInput,
  writeStepOutput,
  appendStepLog,
  writeSummary,
  appendEngineLog
} from "../observability/run-dir.js"

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
  config: WorkflowRunnerConfig,
  existingRunId?: string
): Effect.Effect<WorkflowResult, Error> {
  return Effect.gen(function* (_) {
    const startedAt = new Date().toISOString()
    const runningContext: Record<string, string> = { ...initialContext }
    const stepResults: Record<string, string> = { ...spec.context }
    const stepOrder = computeStepOrder(spec)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, runningContext, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    const runId = ctx.runId

    yield* _(createRunDir(runId))
    yield* _(writeInput(runId, { spec, initialContext }))
    yield* _(emit(config.onEvent, { type: "workflow_started", runId }))
    yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.slug }))

    let workflowStatus: "completed" | "failed" | "paused" = "completed"

    const body = Effect.gen(function* () {
      for (const stepSlug of stepOrder) {
        const shouldExec = yield* _(ctx.shouldExecuteStep(stepSlug))
        if (!shouldExec) continue

        const step = spec.steps.find((s) => s.slug === stepSlug)!
        const agent = spec.agents.find((a) => a.slug === step.agent)!
        const maxRetries = step.max_retries ?? 1
        const timeoutSeconds = resolveStepTimeout(spec, agent.slug)
        const model = agent.model

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(emit(config.onEvent, { type: "step_paused", runId, stepId: stepSlug, message: "step paused via deferred state" }))
          workflowStatus = "paused"
          break
        }

        const stepId = buildStepId(runId, stepSlug)

        yield* _(ctx.transitionStep(stepSlug, "start"))
        yield* _(emit(config.onEvent, { type: "step_started", runId, stepId }))
        yield* _(appendEngineLog(runId, { event: "step_started", stepId }))

        const persona = yield* _(
          resolvePersona(agent.slug, spec.slug).pipe(
            Effect.mapError((e) => new Error(e.message))
          )
        )

        const agentSettings = yield* _(Effect.match(loadAgentSettings(""), {
          onSuccess: (s) => s,
          onFailure: () => ({}) as Record<string, never>
        }))

        const prompt = buildAgentPrompt({
          agentsMd: persona.agents,
          identityMd: persona.identity,
          soulMd: persona.soul,
          stepInput: step.input,
          context: runningContext
        })

        yield* _(appendStepLog(runId, stepId, { event: "prompt_built" }))

        const rtkExtension = createRtkExtension({
          model: model ?? agentSettings.model,
          disabled: process.env.RTK_DISABLED === "1"
        })

        const output = yield* _(executeWithPi({
          systemPrompt: prompt.systemPrompt,
          taskPrompt: prompt.taskPrompt,
          stepId,
          agentId: agent.slug,
          runId,
          timeoutSeconds,
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
                  yield* _(emit(config.onEvent, {
                    type: "step_retry",
                    runId,
                    stepId,
                    message: "Retrying step"
                  }))
                  yield* _(appendStepLog(runId, stepId, { event: "retry" }))
                }).pipe(Effect.catchAll(() => Effect.void))
              )
            )
          )
        ))

        if (output === undefined || output === null) {
          yield* _(emit(config.onEvent, { type: "step_timeout", runId, stepId, message: "step timed out" }))
          yield* _(ctx.transitionStep(stepSlug, "fail"))
          yield* _(appendEngineLog(runId, { event: "step_timeout", stepId }))
          workflowStatus = "failed"
          break
        }

        yield* _(ctx.transitionStep(stepSlug, "complete"))
        yield* _(appendStepLog(runId, stepId, { event: "completed" }))
        yield* _(writeStepOutput(runId, stepId, output))

        const extracted = extractContextFromOutput(output)
        Object.assign(runningContext, extracted)
        Object.assign(runningContext, mergeContext(runningContext, output))

        if (output.status && typeof output.status === "string") {
          stepResults[stepSlug] = output.status
        }

        yield* _(emit(config.onEvent, { type: "step_completed", runId, stepId }))
        yield* _(appendEngineLog(runId, { event: "step_completed", stepId }))
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus === "failed") {
        yield* _(ctx.fail(workflowStatus).pipe(Effect.catchAll(() => Effect.void)))
      }

      const summary = { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt }
      yield* _(writeSummary(runId, summary))
      yield* _(emit(config.onEvent, { type: "workflow_completed", runId }))
      yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))

      return { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt } as WorkflowResult
    })

    return yield* _(body.pipe(
      Effect.ensuring(ctx.close())
    ))
  })
}