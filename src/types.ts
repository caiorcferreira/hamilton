import type { Context } from "./workflow/context.js"

export type AgentRole =
  | "analysis"
  | "coding"
  | "verification"
  | "testing"
  | "pr"
  | "scanning"

export type WorkflowSlug = string & { readonly __brand: "WorkflowSlug" }
export type StepSlug = string & { readonly __brand: "StepSlug" }
export type AgentSlug = string & { readonly __brand: "AgentSlug" }
export type RunId = string & { readonly __brand: "RunId" }
export type StepId = string & { readonly __brand: "StepId" }

export interface WorkflowSpec {
  slug: WorkflowSlug
  name: string
  version: number
  description?: string
  polling?: WorkflowPolling
  agents: WorkflowAgent[]
  steps: WorkflowStep[]
  context?: Context
  notifications?: unknown
  run?: unknown
}

export interface WorkflowPolling {
  model?: string
  timeoutSeconds?: number
}

export interface WorkflowAgent {
  slug: AgentSlug
  name?: string
  role: AgentRole
  description?: string
  model?: string
  pollingModel?: string
  timeoutSeconds?: number
  workspace: WorkflowAgentWorkspace
}

export interface WorkflowAgentWorkspace {
  baseDir: string
  skills?: string[]
  files: Record<string, string>
}

export interface WorkflowStep {
  slug: StepSlug
  agent: AgentSlug
  type?: "default" | "loop" | "create_git_worktree" | "cleanup_git_worktree"
  loop?: LoopConfig
  input: string
  expects?: string
  timeoutSeconds?: number
  on_fail?: OnFailConfig
}

export interface LoopConfig {
  over: "stories"
  completion?: string
  fresh_session?: boolean
  verify_each?: boolean
  verify_step?: string
}

export interface OnFailConfig {
  escalate_to?: string
  retry_step?: string
  max_retries?: number
  on_exhausted?: OnExhaustedConfig
}

export interface OnExhaustedConfig {
  escalate_to?: string
}