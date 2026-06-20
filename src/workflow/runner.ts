import { Effect, Schedule, Duration, Scope } from "effect"
import { WorkflowSpec, WorkflowTask } from "../types.js"
import { buildAgentPrompt } from "../prompts/builder.js"

import { resolveArguments } from "../workflow/arguments.js"
import { type WorkflowEnv } from "../workflow/env.js"
import type { TemplateOptions } from "../prompts/template.js"

import { resolvePersona } from "../prompts/persona.js"
import { resolveAgentDefaults, loadModelAliases, resolveModelAlias } from "../agent/config.js"
import { executeWithPi } from "../executors/pi/pi-executor.js"
import { collectReachableTasks, topologicalSort, resolveTaskTimeout, buildTaskId } from "../workflow/engine.js"
import { createWorkflowRuntime } from "../workflow/run-state-machine.js"
import type { WorkflowRuntime } from "../workflow/run-state-machine.js"
import {
  createRunDir,
  writeInput,
  writeTaskOutput,
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
import { loadTelemetryConfig } from "../telemetry/config.js"

export interface WorkflowRunnerConfig {
  workflowsDir: string
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

    if (fileEnabled) {
      yield* _(createRunDir(runId))
      yield* _(writeInput(runId, {
        spec,
        initialParameters,
        executionContext: { cwd: process.cwd(), requestedAt: startedAt, workflowName: spec.metadata.name }
      }))
    }

    yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))

    if (fileEnabled) {
      yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.metadata.name }))
    }

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

    const workflowEnv: WorkflowEnv = {
      ...initialParameters,
      tasks: {},
      run_id: runId,
      progress_file: progressFilePath,
      progress: progressContent
    }
    const taskResults: Record<string, string> = {}
    let totalTokensIn = 0
    let totalTokensOut = 0
    let workflowStatus: string = "completed"

    const executeSingleTask = (
      task: WorkflowTask,
      taskEnv: WorkflowEnv,
      instanceName: string
    ): Effect.Effect<void, unknown, EventBus | Scope.Scope> =>
      Effect.gen(function* () {
        if (!task.agent) return

        const agent = spec.agentRegistry.get(task.agent.executorRef)
        if (!agent) return

        const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(runId, instanceName)

        yield* _(ctx.transitionTask(instanceName, "start"))
        yield* _(bus.publish({ _tag: "TaskStarted", runId, taskId, taskName: instanceName }))

        const persona = yield* _(
          resolvePersona(agent.systemPrompt, agent.dirPath).pipe(
            Effect.mapError((e) => new Error(e.agentPath))
          )
        )

        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          contextTemplate: persona.context,
          prompt: task.agent!.prompt,
          env: taskEnv,
          agentConfig: agent
        }, guidelineFiles, templateOptions)

        let taskPromptContent = prompt.taskPrompt
        if (task.agent?.output?.schema?.content) {
          const schemaJson = JSON.stringify(task.agent.output.schema.content, null, 2)
          taskPromptContent = `<expected_output_schema>\n${schemaJson}\n</expected_output_schema>\n\n<task>\n${taskPromptContent}\n</task>`
        }
        if (task.name === spec.spec.run.entrypoint) {
          taskPromptContent = `${taskPromptContent}\n\n# User input\n\n${taskEnv.user_input ?? ""}`
        }
        const finalPrompt = { ...prompt, taskPrompt: taskPromptContent }

        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId,
          taskId,
          systemPrompt: finalPrompt.systemPrompt,
          taskPrompt: finalPrompt.taskPrompt,
          guidelineFiles: guidelineFiles.map(g => g.name)
        }))

        const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)
        const resolved = resolveAgentDefaults(agent.spec.settings, agent.spec.systemPrompt)
        const aliases = loadModelAliases()
        const model = resolveModelAlias(resolved.model, aliases)
        const outputSchema = task.agent!.output?.schema

        const output = yield* _(
          executeWithPi({
            prompt: finalPrompt,
            taskId,
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
                    yield* _(bus.publish({ _tag: "TaskRetrying", runId, taskId, taskName: instanceName }))
                  }).pipe(Effect.catchAll(() => Effect.void))
                )
              )
            )
          )
        )

        if (output === undefined || output === null) {
          yield* _(bus.publish({ _tag: "TaskTimedOut", runId, taskId, taskName: instanceName }))
          yield* _(ctx.transitionTask(instanceName, "fail"))
          workflowStatus = "failed"
          return
        }

        taskResults[instanceName] = String(output.status ?? "done")
        if (!workflowEnv.tasks) workflowEnv.tasks = {}
        workflowEnv.tasks[instanceName] = { outputs: output as Record<string, unknown> }

        yield* _(ctx.transitionTask(instanceName, "complete"))
        if (fileEnabled) {
          yield* _(writeTaskOutput(runId, taskId, output))
        }
        yield* _(bus.publish({ _tag: "TaskCompleted", runId, taskId, taskName: instanceName }))
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

          const resolvedArgs = resolveArguments(task, workflowEnv)

          for (let i = 0; i < resolvedArgs.itemsCount; i++) {
            if (workflowStatus === "failed") break

            const instanceName = `${task.name}/${i}`
            const taskEnv: WorkflowEnv = {
              ...workflowEnv,
              parameters: resolvedArgs.parameters
            }

            if (templateTask.tasks && templateTask.tasks.length > 0) {
              const sub = topologicalSort(templateTask.tasks)
              for (const subTask of sub) {
                if (workflowStatus === "failed") break
                const subInstanceName = `${instanceName}-${subTask.name}`
                yield* _(ctx.insertDynamicTask(subInstanceName, subTask.agent!.executorRef))
                yield* _(executeSingleTask(subTask, taskEnv, subInstanceName))
              }
            } else if (templateTask.agent) {
              yield* _(ctx.insertDynamicTask(instanceName, templateTask.agent!.executorRef))
              yield* _(executeSingleTask(templateTask, taskEnv, instanceName))
            }
          }
          continue
        }

        if (!task.agent) continue

        const shouldExec = yield* _(ctx.shouldExecuteTask(task.name))
        if (!shouldExec) continue

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(bus.publish({ _tag: "TaskPaused", runId, taskId: task.name, taskName: task.name }))
          workflowStatus = "paused"
          break
        }

        const resolvedArgs = resolveArguments(task, workflowEnv)
        const taskEnv: WorkflowEnv = {
          ...workflowEnv,
          parameters: resolvedArgs.parameters
        }
        yield* _(executeSingleTask(task, taskEnv, task.name))
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus === "failed") {
        yield* _(ctx.fail(workflowStatus).pipe(Effect.catchAll(() => Effect.void)))
      }

      const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const summary = { runId, status: workflowStatus, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }
      if (fileEnabled) {
        yield* _(writeSummary(runId, summary))
      }
      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
      if (fileEnabled) {
        yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))
      }

      return { runId, status: workflowStatus, taskResults, env: workflowEnv, startedAt, completedAt } as WorkflowResult
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