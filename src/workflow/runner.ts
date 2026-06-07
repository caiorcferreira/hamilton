import { Effect, Schedule, Duration, Scope } from "effect"
import { WorkflowSpec } from "../types.js"
import { buildAgentPrompt } from "../agent/activity.js"
import { mergeContext, resolveTemplate, type Context } from "../workflow/context.js"
import { resolvePersona } from "../agent/persona.js"
import { loadAgentSettings } from "../agent/config.js"
import { createRtkExtension } from "../agent/rtk-extension.js"
import { executeWithPi } from "../agent/pi-executor.js"
import { computeStepOrder, resolveStepTimeout, buildStepId } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import {
  createRunDir,
  writeInput,
  writeStepOutput,
  writeSummary,
  appendEngineLog
} from "../observability/run-dir.js"
import { EventBus } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"
import { createGitWorktree, cleanupGitWorktree, WorktreeError } from "../workflow/deterministic-activities.js"

export interface WorkflowRunnerConfig {
  workflowsDir: string
}

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
  context: Context
  startedAt: string
  completedAt: string
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialContext: Context,
  config: WorkflowRunnerConfig,
  existingRunId?: string
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const startedAt = new Date().toISOString()
    const runningContext: Context = { ...initialContext }
    const stepResults: Record<string, string> = {}
    if (spec.context) {
      for (const [k, v] of Object.entries(spec.context)) {
        if (typeof v === "string") stepResults[k] = v
      }
    }
    const stepOrder = computeStepOrder(spec)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, runningContext, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    const runId = ctx.runId

    yield* _(DbWriter(ctx.db))

    yield* _(createRunDir(runId))
    yield* _(writeInput(runId, {
      spec,
      initialContext,
      executionContext: {
        cwd: process.cwd(),
        requestedAt: startedAt,
        workflowSlug: spec.slug
      }
    }))
    yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))
    yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.slug }))

    let workflowStatus: "completed" | "failed" | "paused" = "completed"

    const body = Effect.gen(function* () {
      for (const stepSlug of stepOrder) {
        const shouldExec = yield* _(ctx.shouldExecuteStep(stepSlug))
        if (!shouldExec) continue

        const step = spec.steps.find((s) => s.slug === stepSlug)!
        const agent = spec.agents.find((a) => a.slug === step.agent)!
        const maxRetries = step.on_fail?.max_retries ?? 1
        const timeoutSeconds = resolveStepTimeout(spec, step.slug)
        const model = agent.model

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(bus.publish({ _tag: "StepPaused", runId, stepId: stepSlug }))
          workflowStatus = "paused"
          break
        }

        const stepId = buildStepId(runId, stepSlug)

        yield* _(ctx.transitionStep(stepSlug, "start"))
        yield* _(bus.publish({ _tag: "StepStarted", runId, stepId }))
        yield* _(appendEngineLog(runId, { event: "step_started", stepId }))

        if (step.type === "create_git_worktree") {
          const resolvedInput = resolveTemplate(step.input, runningContext)
          const worktreeParams = JSON.parse(resolvedInput) as { repo: string; branch: string; worktreePath?: string }
          const result = yield* _(
            createGitWorktree(worktreeParams, stepId).pipe(
              Effect.mapError((e) => new Error(e.message))
            )
          )
          Object.assign(runningContext, { worktree_path: result.worktreePath, worktree_branch: result.branch })
          stepResults[stepSlug] = "done"
          yield* _(ctx.transitionStep(stepSlug, "complete"))
          yield* _(writeStepOutput(runId, stepId, { status: "done", worktree_path: result.worktreePath, worktree_branch: result.branch }))
          yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId }))
          yield* _(appendEngineLog(runId, { event: "step_completed", stepId }))
          continue
        }

        if (step.type === "cleanup_git_worktree") {
          const resolvedInput = resolveTemplate(step.input, runningContext)
          const cleanupParams = JSON.parse(resolvedInput) as { worktreePath: string }
          const result = yield* _(
            cleanupGitWorktree(cleanupParams, stepId).pipe(
              Effect.mapError((e) => new Error(e.message))
            )
          )
          stepResults[stepSlug] = "done"
          yield* _(ctx.transitionStep(stepSlug, "complete"))
          yield* _(writeStepOutput(runId, stepId, { status: "done", cleaned: result.cleaned }))
          yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId }))
          yield* _(appendEngineLog(runId, { event: "step_completed", stepId }))
          continue
        }

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

        yield* _(bus.publish({ _tag: "PromptBuilt", runId, stepId, systemPrompt: prompt.systemPrompt, taskPrompt: prompt.taskPrompt }))

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
            skills: agentSettings.skills,
            retryOnTransient: agentSettings.retryOnTransient,
            compactionEnabled: agentSettings.compactionEnabled
          }
        }).pipe(
          Effect.timeout(Duration.seconds(timeoutSeconds)),
          Effect.retry(
            Schedule.recurs(maxRetries - 1).pipe(
              Schedule.tapInput((_error: unknown) =>
                Effect.gen(function* () {
                  yield* _(bus.publish({ _tag: "StepRetrying", runId, stepId }))
                }).pipe(Effect.catchAll(() => Effect.void))
              )
            )
          )
        ))

        if (output === undefined || output === null) {
          yield* _(bus.publish({ _tag: "StepTimedOut", runId, stepId }))
          yield* _(ctx.transitionStep(stepSlug, "fail"))
          yield* _(appendEngineLog(runId, { event: "step_timeout", stepId }))
          workflowStatus = "failed"
          break
        }

        yield* _(ctx.transitionStep(stepSlug, "complete"))
        yield* _(writeStepOutput(runId, stepId, output))

        const extracted = mergeContext(runningContext, output)
        Object.assign(runningContext, extracted)

        if (output.status && typeof output.status === "string") {
          stepResults[stepSlug] = output.status
        }

        yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId }))
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
      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
      yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))

      return { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt } as WorkflowResult
    })

    const completedAt = new Date().toISOString()

    return yield* _(body.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* _(bus.publish({ _tag: "WorkflowCompleted", runId, message: String(error) }))
          yield* _(appendEngineLog(runId, { event: "workflow_failed", error: String(error) }))
          yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
          yield* _(writeSummary(runId, { runId, status: "failed", stepResults, context: runningContext, startedAt, completedAt }))
          return { runId, status: "failed" as const, stepResults, context: runningContext, startedAt, completedAt }
        })
      ),
      Effect.ensuring(ctx.close())
    ))
  })
}