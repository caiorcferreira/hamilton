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

export function resolveStepTimeout(spec: WorkflowSpec, stepSlug: string): number {
  const step = spec.steps.find((s) => s.slug === stepSlug)
  if (step?.timeoutSeconds !== undefined) return step.timeoutSeconds
  const agent = spec.agents.find((a) => a.slug === step?.agent)
  if (agent?.timeoutSeconds !== undefined) return agent.timeoutSeconds
  if (spec.polling?.timeoutSeconds !== undefined) return spec.polling.timeoutSeconds
  return 300
}