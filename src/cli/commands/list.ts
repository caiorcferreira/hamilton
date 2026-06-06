import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import * as Fs from "node:fs"
import { workflowsDir, hamiltonHome } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { renderTable, Column } from "../formatting/table.js"
import { categoryColor, dim } from "../formatting/colors.js"

export interface WorkflowListItem {
  slug: string
  name: string
  description: string | undefined
  version: number
  stepCount: number
  agentCount: number
}

export const listWorkflows: Effect.Effect<WorkflowListItem[], never> = Effect.gen(function* () {
  if (!Fs.existsSync(hamiltonHome())) return [] as WorkflowListItem[]

  const dir = workflowsDir()
  if (!Fs.existsSync(dir)) return [] as WorkflowListItem[]

  const entries = Fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const results: WorkflowListItem[] = []
  for (const slug of entries) {
    const spec = yield* loadWorkflowSpec(dir, slug).pipe(Effect.option)
    if (spec._tag === "Some") {
      results.push({
        slug: spec.value.slug,
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

const workflowColumns: Column<WorkflowListItem>[] = [
  { header: "SLUG", width: 24, render: (i) => categoryColor(i.slug)(i.slug) },
  { header: "NAME", width: 46, render: (i) => i.name },
  { header: "VERSION", width: 4, render: (i) => dim(`v${i.version}`) },
  { header: "STEPS", width: 9, render: (i) => dim(`${i.stepCount} steps`) },
  { header: "AGENTS", width: 10, render: (i) => dim(`${i.agentCount} agents`) }
]

export const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const items = yield* listWorkflows
    if (items.length === 0) {
      yield* Console.log("No workflows installed.")
    } else {
      yield* Console.log(renderTable(items, workflowColumns))
    }
  })
).pipe(Command.withDescription("List installed workflows"))