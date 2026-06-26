import { Effect, Schedule, Duration, Scope } from "effect"

import { WorkflowSpec, WorkflowTask } from "../types.js"
import { buildAgentPrompt } from "../prompts/builder.js"

import { resolveArguments } from "../workflow/arguments.js"
import { type WorkflowEnv } from "../workflow/env.js"
import type { TemplateOptions } from "../prompts/template.js"
import { Template } from "../prompts/template.js"

import { evaluateWhen, WhenError } from "../cel/evaluate.js"
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
  appendEngineLog
} from "../observability/run-dir.js"
import { EventBus, createSubscriber } from "../events/bus.js"
import { DbWriter } from "../db/subscribers.js"
import * as ChildProcess from "node:child_process"
import { loadGuidelines } from "../guidelines/loader.js"
import { loadSkillRegistry, resolveSkills } from "../skills/registry.js"
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
    let workflowStatus: string = "completed"

    const executeAgentTask = (
      task: WorkflowTask,
      taskEnv: WorkflowEnv,
      instanceName: string,
      taskId: string
    ): Effect.Effect<void, unknown, EventBus | Scope.Scope> =>
      Effect.gen(function* () {
        if (!task.agent) return

        const agent = spec.agentRegistry.get(task.agent.executorRef)
        if (!agent) return

        const persona = yield* _(
          resolvePersona(agent.systemPrompt, agent.dirPath).pipe(
            Effect.mapError((e) => new Error(e.agentPath))
          )
        )

        const agentPrompts = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          contextTemplate: persona.context,
          prompt: task.agent!.prompt,
          env: taskEnv,
          agentConfig: agent
        }, guidelineFiles, templateOptions)

        // TODO: move this logic (output schema, user prompt) to inside buildAgentPrompt
        let taskPromptContent = Effect.runSync(agentPrompts.taskTemplate.render())
        const systemPromptContent = Effect.runSync(agentPrompts.systemTemplate.render())
        if (task.agent?.output?.schema?.content) {
          const schemaJson = JSON.stringify(task.agent.output.schema.content, null, 2)
          taskPromptContent = `<task>\n${taskPromptContent}\n</task>\n\n<task_output_schema>\n${schemaJson}\n</task_output_schema>`
        }
        if (task.name === spec.spec.run.entrypoint) {
          taskPromptContent = `${taskPromptContent}\n\n<user_prompt>\n\n${taskEnv.user_input ?? ""}\n</user_prompt>`
        }

        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId,
          taskId,
          systemPrompt: systemPromptContent,
          taskPrompt: taskPromptContent,
          guidelineFiles: guidelineFiles.map(g => g.name)
        }))

        const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)
        const resolved = resolveAgentDefaults(agent.spec.settings, agent.spec.systemPrompt)
        const aliases = loadModelAliases()
        const model = resolveModelAlias(resolved.model, aliases)
        const outputSchema = task.agent!.output?.schema

        const output = yield* _(
          executeWithPi({
            prompt: {
              systemTemplate: agentPrompts.systemTemplate,
              taskTemplate: agentPrompts.taskTemplate,
              guidelineFiles: agentPrompts.guidelineFiles
            },
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

    const executeScriptTask = (
      task: WorkflowTask,
      taskEnv: WorkflowEnv,
      instanceName: string,
      taskId: string
    ): Effect.Effect<void, unknown, EventBus | Scope.Scope> =>
      Effect.gen(function* () {
        if (!task.script) return

        const renderedCommand = Effect.runSync(
          Template.make(task.script.command, templateOptions)
            .setVar("inputs", taskEnv)
            .render()
        )
        const workdir = task.script.workdir ?? (taskEnv.cwd as string | undefined) ?? process.cwd()
        const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)
        const maxRetries = task.script.on_failure?.max_retries ?? 1

        const runScript = (): Effect.Effect<{ stdout: string; stderr: string; exitCode: number; status: string }, { stdout: string; stderr: string; exitCode: number; status: string }> =>
          Effect.try({
            try: () => {
              const stdout = ChildProcess.execSync(renderedCommand, {
                cwd: workdir,
                timeout: timeoutSeconds * 1000,
                encoding: "utf-8",
                maxBuffer: scriptConfig.maxOutputBytes
              })
              return { stdout: stdout.trim(), stderr: "", exitCode: 0, status: "done" }
            },
            catch: (e: any) => {
              const stdout = (e.stdout as string | undefined) ?? ""
              const stderr = (e.stderr as string | undefined) ?? String(e)
              const exitCode = (e.status as number | undefined) ?? 1
              return { stdout: String(stdout).trim(), stderr: String(stderr), exitCode, status: "failed" }
            }
          }).pipe(
            Effect.flatMap((result) =>
              result.status === "done" ? Effect.succeed(result) : Effect.fail(result)
            )
          )

        const output = yield* _(
          runScript().pipe(
            Effect.retry(
              Schedule.recurs(maxRetries - 1).pipe(
                Schedule.tapInput(() =>
                  Effect.gen(function* () {
                    yield* _(bus.publish({ _tag: "TaskRetrying", runId, taskId, taskName: instanceName }))
                  }).pipe(Effect.catchAll(() => Effect.void))
                )
              )
            ),
            Effect.catchAll((failedResult) => Effect.succeed(failedResult))
          )
        )

        if (output.status === "failed") {
          yield* _(ctx.transitionTask(instanceName, "fail"))
          taskResults[instanceName] = "failed"
          workflowStatus = "failed"
          return
        }

        taskResults[instanceName] = "done"
        if (!workflowEnv.tasks) workflowEnv.tasks = {}
        workflowEnv.tasks[instanceName] = { outputs: output as Record<string, unknown> }

        yield* _(ctx.transitionTask(instanceName, "complete"))
        if (fileEnabled) {
          yield* _(writeTaskOutput(runId, taskId, output))
        }
        yield* _(bus.publish({ _tag: "TaskCompleted", runId, taskId, taskName: instanceName }))
      })

    const executeSingleTask = (
      task: WorkflowTask,
      taskEnv: WorkflowEnv,
      instanceName: string
    ): Effect.Effect<void, unknown, EventBus | Scope.Scope> =>
      Effect.gen(function* () {
        const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(runId, instanceName)

        yield* _(ctx.transitionTask(instanceName, "start"))
        yield* _(bus.publish({ _tag: "TaskStarted", runId, taskId, taskName: instanceName }))

        if (task.agent) {
          yield* _(executeAgentTask(task, taskEnv, instanceName, taskId))
        } else if (task.script) {
          yield* _(executeScriptTask(task, taskEnv, instanceName, taskId))
        }
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

        if (task.when) {
          const maxDepth = resolveMaxRecursionDepth()
          if (maxDepth !== null) {
            const compoundId = ctx.compoundTaskIds.get(task.name)
            if (compoundId) {
              const depthRow = ctx.db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId) as { depth: number } | null
              if (depthRow && depthRow.depth >= maxDepth) {
                yield* _(ctx.transitionTask(task.name, "fail"))
                const errorMsg = `max recursion depth (${maxDepth}) exceeded`
                yield* _(ctx.fail(errorMsg))
                workflowStatus = "failed"
                break
              }
            }
          }

          try {
            const result = evaluateWhen(task.when, { inputs: workflowEnv as Record<string, unknown> })
            if (!result) {
              yield* _(ctx.transitionTask(task.name, "complete"))
              continue
            }
          } catch (e) {
            const errorMsg = e instanceof WhenError ? e.message : String(e)
            yield* _(ctx.transitionTask(task.name, "fail"))
            yield* _(ctx.fail(errorMsg))
            workflowStatus = "failed"
            break
          }
        }

        if (task.template) {
          const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
          if (!templateTask) continue

          const resolvedArgs = resolveArguments(task, workflowEnv)

          const compoundParentTaskId = ctx.compoundTaskIds.get(task.name) ?? undefined

          for (let i = 0; i < resolvedArgs.itemsCount; i++) {
            if (workflowStatus === "failed") break

            const instanceName = `${task.name}/${i}`
            const taskEnv: WorkflowEnv = {
              ...workflowEnv,
              parameters: resolvedArgs.parameters
            }

            if (templateTask.tasks && templateTask.tasks.length > 0) {
              workflowEnv.currentIteration = { tasks: {} }
              const sub = topologicalSort(templateTask.tasks)
              for (const subTask of sub) {
                if (workflowStatus === "failed") break
                const subInstanceName = `${instanceName}-${subTask.name}`

                if (subTask.when) {
                  const maxDepth = resolveMaxRecursionDepth()
                  if (maxDepth !== null) {
                    const compoundId = ctx.compoundTaskIds.get(subInstanceName)
                    if (compoundId) {
                      const depthRow = ctx.db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId) as { depth: number } | null
                      if (depthRow && depthRow.depth >= maxDepth) {
                        yield* _(ctx.transitionTask(subInstanceName, "fail"))
                        const errorMsg = `max recursion depth (${maxDepth}) exceeded`
                        yield* _(ctx.fail(errorMsg))
                        workflowStatus = "failed"
                        break
                      }
                    }
                  }

                  try {
                    const result = evaluateWhen(subTask.when, { inputs: workflowEnv as Record<string, unknown> })
                    if (!result) {
                      yield* _(ctx.transitionTask(subInstanceName, "complete"))
                      continue
                    }
                  } catch (e) {
                    const errorMsg = e instanceof WhenError ? e.message : String(e)
                    yield* _(ctx.transitionTask(subInstanceName, "fail"))
                    yield* _(ctx.fail(errorMsg))
                    workflowStatus = "failed"
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
                      if (workflowStatus === "failed") break
                      const nestedInstanceName = `${subInstanceName}-${nestedSubTask.name}`
                      const nestedRef = nestedSubTask.agent?.executorRef ?? "script"
                      yield* _(ctx.insertDynamicTask(nestedInstanceName, nestedRef, compoundParentTaskId))
                      yield* _(executeSingleTask(nestedSubTask, nestedEnv, nestedInstanceName))
                      const nestedOutput = workflowEnv.tasks?.[nestedInstanceName]
                      if (nestedOutput && workflowEnv.currentIteration?.tasks) {
                        workflowEnv.currentIteration.tasks[nestedSubTask.name] = nestedOutput
                      }
                    }
                    delete workflowEnv.currentIteration
                    workflowEnv.currentIteration = savedIteration
                  } else if (nestedTemplate.agent || nestedTemplate.script) {
                    yield* _(executeSingleTask(nestedTemplate, nestedEnv, subInstanceName))
                  }
                  const subOutput = workflowEnv.tasks?.[subInstanceName]
                  if (subOutput && workflowEnv.currentIteration?.tasks) {
                    workflowEnv.currentIteration.tasks[subTask.name] = subOutput
                  }
                  continue
                }

                const subRef = subTask.agent?.executorRef ?? "script"
                yield* _(ctx.insertDynamicTask(subInstanceName, subRef, compoundParentTaskId))
                yield* _(executeSingleTask(subTask, taskEnv, subInstanceName))
                const subOutput = workflowEnv.tasks?.[subInstanceName]
                if (subOutput && workflowEnv.currentIteration?.tasks) {
                  workflowEnv.currentIteration.tasks[subTask.name] = subOutput
                }
              }
              delete workflowEnv.currentIteration
            } else if (templateTask.agent || templateTask.script) {
              const ref = templateTask.agent?.executorRef ?? "script"
              yield* _(ctx.insertDynamicTask(instanceName, ref, compoundParentTaskId))
              yield* _(executeSingleTask(templateTask, taskEnv, instanceName))
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