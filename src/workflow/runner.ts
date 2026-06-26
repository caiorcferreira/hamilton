import { Effect, Scope } from "effect"

import { WorkflowSpec, WorkflowTask } from "../types.js"
import { buildAgentsPrompts } from "../prompts/builder.js"

import { resolveArguments } from "../workflow/arguments.js"
import { type WorkflowEnv } from "../workflow/env.js"
import type { TemplateOptions } from "../prompts/template.js"
import { Template } from "../prompts/template.js"

import { checkRecursionDepth, evaluateWhenCondition } from "../workflow/when-guard.js"
import { resolveSystemPromptFragments } from "../prompts/system.js"
import { resolveAgentDefaults, loadModelAliases, resolveModelAlias } from "../agent/config.js"
import { executeWithPi } from "../executors/pi/pi-executor.js"
import { collectReachableTasks, topologicalSort, resolveTaskTimeout, buildTaskId, buildTaskInstanceName } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import {
  createRunDir,
  writeInput,
  writeTaskOutput,
  writeSummary,
  appendEngineLog
} from "../observability/run-dir.js"
import { EventBus, createSubscriber } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"
import * as ChildProcess from "node:child_process"
import { loadGuidelines } from "../guidelines/loader.js"
import { extractGuidelineArtifacts } from "../guidelines/extractor.js"
import { loadSkillRegistry } from "../skills/registry.js"
import { dispatchTask } from "./task-executor.js"
import { skillsDir, guidelinesDir } from "../paths.js"
import { loadTelemetryConfig } from "../telemetry/config.js"
import { loadScriptConfig } from "../workflow/script-config.js"

