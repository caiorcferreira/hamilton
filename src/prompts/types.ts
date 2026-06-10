export interface ResolvablePrompt {
  systemPrompt: string
  taskPrompt: string
  guidelineFiles: Array<{ name: string; content: string }>
}