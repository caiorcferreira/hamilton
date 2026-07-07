import { Effect, Ref, Schedule, Duration, Scope } from "effect"
import { EventBus } from "../events/bus.js"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import type { TemplateOptions } from "../prompts/template.js"
import { Template } from "../prompts/template.js"
import { buildAgentsPrompts } from "../prompts/builder.js"
import { resolveSystemPromptFragments } from "../prompts/system.js"
import { resolveAgentDefaults, loadModelAliases, resolveModelAlias } from "../agent/config.js"
import { executeWithPi } from "../executors/pi/pi-executor.js"
import { resolveTaskTimeout, buildTaskId } from "./engine.js"
import { writeTaskOutput } from "../observability/run-dir.js"
import * as ChildProcess from "node:child_process"
import type { CompiledRule } from "../guidelines/types.js"
import { resolveSkills } from "../skills/registry.js"
import type { HookRuntime } from "../hook/integration.js"

export interface TaskExecutionState {
  workflowStatus: Ref.Ref<"planned" | "in-progress" | "completed" | "failed" | "paused">
  taskResults: Record<string, string>
  workflowEnv: WorkflowEnv
  fileEnabled: boolean
}

function withTaskLifecycle(
  instanceName: string,
  taskId: string,
  ctx: WorkflowRuntime,
  state: TaskExecutionState,
  maxRetries: number,
  hookRuntime: HookRuntime,
  execute: Effect.Effect<any, unknown, EventBus | Scope.Scope>
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)

    yield* _(
      execute.pipe(
        Effect.retry(
          Schedule.recurs(maxRetries - 1).pipe(
            Schedule.tapInput(() =>
              Effect.gen(function* (_) {
                yield* _(bus.publish({ _tag: "TaskRetrying", runId: ctx.runId, taskId, taskName: instanceName }))
              }).pipe(Effect.catchAll(() => Effect.void))
            )
          )
        ),
        Effect.matchEffect({
          onSuccess: (result) => {
            if (result === undefined || result === null) {
              return Effect.gen(function* (_) {
                yield* _(bus.publish({ _tag: "TaskTimedOut", runId: ctx.runId, taskId, taskName: instanceName }))
                yield* _(ctx.transitionTask(instanceName, "fail"))
                yield* _(Ref.set(state.workflowStatus, "failed"))
              })
            }
            return Effect.gen(function* (_) {
              state.taskResults[instanceName] = String(result.status ?? "done")
              if (!state.workflowEnv.tasks) state.workflowEnv.tasks = {}
              state.workflowEnv.tasks[instanceName] = { outputs: result as Record<string, unknown> }
              yield* _(ctx.transitionTask(instanceName, "complete"))
              if (state.fileEnabled) {
                yield* _(writeTaskOutput(ctx.runId, taskId, result))
              }
              yield* _(bus.publish({ _tag: "TaskCompleted", runId: ctx.runId, taskId, taskName: instanceName }))
              yield* _(hookRuntime.run("on_task_completed", {
                runId: ctx.runId,
                taskId,
                result,
                env: state.workflowEnv as Record<string, unknown>
              }).pipe(Effect.catchAll(() => Effect.void)))
            })
          },
          onFailure: (cause) => {
            return Effect.gen(function* (_) {
              yield* _(bus.publish({ _tag: "TaskFailed", runId: ctx.runId, taskId, taskName: instanceName, message: String(cause) }))
              yield* _(ctx.transitionTask(instanceName, "fail"))
              yield* _(Ref.set(state.workflowStatus, "failed"))
            })
          }
        })
      )
    )
  })
}

