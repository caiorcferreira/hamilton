import { Effect, Ref, Scope } from "effect"
import { EventBus } from "../events/bus.js"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import type { TemplateOptions } from "../prompts/template.js"
import type { CompiledRule } from "../guidelines/types.js"
import { resolveArguments } from "./arguments.js"
import { buildTaskInstanceName, topologicalSort } from "./engine.js"
import { checkRecursionDepth, handleWhenGuard } from "./when-guard.js"
import { dispatchTask, type TaskExecutionState } from "./task-executor.js"

export interface ExpansionResult {
  inserted: string[]
  taskScopes: Record<string, string>
  originalNames: Record<string, string>
}

function taskConfigFrom(t: WorkflowTask): Record<string, unknown> {
  return {
    agent: t.agent ?? undefined,
    script: t.script ?? undefined,
    template: t.template ?? undefined,
    arguments: t.arguments ?? undefined,
    when: t.when ?? undefined,
    tasks: t.tasks ?? undefined
  }
}

export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  depth: number,
  maxDepth: number | null,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  state: TaskExecutionState,
  namePrefix?: string
): Effect.Effect<ExpansionResult, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)

    const initialStatus = yield* _(Ref.get(state.workflowStatus))
    if (initialStatus === "failed") return { inserted: [], taskScopes: {}, originalNames: {} }

    const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
    if (!templateTask) return { inserted: [], taskScopes: {}, originalNames: {} }

    const resolvedArgs = resolveArguments(task, state.workflowEnv)

    const inserted: string[] = []
    const taskScopes: Record<string, string> = {}
    const originalNames: Record<string, string> = {}

    for (let i = 0; i < resolvedArgs.itemsCount; i++) {
      const loopStatus = yield* _(Ref.get(state.workflowStatus))
      if (loopStatus === "failed") break

      const instanceName = namePrefix
        ? buildTaskInstanceName(namePrefix, i)
        : buildTaskInstanceName(task.name, i)
      const taskEnv: WorkflowEnv = {
        ...state.workflowEnv,
        parameters: resolvedArgs.parameters
      }

      if (templateTask.tasks && templateTask.tasks.length > 0) {
        const savedIteration = state.workflowEnv.currentIteration
        state.workflowEnv.currentIteration = { tasks: {} }
        const sub = topologicalSort(templateTask.tasks)
        for (const subTask of sub) {
          const innerStatus = yield* _(Ref.get(state.workflowStatus))
          if (innerStatus === "failed") break
          const subInstanceName = buildTaskInstanceName(instanceName, subTask.name)

          if (subTask.when) {
            const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, subInstanceName))
            if (depthResult === "fail") {
              yield* _(Ref.set(state.workflowStatus, "failed"))
              break
            }

            const whenResult = handleWhenGuard(subTask, state.workflowEnv)
            if (whenResult === "skip") {
              yield* _(ctx.transitionTask(subInstanceName, "complete"))
              continue
            }
            if (typeof whenResult === "object" && whenResult._tag === "error") {
              yield* _(ctx.transitionTask(subInstanceName, "fail"))
              yield* _(ctx.fail(whenResult.message))
              yield* _(Ref.set(state.workflowStatus, "failed"))
              break
            }
          }

          if (subTask.template) {
            const subRef = subTask.agent?.executorRef ?? subTask.tasks?.[0]?.agent?.executorRef ?? "script"
            const subResolvedDeps = (subTask.dependencies ?? []).map(dep => buildTaskInstanceName(instanceName, dep))
            const subConfig = taskConfigFrom(subTask)
            yield* _(ctx.insertDynamicTask(subInstanceName, subRef, depth + 1, subResolvedDeps, subConfig))
            yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(subInstanceName) ?? subInstanceName, taskName: subInstanceName, scopeKey: instanceName, depth: depth + 1 }))
            inserted.push(subInstanceName)
            taskScopes[subInstanceName] = instanceName
            originalNames[subInstanceName] = subTask.name

            yield* _(expandTemplate(ctx, subTask, spec, taskEnv, depth + 1, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, state, subInstanceName))
            const subOutput = state.workflowEnv.tasks?.[subInstanceName]
            if (subOutput && state.workflowEnv.currentIteration?.tasks) {
              state.workflowEnv.currentIteration.tasks[subTask.name] = subOutput
            }
            continue
          }

          const subRef = subTask.agent?.executorRef ?? "script"
          const subResolvedDeps = (subTask.dependencies ?? []).map(dep => buildTaskInstanceName(instanceName, dep))
          const subConfig = taskConfigFrom(subTask)
          yield* _(ctx.insertDynamicTask(subInstanceName, subRef, depth + 1, subResolvedDeps, subConfig))
          yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(subInstanceName) ?? subInstanceName, taskName: subInstanceName, scopeKey: instanceName, depth: depth + 1 }))
          inserted.push(subInstanceName)
          taskScopes[subInstanceName] = instanceName
          originalNames[subInstanceName] = subTask.name

          yield* _(dispatchTask(subTask, taskEnv, subInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, state))
          const subOutput = state.workflowEnv.tasks?.[subInstanceName]
          if (subOutput && state.workflowEnv.currentIteration?.tasks) {
            state.workflowEnv.currentIteration.tasks[subTask.name] = subOutput
          }
        }
        delete state.workflowEnv.currentIteration
        state.workflowEnv.currentIteration = savedIteration
      } else if (templateTask.agent || templateTask.script) {
        const ref = templateTask.agent?.executorRef ?? "script"
        const resolvedDeps = (templateTask.dependencies ?? [])
        const config = taskConfigFrom(templateTask)
        yield* _(ctx.insertDynamicTask(instanceName, ref, depth + 1, resolvedDeps, config))
        yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(instanceName) ?? instanceName, taskName: instanceName, scopeKey: namePrefix ?? task.name, depth: depth + 1 }))
        inserted.push(instanceName)
        taskScopes[instanceName] = namePrefix ?? task.name
        originalNames[instanceName] = task.name

        yield* _(dispatchTask(templateTask, taskEnv, instanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, state))
      }
    }

    return { inserted, taskScopes, originalNames }
  })
}