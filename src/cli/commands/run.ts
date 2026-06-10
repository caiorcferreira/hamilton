import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Exit, Scope } from "effect"
import * as Fs from "node:fs"
import { workflowsDir, hamiltonHome, runDir } from "../../paths.js"
import { resolveWorkflowSlug } from "../../workflow/resolver.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow } from "../../workflow/runner.js"
import { WorkflowSpec as WfSpec } from "../../types.js"
import { EventBus, EventBusLive } from "../../events/bus.js"
import { FileLogger } from "../../observability/subscribers.js"
import { CliRenderer } from "../subscribers.js"

export interface RunParams {
  workflowSlug: string
  prompt: string
  variants?: string
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
}

export function executeRun(params: RunParams): Effect.Effect<RunResult, Error, EventBus | Scope.Scope> {
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

    const activeVariants = params.variants
      ? params.variants.split(",").map(v => v.trim()).filter(v => v.length > 0)
      : []

    const resolvedSlug = resolveWorkflowSlug(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug, activeVariants)

    const result = yield* _(
      runWorkflow(spec as unknown as WfSpec, { task: params.prompt }, {
        workflowsDir: wfDir
      }).pipe(
        Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
      )
    )

    return {
      runId: result.runId,
      status: result.status,
      taskResults: result.taskResults
    }
  })
}

const slug = Args.text({ name: "slug" })
const prompt = Args.text({ name: "prompt" }).pipe(Args.repeated)
const variants = Options.text("variants").pipe(Options.optional)

export const runCommand = Command.make("run", { slug, prompt, variants }, ({ slug, prompt, variants }) =>
  Effect.gen(function* () {
    const promptText = prompt.join(" ")
    const result = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          return yield* executeRun({ workflowSlug: slug, prompt: promptText, variants: variants._tag === "Some" ? variants.value : undefined })
        })
      ).pipe(Effect.provide(EventBusLive))
    )
    if (Exit.isFailure(result)) {
      yield* Console.error(`Workflow failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Run ID: ${result.value.runId}`)
    yield* Console.log(`Status: ${result.value.status}`)
    for (const [step, status] of Object.entries(result.value.taskResults)) {
      yield* Console.log(`  ${step}: ${status}`)
    }
  })
).pipe(Command.withDescription("Run a workflow"))