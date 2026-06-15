export interface WorkflowEnv {
  cwd?: string
  user_input?: string
  run_id?: string
  progress_file?: string
  progress?: string
  tasks: Record<string, { outputs: Record<string, unknown> }>
  parameters?: Record<string, unknown>
  [key: string]: unknown
}