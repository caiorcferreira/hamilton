export interface ResolvablePrompt {
  systemPrompt: string
  taskPrompt: string
  instructionFiles: Array<{ name: string; content: string }>
}