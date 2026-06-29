import { Effect, Scope } from "effect"
import { EventBus } from "../events/bus.js"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "./env.js"
import type { WorkflowRuntime } from "./run-state-machine.js"
import { resolveArguments } from "./arguments.js"
import { buildTaskInstanceName, topologicalSort } from "./engine.js"

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
    tasks: t.tasks ?? undefined,
    kind: t.kind ?? undefined
  }
}

export function expandTemplate(
  ctx: WorkflowRuntime,
  task: WorkflowTask,
  spec: WorkflowSpec,
  env: WorkflowEnv,
  depth: number,
  namePrefix?: string,
  parentTaskName?: string
): Effect.Effect<ExpansionResult, unknown, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    const bus = yield* _(EventBus)

    const templateTask = spec.spec.tasks.find((t: WorkflowTask) => t.name === task.template)
    if (!templateTask) return { inserted: [], taskScopes: {}, originalNames: {} }

    const resolvedArgs = resolveArguments(task, env)

    const inserted: string[] = []
    const taskScopes: Record<string, string> = {}
    const originalNames: Record<string, string> = {}
    let previousCompositeName: string | null = null

    for (let i = 0; i < resolvedArgs.itemsCount; i++) {
      const instanceName = namePrefix
        ? buildTaskInstanceName(namePrefix, i)
        : buildTaskInstanceName(task.name, i)

      if (templateTask.tasks && templateTask.tasks.length > 0) {
        const crossIterationDeps: string[] = previousCompositeName ? [previousCompositeName] : []
        const effectiveParent = parentTaskName ?? namePrefix ?? task.name
        yield* _(ctx.insertDynamicTask(instanceName, "composite", depth + 1, crossIterationDeps, { kind: "composite" }, effectiveParent, "composite"))
        yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(instanceName) ?? instanceName, taskName: instanceName, scopeKey: namePrefix ?? task.name, depth: depth + 1 }))
        inserted.push(instanceName)
        taskScopes[instanceName] = namePrefix ?? task.name

        const sub = topologicalSort(templateTask.tasks)
        for (const subTask of sub) {
          const subInstanceName = buildTaskInstanceName(instanceName, subTask.name)
          const subRef = subTask.agent?.executorRef ?? "script"
          const subResolvedDeps = (subTask.dependencies ?? []).map(dep => buildTaskInstanceName(instanceName, dep))
          const subConfig = taskConfigFrom(subTask)
          const subKind: "leaf" | "composite" = (subTask.template && subTask.arguments?.forEach) ? "composite" : "leaf"
          yield* _(ctx.insertDynamicTask(subInstanceName, subRef, depth + 2, subResolvedDeps, subConfig, instanceName, subKind))
          yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(subInstanceName) ?? subInstanceName, taskName: subInstanceName, scopeKey: instanceName, depth: depth + 2 }))
          inserted.push(subInstanceName)
          taskScopes[subInstanceName] = instanceName
          originalNames[subInstanceName] = subTask.name
        }

        previousCompositeName = instanceName
      } else if (templateTask.agent || templateTask.script) {
        const ref = templateTask.agent?.executorRef ?? "script"
        const resolvedDeps = (templateTask.dependencies ?? [])
        const config = taskConfigFrom(templateTask)
        yield* _(ctx.insertDynamicTask(instanceName, ref, depth + 1, resolvedDeps, config))
        yield* _(bus.publish({ _tag: "TaskInserted", runId: ctx.runId, taskId: ctx.compoundTaskIds.get(instanceName) ?? instanceName, taskName: instanceName, scopeKey: namePrefix ?? task.name, depth: depth + 1 }))
        inserted.push(instanceName)
        taskScopes[instanceName] = namePrefix ?? task.name
        originalNames[instanceName] = task.name
      }
    }

    return { inserted, taskScopes, originalNames }
  })
}