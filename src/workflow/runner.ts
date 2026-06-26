import { Effect, Ref, Scope } from "effect"

import { WorkflowSpec } from "../types.js"

import { resolveArguments } from "../workflow/arguments.js"
import { type WorkflowEnv } from "../workflow/env.js"
import type { TemplateOptions } from "../prompts/template.js"

import { checkRecursionDepth, evaluateWhenCondition } from "../workflow/when-guard.js"

import { collectReachableTasks, topologicalSort } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import { EventBus, createSubscriber } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"

import { loadGuidelines } from "../guidelines/loader.js"
import { extractGuidelineArtifacts } from "../guidelines/extractor.js"
import { loadSkillRegistry } from "../skills/registry.js"
import { dispatchTask } from "./task-executor.js"
import { expandTemplate } from "../workflow/template-expander.js"
import { skillsDir, guidelinesDir } from "../paths.js"
import { loadTelemetryConfig } from "../telemetry/config.js"
import { loadScriptConfig } from "../workflow/script-config.js"
import { createRunDir, writeInput } from "../observability/run-dir.js"
import { WorkflowLogger } from "../observability/workflow-logger.js"

export interface WorkflowResult {
  runId: string
  status: "planned" | "in-progress" | "completed" | "failed" | "paused"
  taskResults: Record<string, string>
  env: Record<string, unknown>
  startedAt: string
  completedAt: string
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  templateOptions: TemplateOptions,
  existingRunId?: string,
  maxRecursionDepth?: number
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const startedAt = new Date().toISOString()

    const staticTasks = collectReachableTasks(spec.spec.tasks, spec.spec.run.entrypoint)
    const sortedTasks = topologicalSort(staticTasks)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, initialParameters, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    yield* _(DbWriter(ctx.db))

    const telemetryConfig = yield* _(loadTelemetryConfig)
    const fileEnabled = !telemetryConfig.disableStores.has("file")
    const scriptConfig = yield* _(loadScriptConfig)

    if (fileEnabled) {
      yield* _(createRunDir(ctx.runId))
      yield* _(writeInput(ctx.runId, {
        spec,
        initialParameters,
        executionContext: { project_dir: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
      }))
    }

    yield* _(WorkflowLogger(telemetryConfig, spec, initialParameters, startedAt))

    yield* _(bus.publish({ _tag: "WorkflowStarted", runId: ctx.runId }))

    const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))
    const { files: guidelineFiles, rules: allRules } = extractGuidelineArtifacts(loadedGuidelines)

    const skillRegistry = loadSkillRegistry(skillsDir())

    const workflowEnv: WorkflowEnv = {
      ...initialParameters,
      project_dir: (initialParameters.project_dir as string) ?? process.cwd(),
      tasks: {},
      run_id: ctx.runId
    }

    const resolveMaxRecursionDepth = (): number | null => {
      if (spec.spec.run.max_recursion_depth !== undefined) return spec.spec.run.max_recursion_depth
      return maxRecursionDepth ?? null
    }
    const taskResults: Record<string, string> = {}
    let totalTokensIn = 0
    let totalTokensOut = 0
    const workflowStatus = yield* _(Ref.make<"planned" | "in-progress" | "completed" | "failed" | "paused">("planned"))

    yield* _(bus.publish({ _tag: "WorkflowStatusChanged", runId: ctx.runId, status: "planned" }))

    const execState = {
      workflowStatus,
      taskResults,
      workflowEnv,
      fileEnabled
    }

    const body = Effect.gen(function* () {
      yield* _(createSubscriber(
        (b) => b.subscribeTo("TokenUsage"),
        (event) => Effect.sync(() => {
          totalTokensIn += event.tokensIn
          totalTokensOut += event.tokensOut
        })
      ))

      yield* _(Ref.set(workflowStatus, "in-progress"))
      yield* _(bus.publish({ _tag: "WorkflowStatusChanged", runId: ctx.runId, status: "in-progress" }))

      for (const task of sortedTasks) {
        const currentStatus = yield* _(Ref.get(workflowStatus))
        if (currentStatus === "failed") break

        if (task.when) {
          const maxDepth = resolveMaxRecursionDepth()
          const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
          if (depthResult === "fail") {
            yield* _(Ref.set(workflowStatus, "failed"))
            break
          }

          const whenResult = evaluateWhenCondition(task, workflowEnv)
          if (whenResult === "skip") {
            yield* _(ctx.transitionTask(task.name, "complete"))
            continue
          }
          if (typeof whenResult === "object" && whenResult._tag === "error") {
            yield* _(ctx.transitionTask(task.name, "fail"))
            yield* _(ctx.fail(whenResult.message))
            yield* _(Ref.set(workflowStatus, "failed"))
            break
          }
        }

        if (task.template) {
          const maxDepth = resolveMaxRecursionDepth()
          yield* _(expandTemplate(ctx, task, spec, workflowEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))
          continue
        }

        if (!task.agent && !task.script) continue

        const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
        if (!shouldExec) continue

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(bus.publish({ _tag: "TaskPaused", runId: ctx.runId, taskId: task.name, taskName: task.name }))
          yield* _(Ref.set(workflowStatus, "paused"))
          break
        }

        const resolvedArgs = resolveArguments(task, workflowEnv)
        const taskEnv: WorkflowEnv = {
          ...workflowEnv,
          parameters: resolvedArgs.parameters
        }
        yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))
      }

      const completedAt = new Date().toISOString()

      const finalStatus = yield* _(Ref.get(workflowStatus))

      if (finalStatus === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (finalStatus === "failed") {
        yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
      }

      const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const summary = { runId: ctx.runId, status: finalStatus, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }

      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: ctx.runId, summary }))

      return { runId: ctx.runId, status: finalStatus, taskResults, env: workflowEnv as Record<string, unknown>, startedAt, completedAt }
    })

    return yield* _(body.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: ctx.runId, message: String(error) }))
          yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
          return { runId: ctx.runId, status: "failed" as const, taskResults, env: workflowEnv as Record<string, unknown>, startedAt, completedAt: new Date().toISOString() }
        })
      ),
      Effect.ensuring(ctx.close())
    ))
  })
}
