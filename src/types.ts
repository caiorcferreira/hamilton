export type TaskName = string & { readonly __brand: "TaskName" }
export type AgentName = string & { readonly __brand: "AgentName" }
export type RunId = string & { readonly __brand: "RunId" }
export type TaskId = string & { readonly __brand: "TaskId" }

export interface RunConfig {
  entrypoint: string
  timeout: string
  max_recursion_depth?: number
}

export interface SystemPromptPaths {
  agent: string
  soul: string
  context?: string
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
  skipTemplate?: boolean
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

export interface TaskScript {
  command: string
  workdir?: string
  timeout?: Timeout
  on_failure?: OnFailure
  output?: OutputConfig
}

export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  script?: TaskScript
  template?: string
  arguments?: Arguments
  tasks?: WorkflowTask[]
  when?: string
}

export type VariantPlacement = "start" | "end"

export interface VariantCapabilities {
  provides: string[]
  replaces: string[]
  requires?: string[]
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