function buildAgentExecEffect(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  memoryContext: string,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  agent: NonNullable<ReturnType<WorkflowSpec["agentRegistry"]["get"]>>,
  taskId: string,
  hookRuntime: HookRuntime
): Effect.Effect<unknown, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const fragments = yield* _(
      resolveSystemPromptFragments(agent.systemPrompt, agent.dirPath).pipe(
        Effect.mapError((e) => new Error(e.agentPath))
      )
    )

    const agentPrompts = yield* _(buildAgentsPrompts({
      fragments,
      taskPrompt: task.agent!.prompt,
      outputSchema: task.agent?.output?.schema?.content,
      userInput: taskEnv.user_input ?? undefined,
      isEntrypoint: task.name === spec.spec.run.entrypoint,
      env: taskEnv,
      agentConfig: agent
    }, memoryContext, templateOptions))

    const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)
    const resolved = resolveAgentDefaults(agent.spec.settings, agent.spec.systemPrompt)
    const aliases = loadModelAliases()
    const model = resolveModelAlias(resolved.model, aliases)
    const outputSchema = task.agent!.output?.schema

    return yield* _(
      executeWithPi({
        prompt: {
          systemTemplate: agentPrompts.systemTemplate,
          taskTemplate: agentPrompts.taskTemplate,
          memoryContext: agentPrompts.memoryContext
        },
        taskId,
        agentId: agent.metadata.name,
        runId: ctx.runId,
        timeoutSeconds,
        model,
        outputSchema: outputSchema?.content,
        rules: allRules.length > 0 ? allRules : undefined,
        hookRuntime,
        settings: {
          skills: resolveSkills(resolved.skills, skillRegistry),
          thinking: undefined,
          tools: undefined,
          retryOnTransient: undefined,
          compactionEnabled: undefined
        }
      }).pipe(
        Effect.timeout(Duration.seconds(timeoutSeconds))
      )
    )
  })
}

function buildScriptExecEffect(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  spec: WorkflowSpec,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number }
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number; status: string }, { stdout: string; stderr: string; exitCode: number; status: string }> {
  return Effect.gen(function* (_) {
    const renderedCommand = Effect.runSync(
      Template.make(task.script!.command, templateOptions)
        .setInputEnv(taskEnv as Record<string, unknown>)
        .render()
    )
    const workdir = task.script!.workdir ?? (taskEnv.project_dir as string | undefined) ?? process.cwd()
    const timeoutSeconds = resolveTaskTimeout(task, spec.spec.run.timeout)

    return yield* _(
      Effect.try({
        try: () => {
          const stdout = ChildProcess.execSync(renderedCommand, {
            cwd: workdir,
            timeout: timeoutSeconds * 1000,
            encoding: "utf-8",
            maxBuffer: scriptConfig.maxOutputBytes
          })
          return { stdout: stdout.trim(), stderr: "", exitCode: 0, status: "done" as const }
        },
        catch: (e: any) => {
          const stdout = (e.stdout as string | undefined) ?? ""
          const stderr = (e.stderr as string | undefined) ?? String(e)
          const exitCode = (e.status as number | undefined) ?? 1
          return { stdout: String(stdout).trim(), stderr: String(stderr), exitCode, status: "failed" as const }
        }
      }).pipe(
        Effect.flatMap((result) =>
          result.status === "done" ? Effect.succeed(result) : Effect.fail(result)
        )
      )
    )
  })
}

export function dispatchTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  ctx: WorkflowRuntime,
  spec: WorkflowSpec,
  memoryContext: string,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  state: TaskExecutionState,
  hookRuntime: HookRuntime
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(ctx.runId, instanceName)

    yield* _(ctx.transitionTask(instanceName, "start"))
    yield* _(bus.publish({ _tag: "TaskStarted", runId: ctx.runId, taskId, taskName: instanceName }))

    const taskStartResult = yield* _(hookRuntime.run("on_task_start", {
      runId: ctx.runId,
      taskId,
      instanceName,
      task,
      env: taskEnv as Record<string, unknown>
    }))
    if (taskStartResult.action === "cancel") {
      yield* _(ctx.transitionTask(instanceName, "complete"))
      return
    }
    if (taskStartResult.action === "fail") {
      yield* _(ctx.transitionTask(instanceName, "fail"))
      yield* _(Ref.set(state.workflowStatus, "failed"))
      return
    }

    if (task.agent) {
      const agent = spec.agentRegistry.get(task.agent.executorRef)
      if (!agent) return
      const maxRetries = task.agent!.on_failure?.max_retries ?? 1
      const execEffect = buildAgentExecEffect(task, taskEnv, spec, ctx, memoryContext, allRules, skillRegistry, templateOptions, agent, taskId, hookRuntime)
      yield* _(withTaskLifecycle(instanceName, taskId, ctx, state, maxRetries, hookRuntime, execEffect))
    } else if (task.script) {
      const maxRetries = task.script.on_failure?.max_retries ?? 1
      const execEffect = buildScriptExecEffect(task, taskEnv, spec, templateOptions, scriptConfig)
      yield* _(withTaskLifecycle(instanceName, taskId, ctx, state, maxRetries, hookRuntime, execEffect))
    }
  })
}