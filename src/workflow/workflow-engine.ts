import * as Crypto from "node:crypto"
import { WorkflowSpec } from "../types.js"

export function computeStepOrder(spec: WorkflowSpec): string[] {
  return spec.steps.map((s) => s.id)
}

export function buildRunId(workflowId: string): string {
  return `${workflowId}-${Crypto.randomUUID()}`
}

export function resolveStepTimeout(spec: WorkflowSpec, agentId: string): number {
  const agent = spec.agents.find((a) => a.id === agentId)
  if (agent?.timeoutSeconds !== undefined) return agent.timeoutSeconds
  if (spec.polling?.timeoutSeconds !== undefined) return spec.polling.timeoutSeconds
  return 300
}