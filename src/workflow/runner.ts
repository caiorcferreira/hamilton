import { Effect, Schedule, Duration, Scope } from "effect"
import { WorkflowSpec, WorkflowTask } from "../types.js"
import { buildAgentPrompt } from "../agent/activity.js"
import { buildAutoContext, resolveDottedPath, type Context } from "../workflow/context.js"
import { resolvePersona } from "../agent/persona.js"
import { resolveAgentDefaults } from "../agent/config.js"
import { executeWithPi } from "../agent/pi-executor.js"
import { collectReachableTasks, topologicalSort, resolveTaskTimeout, buildTaskId } from "../workflow/engine.js"
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
import { ensureSharedAgentsSymlink } from "../workflow/shared-agents.js"
import { DbWriter } from "../db/subscribers.js"

export interface WorkflowRunnerConfig {
  workflowsDir: string
}

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
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
    const workflowDir = `${config.workflowsDir}/${spec.name}`

    yield* _(ensureSharedAgentsSymlink(workflowDir))

    const staticTasks = collectReachableTasks(spec.tasks, spec.run.entrypoint)
    const sortedTasks = topologicalSort(staticTasks)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, initialContext, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    const runId = ctx.runId

    yield* _(DbWriter(ctx.db))
    yield* _(createRunDir(runId))
    yield* _(writeInput(runId, {
      spec,
      initialContext,
      executionContext: { cwd: process.cwd(), requestedAt: startedAt, workflowName: spec.name }
    }))
    yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))
    yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.name }))

    const runningContext: Context = { ...initialContext, tasks: {} }
    const taskResults: Record<string, string> = {}
    let workflowStatus: string = "completed"

    const executeSingleTask = (
      task: WorkflowTask,
      taskContext: Context,
      instanceName: string
    ): Effect.Effect<void, unknown, EventBus | Scope.Scope> =>
      Effect.gen(function* () {
        if (!task.agent) return

        const agentName = task.agent.ref.replace("agents.", "")
        const agent = spec.agents.find(a => a.name === agentName)
        if (!agent) return

        const taskId = buildTaskId(runId, instanceName)

        yield* _(ctx.transitionTask(instanceName, "start"))
        yield* _(bus.publish({ _tag: "StepStarted", runId, stepId: taskId }))

        const persona = yield* _(
          resolvePersona(agent.settings.systemPrompt, workflowDir).pipe(
            Effect.mapError((e) => new Error(e.agentPath))
          )
        )

        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          identityFile: persona.identity,
          prompt: task.agent!.prompt,
          context: taskContext,
          agentConfig: agent
        })

        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId,
          stepId: taskId,
          systemPrompt: prompt.systemPrompt,
          taskPrompt: prompt.taskPrompt
        }))

        const timeoutSeconds = resolveTaskTimeout(task, spec.run.timeout)
        const resolved = resolveAgentDefaults(agent.settings)
        const outputSchema = task.agent!.output?.schema

        const output = yield* _(
          executeWithPi({
            systemPrompt: prompt.systemPrompt,
            taskPrompt: prompt.taskPrompt,
            stepId: taskId,
            agentId: agent.name,
            runId,
            timeoutSeconds,
            model: resolved.model,
            outputSchema,
            settings: {
              skills: resolved.skills,
              thinking: undefined,
              tools: undefined,
              retryOnTransient: undefined,
              compactionEnabled: undefined
            }
          }).pipe(
            Effect.timeout(Duration.seconds(timeoutSeconds)),
            Effect.retry(
              Schedule.recurs((task.agent!.on_failure?.max_retries ?? 1) - 1).pipe(
                Schedule.tapInput(() =>
                  Effect.gen(function* () {
                    yield* _(bus.publish({ _tag: "StepRetrying", runId, stepId: taskId }))
                  }).pipe(Effect.catchAll(() => Effect.void))
                )
              )
            )
          )
        )

        if (output === undefined || output === null) {
          yield* _(bus.publish({ _tag: "StepTimedOut", runId, stepId: taskId }))
          yield* _(ctx.transitionTask(instanceName, "fail"))
          workflowStatus = "failed"
          return
        }

        taskResults[instanceName] = String(output.status ?? "done")
        if (!runningContext.tasks) (runningContext as Record<string, unknown>).tasks = {}
        ;(runningContext.tasks as Record<string, unknown>)[instanceName] = { outputs: output }

        yield* _(ctx.transitionTask(instanceName, "complete"))
        yield* _(writeStepOutput(runId, taskId, output))
        yield* _(bus.publish({ _tag: "StepCompleted", runId, stepId: taskId }))
      })

    const body = Effect.gen(function* () {
      for (const task of sortedTasks) {
        if (workflowStatus === "failed") break

        if (task.template) {
          const templateTask = spec.tasks.find(t => t.name === task.template)
          if (!templateTask) continue

          const arrValue = task.forEach
            ? resolveDottedPath(runningContext, task.forEach.valueFrom.ref)
            : undefined
          const items = Array.isArray(arrValue) ? arrValue : [undefined]

          for (let i = 0; i < items.length; i++) {
            if (workflowStatus === "failed") break

            const instanceName = `${task.name}/${i}`
            const vars: Context = {}
            if (task.forEach && items[i] !== undefined) {
              vars[task.forEach.as] = items[i]
            }

            const subContext = buildAutoContext(task, runningContext, vars)

            if (templateTask.tasks && templateTask.tasks.length > 0) {
              const sub = topologicalSort(templateTask.tasks)
              for (const subTask of sub) {
                if (workflowStatus === "failed") break
                const subInstanceName = `${instanceName}-${subTask.name}`
                yield* _(executeSingleTask(subTask, subContext, subInstanceName))
              }
            } else if (templateTask.agent) {
              yield* _(executeSingleTask(templateTask, subContext, instanceName))
            }
          }
          continue
        }

        if (!task.agent) continue

        const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
        if (!shouldExec) continue

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(bus.publish({ _tag: "StepPaused", runId, stepId: task.name }))
          workflowStatus = "paused"
          break
        }

        const taskContext = buildAutoContext(task, runningContext, {})
        yield* _(executeSingleTask(task, taskContext, task.name))
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus === "failed") {
        yield* _(ctx.fail(workflowStatus).pipe(Effect.catchAll(() => Effect.void)))
      }

      const summary = { runId, status: workflowStatus, taskResults, context: runningContext, startedAt, completedAt }
      yield* _(writeSummary(runId, summary))
      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
      yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))

      return { runId, status: workflowStatus, taskResults, context: runningContext, startedAt, completedAt } as WorkflowResult
    })

    const completedAt = new Date().toISOString()

    return yield* _(body.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* _(bus.publish({ _tag: "WorkflowCompleted", runId, message: String(error) }))
          yield* _(appendEngineLog(runId, { event: "workflow_failed", error: String(error) }))
          yield* _(ctx.fail("failed").pipe(Effect.catchAll(() => Effect.void)))
          yield* _(writeSummary(runId, { runId, status: "failed", taskResults, context: runningContext, startedAt, completedAt }))
          return { runId, status: "failed" as const, taskResults, context: runningContext, startedAt, completedAt }
        })
      ),
      Effect.ensuring(ctx.close())
    ))
  })
}