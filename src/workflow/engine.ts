import { customAlphabet } from "nanoid"

const nanoid = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
import { parseDurationString } from "go-duration-js"
import type { WorkflowTask } from "../types.js"

export function parseDuration(duration: string): number {
  try {
    const ns = parseDurationString(duration)
    if (!isNaN(ns)) return Math.round(ns / 1e9)
    const num = Number(duration)
    if (!isNaN(num)) return num
    return 300
  } catch {
    const num = Number(duration)
    if (!isNaN(num)) return num
    return 300
  }
}

export function collectReachableTasks(
  tasks: WorkflowTask[],
  entrypoint: string
): WorkflowTask[] {
  const taskMap = new Map<string, WorkflowTask>()
  for (const t of tasks) taskMap.set(t.name, t)

  const dependents = new Map<string, string[]>()
  for (const t of tasks) {
    for (const dep of t.dependencies ?? []) {
      if (!dependents.has(dep)) dependents.set(dep, [])
      dependents.get(dep)!.push(t.name)
    }
  }

  const visited = new Set<string>()
  const queue = [entrypoint]

  while (queue.length > 0) {
    const name = queue.shift()!
    if (visited.has(name)) continue
    const task = taskMap.get(name)
    if (!task) continue
    visited.add(name)
    if (task.dependencies) {
      for (const dep of task.dependencies) {
        queue.push(dep)
      }
    }
    for (const dep of dependents.get(name) ?? []) {
      queue.push(dep)
    }
  }

  return tasks.filter(t => visited.has(t.name))
}

export function topologicalSort(tasks: WorkflowTask[]): WorkflowTask[] {
  const taskMap = new Map<string, WorkflowTask>()
  for (const t of tasks) taskMap.set(t.name, t)

  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const t of tasks) {
    if (!indegree.has(t.name)) indegree.set(t.name, 0)
    const deps = t.dependencies ?? []
    for (const dep of deps) {
      if (!adjacency.has(dep)) adjacency.set(dep, [])
      adjacency.get(dep)!.push(t.name)
      indegree.set(t.name, (indegree.get(t.name) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [name, deg] of indegree) {
    if (deg === 0) queue.push(name)
  }

  const sorted: WorkflowTask[] = []
  while (queue.length > 0) {
    const name = queue.shift()!
    const task = taskMap.get(name)
    if (task) sorted.push(task)
    for (const neighbor of adjacency.get(name) ?? []) {
      indegree.set(neighbor, (indegree.get(neighbor) ?? 1) - 1)
      if (indegree.get(neighbor) === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== tasks.length) {
    throw new Error("circular dependency detected")
  }

  return sorted
}

export function buildRunId(workflowName: string): string {
  return `${workflowName}-${nanoid(5)}`
}

export function buildTaskId(runId: string, taskName: string): string {
  const sanitized = taskName.replace(/\//g, "-")
  return `${runId}-${sanitized}-${nanoid(5)}`
}

export function buildTaskInstanceName(parent: string, childOrIndex: string | number): string {
  if (typeof childOrIndex === "number") return `${parent}/${childOrIndex}`
  return `${parent}-${childOrIndex}`
}

export function resolveTaskTimeout(task: WorkflowTask, globalTimeout: string): number {
  if (task.agent?.timeout?.fixed) {
    return parseDuration(task.agent.timeout.fixed)
  }
  if (task.script?.timeout?.fixed) {
    return parseDuration(task.script.timeout.fixed)
  }
  return parseDuration(globalTimeout)
}