import { Effect, Schedule, Duration, Scope } from "effect"
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

export interface TaskExecutionState {
  workflowStatus: { value: string }
  taskResults: Record<string, string>
  workflowEnv: WorkflowEnv
}

export function executeAgentTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  taskId: string,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  fileEnabled: boolean,
  state: TaskExecutionState
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (!task.agent) return

    const agent = spec.agentRegistry.get(task.agent.executorRef)
    if (!agent) return

    const bus = yield* _(EventBus)

    const fragments = yield* _(
      resolveSystemPromptFragments(agent.systemPrompt, agent.dirPath).pipe(
        Effect.mapError((e) => new Error(e.agentPath))
      )
    )

    const agentPrompts = buildAgentsPrompts({
      fragments,
      taskPrompt: task.agent!.prompt,
      outputSchema: task.agent?.output?.schema?.content,
      userInput: taskEnv.user_input ?? undefined,
      isEntrypoint: task.name === spec.spec.run.entrypoint,
      env: taskEnv,
      agentConfig: agent
    }, guidelineFiles, templateOptions)

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
        runId: ctx.runId,
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
              Effect.gen(function* (_) {
                yield* _(bus.publish({ _tag: "TaskRetrying", runId: ctx.runId, taskId, taskName: instanceName }))
              }).pipe(Effect.catchAll(() => Effect.void))
            )
          )
        )
      )
    )

    if (output === undefined || output === null) {
      yield* _(bus.publish({ _tag: "TaskTimedOut", runId: ctx.runId, taskId, taskName: instanceName }))
      yield* _(ctx.transitionTask(instanceName, "fail"))
      state.workflowStatus.value = "failed"
      return
    }

    state.taskResults[instanceName] = String(output.status ?? "done")
    if (!state.workflowEnv.tasks) state.workflowEnv.tasks = {}
    state.workflowEnv.tasks[instanceName] = { outputs: output as Record<string, unknown> }

    yield* _(ctx.transitionTask(instanceName, "complete"))
    if (fileEnabled) {
      yield* _(writeTaskOutput(ctx.runId, taskId, output))
    }
    yield* _(bus.publish({ _tag: "TaskCompleted", runId: ctx.runId, taskId, taskName: instanceName }))
  })
}

export function executeScriptTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  taskId: string,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  fileEnabled: boolean,
  state: TaskExecutionState
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (!task.script) return

    const bus = yield* _(EventBus)

    const renderedCommand = Effect.runSync(
      Template.make(task.script.command, templateOptions)
        .setInputEnv(taskEnv as Record<string, unknown>)
        .render()
    )
    const workdir = task.script.workdir ?? (taskEnv.project_dir as string | undefined) ?? process.cwd()
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
              Effect.gen(function* (_) {
                yield* _(bus.publish({ _tag: "TaskRetrying", runId: ctx.runId, taskId, taskName: instanceName }))
              }).pipe(Effect.catchAll(() => Effect.void))
            )
          )
        ),
        Effect.catchAll((failedResult) => Effect.succeed(failedResult))
      )
    )

    if (output.status === "failed") {
      yield* _(ctx.transitionTask(instanceName, "fail"))
      state.taskResults[instanceName] = "failed"
      state.workflowStatus.value = "failed"
      return
    }

    state.taskResults[instanceName] = "done"
    if (!state.workflowEnv.tasks) state.workflowEnv.tasks = {}
    state.workflowEnv.tasks[instanceName] = { outputs: output as Record<string, unknown> }

    yield* _(ctx.transitionTask(instanceName, "complete"))
    if (fileEnabled) {
      yield* _(writeTaskOutput(ctx.runId, taskId, output))
    }
    yield* _(bus.publish({ _tag: "TaskCompleted", runId: ctx.runId, taskId, taskName: instanceName }))
  })
}

export function dispatchTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  ctx: WorkflowRuntime,
  spec: WorkflowSpec,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  fileEnabled: boolean,
  state: TaskExecutionState
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    const taskId = ctx.compoundTaskIds.get(instanceName) ?? buildTaskId(ctx.runId, instanceName)

    yield* _(ctx.transitionTask(instanceName, "start"))
    yield* _(bus.publish({ _tag: "TaskStarted", runId: ctx.runId, taskId, taskName: instanceName }))

    if (task.agent) {
      yield* _(executeAgentTask(task, taskEnv, instanceName, taskId, spec, ctx, guidelineFiles, allRules, skillRegistry, templateOptions, fileEnabled, state))
    } else if (task.script) {
      yield* _(executeScriptTask(task, taskEnv, instanceName, taskId, spec, ctx, templateOptions, scriptConfig, fileEnabled, state))
    }
  })
}
