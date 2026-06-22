export interface WorkflowEnv {
  cwd?: string
  user_input?: string
  run_id?: string
  
  change_dir?: string
  tasks?: Record<string, { outputs: Record<string, unknown> }>
  parameters?: Record<string, unknown>
  currentIteration?: {
    tasks?: Record<string, { outputs: Record<string, unknown> }>
  }
  [key: string]: unknown
}