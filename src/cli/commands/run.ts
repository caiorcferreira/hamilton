import { Effect } from "effect"
import * as Fs from "node:fs"
import { workflowsDir } from "../../paths.js"
import { resolveWorkflowId } from "../../workflow/resolver.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow, WorkflowResult } from "../../workflow/runner.js"
import { WorkflowSpec as WfSpec } from "../../types.js"
import { buildRunId } from "../../workflow/engine.js"

export interface RunParams {
  workflowSlug: string
  prompt: string
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
}

export function executeRun(params: RunParams): Effect.Effect<RunResult, Error> {
  return Effect.gen(function* (_) {
    const wfDir = workflowsDir()
    const availableSlugs = yield* _(
      Effect.try({
        try: () => {
          if (!Fs.existsSync(wfDir)) return [] as string[]
          return Fs.readdirSync(wfDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        },
        catch: () => [] as string[]
      }).pipe(Effect.orElseSucceed(() => [] as string[]))
    )

    const resolvedId = resolveWorkflowId(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedId)

    const result = yield* _(
      runWorkflow(spec as unknown as WfSpec, { task: params.prompt }, {
        onEvent: (_) => Effect.void,
        workflowsDir: wfDir
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed<WorkflowResult>({
            runId: buildRunId((spec as unknown as WfSpec).id),
            status: "failed",
            stepResults: {},
            context: {},
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          })
        )
      )
    )

    return {
      runId: result.runId,
      status: result.status,
      stepResults: result.stepResults
    }
  })
}