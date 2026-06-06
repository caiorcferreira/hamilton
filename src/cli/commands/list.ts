import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { workflowsDir, hamiltonHome } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"

export interface WorkflowListItem {
  id: string
  name: string
  description: string | undefined
  version: number
  stepCount: number
  agentCount: number
}

export const listWorkflows: Effect.Effect<WorkflowListItem[], never> = Effect.gen(function* (_) {
  if (!Fs.existsSync(hamiltonHome())) return []

  const dir = workflowsDir()
  const entries: string[] = yield* _(
    Effect.try({
      try: () => {
        if (!Fs.existsSync(dir)) return [] as string[]
        return Fs.readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort()
      },
      catch: () => [] as string[]
    }).pipe(Effect.orElseSucceed(() => [] as string[]))
  )

  const results: WorkflowListItem[] = []
  for (const slug of entries) {
    const spec = yield* _(
      loadWorkflowSpec(dir, slug).pipe(Effect.option)
    )
    if (spec._tag === "Some") {
      results.push({
        id: spec.value.id,
        name: spec.value.name,
        description: spec.value.description,
        version: spec.value.version,
        stepCount: spec.value.steps.length,
        agentCount: spec.value.agents.length
      })
    }
  }
  return results
})