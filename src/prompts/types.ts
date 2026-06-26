import type { Template } from "./template.js"

export interface ResolvablePrompt {
  systemTemplate: Template
  taskTemplate: Template
  guidelineFiles: Array<{ name: string; content: string }>
}
