import { Args, Command } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import { workflowsDir, hamiltonHome, runDir } from "../../paths.js"
import { resolveWorkflowSlug } from "../../workflow/resolver.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow, WorkflowResult, WorkflowEvent } from "../../workflow/runner.js"
import { WorkflowSpec as WfSpec } from "../../types.js"


export interface RunParams {
  workflowSlug: string
  prompt: string
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
}

function formatEvent(event: WorkflowEvent): string {
  switch (event.type) {
    case "workflow_started":
      return `Workflow started [${event.runId}]`
    case "step_started":
      return `  Step ${event.stepId ?? ""} started`
    case "step_completed":
      return `  Step ${event.stepId ?? ""} completed`
    case "step_timeout":
      return `  Step ${event.stepId ?? ""} timed out`
    case "step_retry":
      return `  Step ${event.stepId ?? ""} retrying...`
    case "step_paused":
      return `  Step ${event.stepId ?? ""} paused`
    case "workflow_completed":
      return `Workflow finished`
    default:
      return ""
  }
}

export function executeRun(params: RunParams): Effect.Effect<RunResult, Error> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new Error('Hamilton is not initialized. Run "hamilton init" first.')))
    }
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

    const resolvedSlug = resolveWorkflowSlug(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug)

    const onEvent = (event: WorkflowEvent) =>
      Effect.gen(function* () {
        const line = formatEvent(event)
        if (line) yield* Console.log(line)
      })

    const result = yield* _(
      runWorkflow(spec as unknown as WfSpec, { task: params.prompt }, {
        onEvent,
        workflowsDir: wfDir
      }).pipe(
        Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
      )
    )

    return {
      runId: result.runId,
      status: result.status,
      stepResults: result.stepResults
    }
  })
}

const slug = Args.text({ name: "slug" })
const prompt = Args.text({ name: "prompt" }).pipe(Args.repeated)

export const runCommand = Command.make("run", { slug, prompt }, ({ slug, prompt }) =>
  Effect.gen(function* () {
    const promptText = prompt.join(" ")
    const result = yield* Effect.exit(executeRun({ workflowSlug: slug, prompt: promptText }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Workflow failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Run ID: ${result.value.runId}`)
    yield* Console.log(`Status: ${result.value.status}`)
    for (const [step, status] of Object.entries(result.value.stepResults)) {
      yield* Console.log(`  ${step}: ${status}`)
    }
  })
).pipe(Command.withDescription("Run a workflow"))