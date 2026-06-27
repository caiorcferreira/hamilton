import type { Effect } from "effect"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"

export type HookAction = "continue" | "cancel" | "fail"

export interface HookResult<D = Record<string, unknown>> {
  action: HookAction
  data: D
}

export type HookPoint =
  | "on_workflow_start"
  | "on_task_start"
  | "on_agent_enter"
  | "on_agent_exit"
  | "on_task_completed"
  | "on_workflow_completed"

export const HOOK_POINTS: readonly HookPoint[] = [
  "on_workflow_start",
  "on_task_start",
  "on_agent_enter",
  "on_agent_exit",
  "on_task_completed",
  "on_workflow_completed"
] as const

export interface PiSessionLike {
  isActive: () => boolean
  prompt: (msg: string) => Promise<unknown>
}

export interface WorkflowStartContext {
  runId: string
  spec: WorkflowSpec
  parameters: Record<string, unknown>
}

export interface TaskStartContext {
  runId: string
  taskId: string
  instanceName: string
  task: WorkflowTask
  env: WorkflowEnv
}

export interface AgentEnterContext {
  runId: string
  taskId: string
  agentId: string
  session: PiSessionLike
  prompt: string
}

export interface AgentExitContext {
  runId: string
  taskId: string
  session: PiSessionLike
}

export interface TaskCompletedContext {
  runId: string
  taskId: string
  result: Record<string, unknown>
  env: WorkflowEnv
}

export interface WorkflowCompletedContext {
  runId: string
  status: string
  taskResults: Record<string, string>
  summary: Record<string, unknown>
}

export type HookContext =
  | { point: "on_workflow_start"; ctx: WorkflowStartContext }
  | { point: "on_task_start"; ctx: TaskStartContext }
  | { point: "on_agent_enter"; ctx: AgentEnterContext }
  | { point: "on_agent_exit"; ctx: AgentExitContext }
  | { point: "on_task_completed"; ctx: TaskCompletedContext }
  | { point: "on_workflow_completed"; ctx: WorkflowCompletedContext }

export type HookFunction<C, D = Record<string, unknown>> = (ctx: C) => Effect.Effect<never, never, HookResult<D>>

export interface LoadedHook {
  name: string
  point: HookPoint
  fn: HookFunction<Record<string, unknown>>
}