export interface WorkflowRunnerConfig {
  workflowsDir: string
  maxRecursionDepth?: number
  projectDir?: string
}

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
  env: WorkflowEnv
  startedAt: string
  completedAt: string
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  config: WorkflowRunnerConfig,
  templateOptions: TemplateOptions,
  existingRunId?: string
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const startedAt = new Date().toISOString()
    const settingsMaxDepth = config.maxRecursionDepth

    const staticTasks = collectReachableTasks(spec.spec.tasks, spec.spec.run.entrypoint)
    const sortedTasks = topologicalSort(staticTasks)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, initialParameters, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    const runId = ctx.runId

    yield* _(DbWriter(ctx.db))

    const telemetryConfig = yield* _(loadTelemetryConfig)
    const fileEnabled = !telemetryConfig.disableStores.has("file")
    const scriptConfig = yield* _(loadScriptConfig)

    if (fileEnabled) {
      yield* _(createRunDir(runId))
      yield* _(writeInput(runId, {
        spec,
        initialParameters,
        executionContext: { project_dir: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
      }))
    }

    yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))

    if (fileEnabled) {
      yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.metadata.name }))
    }

    const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))
    const { files: guidelineFiles, rules: allRules } = extractGuidelineArtifacts(loadedGuidelines)

    const skillRegistry = loadSkillRegistry(skillsDir())

    const workflowEnv: WorkflowEnv = {
      ...initialParameters,
      project_dir: config.projectDir ?? process.cwd(),
      tasks: {},
      run_id: runId
    }

    const resolveMaxRecursionDepth = (): number | null => {
      if (spec.spec.run.max_recursion_depth !== undefined) return spec.spec.run.max_recursion_depth
      return settingsMaxDepth ?? null
    }
    const taskResults: Record<string, string> = {}
    let totalTokensIn = 0
    let totalTokensOut = 0
    const workflowStatus = { value: "completed" as string }

    const execState = {
      workflowStatus,
      taskResults,
      workflowEnv
    }

    const body = Effect.gen(function* () {
      yield* _(createSubscriber(
        (b) => b.subscribeTo("TokenUsage"),
        (event) => Effect.sync(() => {
          totalTokensIn += event.tokensIn
          totalTokensOut += event.tokensOut
        })
      ))

      for (const task of sortedTasks) {
        if (workflowStatus.value === "failed") break

        if (task.when) {
          const maxDepth = resolveMaxRecursionDepth()
          const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, task.name))
          if (depthResult === "fail") {
            workflowStatus.value = "failed"
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
            workflowStatus.value = "failed"
            break
          }
        }

        if (task.template) {
          const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
          if (!templateTask) continue

          const resolvedArgs = resolveArguments(task, workflowEnv)

          const compoundParentTaskId = ctx.compoundTaskIds.get(task.name) ?? undefined

          for (let i = 0; i < resolvedArgs.itemsCount; i++) {
            if (workflowStatus.value === "failed") break

            const instanceName = buildTaskInstanceName(task.name, i)
            const taskEnv: WorkflowEnv = {
              ...workflowEnv,
              parameters: resolvedArgs.parameters
            }

            if (templateTask.tasks && templateTask.tasks.length > 0) {
              workflowEnv.currentIteration = { tasks: {} }
              const sub = topologicalSort(templateTask.tasks)
              for (const subTask of sub) {
                if (workflowStatus.value === "failed") break
                const subInstanceName = buildTaskInstanceName(instanceName, subTask.name)

                if (subTask.when) {
                  const maxDepth = resolveMaxRecursionDepth()
                  const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, subInstanceName))
                  if (depthResult === "fail") {
                    workflowStatus.value = "failed"
                    break
                  }

                  const whenResult = evaluateWhenCondition(subTask, workflowEnv)
                  if (whenResult === "skip") {
                    yield* _(ctx.transitionTask(subInstanceName, "complete"))
                    continue
                  }
                  if (typeof whenResult === "object" && whenResult._tag === "error") {
                    yield* _(ctx.transitionTask(subInstanceName, "fail"))
                    yield* _(ctx.fail(whenResult.message))
                    workflowStatus.value = "failed"
                    break
                  }
                }

                if (subTask.template) {
                  const nestedTemplate = spec.spec.tasks.find((t: WorkflowTask) => t.name === subTask.template)
                  if (!nestedTemplate) continue

                  const nestedArgs = resolveArguments(subTask, workflowEnv)
                  const nestedEnv: WorkflowEnv = { ...workflowEnv, parameters: nestedArgs.parameters }

                  const subRef = nestedTemplate.agent?.executorRef ?? nestedTemplate.tasks?.[0]?.agent?.executorRef ?? "script"
                  yield* _(ctx.insertDynamicTask(subInstanceName, subRef, compoundParentTaskId))

                  if (nestedTemplate.tasks && nestedTemplate.tasks.length > 0) {
                    const savedIteration: WorkflowEnv["currentIteration"] = workflowEnv.currentIteration
                    workflowEnv.currentIteration = { tasks: {} }
                    const nestedSub = topologicalSort(nestedTemplate.tasks)
                    for (const nestedSubTask of nestedSub) {
                      if (workflowStatus.value === "failed") break
                      const nestedInstanceName = buildTaskInstanceName(subInstanceName, nestedSubTask.name)
                      const nestedRef = nestedSubTask.agent?.executorRef ?? "script"
                      yield* _(ctx.insertDynamicTask(nestedInstanceName, nestedRef, compoundParentTaskId))
                      yield* _(dispatchTask(nestedSubTask, nestedEnv, nestedInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
                      const nestedOutput = workflowEnv.tasks?.[nestedInstanceName]
                      if (nestedOutput && workflowEnv.currentIteration?.tasks) {
                        workflowEnv.currentIteration.tasks[nestedSubTask.name] = nestedOutput
                      }
                    }
                    delete workflowEnv.currentIteration
                    workflowEnv.currentIteration = savedIteration
                  } else if (nestedTemplate.agent || nestedTemplate.script) {
                    yield* _(dispatchTask(nestedTemplate, nestedEnv, subInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
                  }
                  const subOutput = workflowEnv.tasks?.[subInstanceName]
                  if (subOutput && workflowEnv.currentIteration?.tasks) {
                    workflowEnv.currentIteration.tasks[subTask.name] = subOutput
                  }
                  continue
                }

                const subRef = subTask.agent?.executorRef ?? "script"
                yield* _(ctx.insertDynamicTask(subInstanceName, subRef, compoundParentTaskId))
                yield* _(dispatchTask(subTask, taskEnv, subInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
                const subOutput = workflowEnv.tasks?.[subInstanceName]
                if (subOutput && workflowEnv.currentIteration?.tasks) {
                  workflowEnv.currentIteration.tasks[subTask.name] = subOutput
                }
              }
              delete workflowEnv.currentIteration
            } else if (templateTask.agent || templateTask.script) {
              const ref = templateTask.agent?.executorRef ?? "script"
              yield* _(ctx.insertDynamicTask(instanceName, ref, compoundParentTaskId))
              yield* _(dispatchTask(templateTask, taskEnv, instanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
            }
          }
          continue
        }

        if (!task.agent && !task.script) continue

        const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
        if (!shouldExec) continue

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(bus.publish({ _tag: "TaskPaused", runId, taskId: task.name, taskName: task.name }))
          workflowStatus.value = "paused"
          break
        }

        const resolvedArgs = resolveArguments(task, workflowEnv)
        const taskEnv: WorkflowEnv = {
          ...workflowEnv,
          parameters: resolvedArgs.parameters
        }
        yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, execState))
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus.value === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus.value === "failed") {
        yield* _(ctx.fail(workflowStatus.value).pipe(Effect.catchAll(() => Effect.void)))
      }

      const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const summary = { runId, status: workflowStatus.value, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }
      if (fileEnabled) {
        yield* _(writeSummary(runId, summary))
      }
      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
      if (fileEnabled) {
        yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus.value }))
      }

      return { runId, status: workflowStatus.value, taskResults, env: workflowEnv, startedAt, completedAt } as WorkflowResult
    })

    const completedAt = new Date().toISOString()

    return yield* _(body.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* _(bus.publish({ _tag: "WorkflowCompleted", runId, message: String(error) }))
          if (fileEnabled) {
            yield* _(appendEngineLog(runId, { event: "workflow_failed", error: String(error) }))
          }
          yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
          if (fileEnabled) {
            yield* _(writeSummary(runId, { runId, status: "failed", taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) }))
          }
          return { runId, status: "failed" as const, taskResults, env: workflowEnv, startedAt, completedAt }
        })
      ),
      Effect.ensuring(ctx.close())
    ))
  })
}
