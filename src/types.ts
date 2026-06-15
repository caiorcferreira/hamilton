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
}

export interface AgentManifestSettings {
  model?: string
  skills?: string[]
}

export interface AgentManifest {
  metadata: {
    name: string
    description?: string
  }
  dirPath: string
  spec: {
    settings: AgentManifestSettings
    systemPrompt?: SystemPromptPaths
  }
  systemPrompt: SystemPromptPaths
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
  executorRef: string
  timeout?: Timeout
  on_failure?: OnFailure
  output?: OutputConfig
  prompt: Prompt
}

export interface ForEach {
  valueFrom: { ref: string }
  as: string
}

export interface ArgumentParameter {
  name: string
  valueFrom: { ref: string }
}

export interface Arguments {
  forEach?: ForEach
  parameters?: ArgumentParameter[]
}

export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  template?: string
  arguments?: Arguments
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
  metadata: {
    version: number
    name: string
    description?: string
  }
  spec: {
    run: RunConfig
    variants?: {
      supported: string[]
    }
    tasks: WorkflowTask[]
  }
  agentRegistry: Map<string, AgentManifest>
}