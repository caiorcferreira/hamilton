export type AgentRole =
  | "analysis"
  | "coding"
  | "verification"
  | "testing"
  | "pr"
  | "scanning"

export type TaskName = string & { readonly __brand: "TaskName" }
export type AgentName = string & { readonly __brand: "AgentName" }
export type RunId = string & { readonly __brand: "RunId" }
export type TaskId = string & { readonly __brand: "TaskId" }

export interface RunConfig {
  entrypoint: string
  timeout: string
}

export interface SystemPromptPaths {
  agent: string
  soul: string
  identity: string
}

export interface AgentSettings {
  model?: string
  systemPrompt: SystemPromptPaths
  skills?: string[]
}

export interface WorkflowAgent {
  name: string
  role: AgentRole
  description?: string
  settings: AgentSettings
}

export interface RefPath {
  ref: string
}

export interface Timeout {
  fixed: string
}

export interface OnExhausted {
  escalate_to?: string
}

export interface OnFailure {
  max_retries?: number
  escalate_to?: string
  retry_step?: string
  on_exhausted?: OnExhausted
}

export interface SchemaConfig {
  content?: Record<string, unknown>
  file?: string
}

export interface OutputConfig {
  schema?: SchemaConfig
}

export interface Prompt {
  content?: string
  file?: string
}

export interface TaskAgent {
  ref: string
  timeout?: Timeout
  on_failure?: OnFailure
  output?: OutputConfig
  prompt: Prompt
}

export interface ForEach {
  valueFrom: RefPath
  as: string
}

export interface ContextField {
  name: string
  valueFrom: RefPath
}

export interface ContextFields {
  fields: ContextField[]
}

export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  template?: string
  forEach?: ForEach
  context?: ContextFields
  tasks?: WorkflowTask[]
}

export type VariantPlacement = "start" | "end"

export interface VariantCapabilities {
  provides: string[]
  replaces: string[]
}

export interface VariantTask {
  placement: VariantPlacement
  capabilities: VariantCapabilities
  task: WorkflowTask
}

export interface WorkflowSpec {
  version: number
  name: string
  description?: string
  run: RunConfig
  variants?: {
    supported: string[]
  }
  agents: WorkflowAgent[]
  tasks: WorkflowTask[]
}