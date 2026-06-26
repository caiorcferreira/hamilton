import { Effect, Scope } from "effect"
import { EventBus } from "../events/bus.js"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import type { TemplateOptions } from "../prompts/template.js"
import type { CompiledRule } from "../guidelines/types.js"
import { resolveArguments } from "./arguments.js"
import { buildTaskInstanceName, topologicalSort } from "./engine.js"
import { checkRecursionDepth, evaluateWhenCondition } from "./when-guard.js"
import { dispatchTask, type TaskExecutionState } from "./task-executor.js"

export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  maxDepth: number | null,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  fileEnabled: boolean,
  state: TaskExecutionState,
  parentCompoundId?: string,
  namePrefix?: string
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (state.workflowStatus.value === "failed") return

    const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
    if (!templateTask) return

    const resolvedArgs = resolveArguments(task, state.workflowEnv)

    const compoundParentTaskId = parentCompoundId ?? ctx.compoundTaskIds.get(task.name) ?? undefined

    for (let i = 0; i < resolvedArgs.itemsCount; i++) {
      if (state.workflowStatus.value === "failed") break

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
          if (state.workflowStatus.value === "failed") break
          const subInstanceName = buildTaskInstanceName(instanceName, subTask.name)

          if (subTask.when) {
            const depthResult = yield* _(checkRecursionDepth(ctx, maxDepth, subInstanceName))
            if (depthResult === "fail") {
              state.workflowStatus.value = "failed"
              break
            }

            const whenResult = evaluateWhenCondition(subTask, state.workflowEnv)
            if (whenResult === "skip") {
              yield* _(ctx.transitionTask(subInstanceName, "complete"))
              continue
            }
            if (typeof whenResult === "object" && whenResult._tag === "error") {
              yield* _(ctx.transitionTask(subInstanceName, "fail"))
              yield* _(ctx.fail(whenResult.message))
              state.workflowStatus.value = "failed"
              break
            }
          }

          if (subTask.template) {
            const subRef = subTask.agent?.executorRef ?? subTask.tasks?.[0]?.agent?.executorRef ?? "script"
            yield* _(ctx.insertDynamicTask(subInstanceName, subRef, compoundParentTaskId))
            yield* _(expandTemplate(ctx, subTask, spec, taskEnv, maxDepth, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state, compoundParentTaskId, subInstanceName))
            const subOutput = state.workflowEnv.tasks?.[subInstanceName]
            if (subOutput && state.workflowEnv.currentIteration?.tasks) {
              state.workflowEnv.currentIteration.tasks[subTask.name] = subOutput
            }
            continue
          }

          const subRef = subTask.agent?.executorRef ?? "script"
          yield* _(ctx.insertDynamicTask(subInstanceName, subRef, compoundParentTaskId))
          yield* _(dispatchTask(subTask, taskEnv, subInstanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state))
          const subOutput = state.workflowEnv.tasks?.[subInstanceName]
          if (subOutput && state.workflowEnv.currentIteration?.tasks) {
            state.workflowEnv.currentIteration.tasks[subTask.name] = subOutput
          }
        }
        delete state.workflowEnv.currentIteration
        state.workflowEnv.currentIteration = savedIteration
      } else if (templateTask.agent || templateTask.script) {
        const ref = templateTask.agent?.executorRef ?? "script"
        yield* _(ctx.insertDynamicTask(instanceName, ref, compoundParentTaskId))
        yield* _(dispatchTask(templateTask, taskEnv, instanceName, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, fileEnabled, state))
      }
    }
  })
}
