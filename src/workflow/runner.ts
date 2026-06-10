import { Effect, Schedule, Duration, Scope } from "effect"
import { WorkflowSpec, WorkflowTask } from "../types.js"
import { buildAgentPrompt } from "../prompts/builder.js"
import { buildAutoContext, type Context } from "../workflow/context.js"
import { resolveDottedPath } from "../prompts/template.js"
import { resolvePersona } from "../prompts/persona.js"
import { resolveAgentDefaults, loadModelAliases, resolveModelAlias } from "../agent/config.js"
import { executeWithPi } from "../executors/pi/pi-executor.js"
import { collectReachableTasks, topologicalSort, resolveTaskTimeout, buildTaskId } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import {
  createRunDir,
  writeInput,
  writeStepOutput,
  writeSummary,
  appendEngineLog,
  ensureProgressFile
} from "../observability/run-dir.js"
import { EventBus, createSubscriber } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"
import * as Fs from "node:fs"
import { loadGuidelines } from "../guidelines/loader.js"
import { loadSkillRegistry, resolveSkills } from "../skills/registry.js"
import { skillsDir, guidelinesDir } from "../paths.js"

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

    const staticTasks = collectReachableTasks(spec.spec.tasks, spec.spec.run.entrypoint)
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
      executionContext: { cwd: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
    }))
    yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))
    yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.metadata.name }))

    const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))

    const guidelineFiles: Array<{ name: string; content: string }> = []
    const allRules: import("../guidelines/types.js").CompiledRule[] = []

    for (const g of loadedGuidelines) {
      if (g.instructions) {
        for (const inst of g.instructions) {
          guidelineFiles.push(inst)
        }
      }
      if (g.rules) {
        for (const rule of g.rules) {
          allRules.push(rule)
        }
      }
    }

    const skillRegistry = loadSkillRegistry(skillsDir())

    const progressFilePath = yield* _(ensureProgressFile(runId))
    const progressContent = Fs.existsSync(progressFilePath)
      ? Fs.readFileSync(progressFilePath, "utf-8")
      : ""

    const runningContext: Context = { ...initialContext, tasks: {}, run_id: runId, progress_file: progressFilePath, progress: progressContent }
    const taskResults: Record<string, string> = {}
    let totalTokensIn = 0
    let totalTokensOut = 0
    let workflowStatus: string = "completed"

    const executeSingleTask = (
      task: WorkflowTask,
      taskContext: Context,
      instanceName: string
    ): Effect.Effect<void, unknown, EventBus | Scope.Scope> =>
      Effect.gen(function* () {
        if (!task.agent) return

        const agent = spec.agentRegistry.get(task.agent.executorRef)
        if (!agent) return

        const taskId = buildTaskId(runId, instanceName)

        yield* _(ctx.transitionTask(instanceName, "start"))
        yield* _(bus.publish({ _tag: "StepStarted", runId, stepId: taskId }))

        const persona = yield* _(
          resolvePersona(agent.systemPrompt, agent.dirPath).pipe(
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
        }, guidelineFiles)

        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId,
          stepId: taskId,
          systemPrompt: prompt.systemPrompt,
          taskPrompt: prompt.taskPrompt
        }))

        const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)
        const resolved = resolveAgentDefaults(agent.spec.settings, agent.spec.systemPrompt)
        const aliases = loadModelAliases()
        const model = resolveModelAlias(resolved.model, aliases)
        const outputSchema = task.agent!.output?.schema

        const output = yield* _(
          executeWithPi({
            prompt,
            stepId: taskId,
            agentId: agent.metadata.name,
            runId,
            timeoutSeconds,
            model,
            outputSchema: outputSchema?.content,
            rules: allRules.length > 0 ? allRules : undefined,
            settings: {
              skills: resolveSkills(resolved.skills, skillRegistry),
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
      yield* _(createSubscriber(
        (b) => b.subscribeTo("TokenUsage"),
        (event) => Effect.sync(() => {
          totalTokensIn += event.tokensIn
          totalTokensOut += event.tokensOut
        })
      ))

      for (const task of sortedTasks) {
        if (workflowStatus === "failed") break

        if (task.template) {
          const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
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

      const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const summary = { runId, status: workflowStatus, taskResults, context: runningContext, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }
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
          yield* _(writeSummary(runId, { runId, status: "failed", taskResults, context: runningContext, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) }))
          return { runId, status: "failed" as const, taskResults, context: runningContext, startedAt, completedAt }
        })
      ),
      Effect.ensuring(ctx.close())
    ))
  })
}