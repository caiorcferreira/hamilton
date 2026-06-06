import { nanoid } from "nanoid"
import { WorkflowSpec } from "../types.js"

export function computeStepOrder(spec: WorkflowSpec): string[] {
  return spec.steps.map((s) => s.slug)
}

export function buildRunId(workflowSlug: string): string {
  return `${workflowSlug}-${nanoid(5)}`
}

export function buildStepId(runId: string, stepSlug: string): string {
  return `${runId}-${stepSlug}-${nanoid(5)}`
}

export function resolveStepTimeout(spec: WorkflowSpec, agentSlug: string): number {
  const agent = spec.agents.find((a) => a.slug === agentSlug)
  if (agent?.timeoutSeconds !== undefined) return agent.timeoutSeconds
  if (spec.polling?.timeoutSeconds !== undefined) return spec.polling.timeoutSeconds
  return 300
}