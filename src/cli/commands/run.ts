import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Exit, Scope } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { workflowsDir, hamiltonHome, runDir } from "../../paths.js"
import { resolveWorkflowSlug } from "../../workflow/resolver.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import type { WorkflowDescriptor } from "../../workflow/agent-registry.js"
import { runWorkflow } from "../../workflow/runner.js"
import { EventBus, EventBusLive } from "../../events/bus.js"
import { FileLogger } from "../../observability/subscribers.js"
import { CliRenderer } from "../subscribers.js"
import { Database } from "bun:sqlite"
import { migrate } from "../../db/migrations.js"
import { updateRunPid, insertRunWithPid } from "../../db/queries.js"
import { buildRunId } from "../../workflow/engine.js"
import { TelemetrySubscriber } from "../../telemetry/subscriber.js"
import { makeTurnRepository } from "../../telemetry/repositories/turn-repository.js"
import { makeToolCallRepository } from "../../telemetry/repositories/tool-call-repository.js"
import { makeProviderRequestRepository } from "../../telemetry/repositories/provider-request-repository.js"
import { loadTelemetryConfig } from "../../telemetry/config.js"
import { dbPath } from "../../paths.js"
import { loadTemplateConfig } from "../../prompts/config.js"

export interface RunParams {
  workflowSlug: string
  prompt: string
  variants?: string
  externalRunId?: string
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  taskResults: Record<string, string>
}

function discoverWorkflows(dir: string): WorkflowDescriptor[] {
  if (!Fs.existsSync(dir)) return []
  return Fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, dir: Path.join(dir, e.name) }))
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

    if (params.externalRunId) {
      yield* _(Effect.sync(() => {
        const db = new Database(dbPath())
        migrate(db)
        db.close()
      }))
    }

    const activeVariants = params.variants
      ? params.variants.split(",").map(v => v.trim()).filter(v => v.length > 0)
      : []

    const sharedAgentsDir = Path.join(hamiltonHome(), "agents")
    const workflows = discoverWorkflows(wfDir)
    const resolvedSlug = resolveWorkflowSlug(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug, sharedAgentsDir, workflows, activeVariants)

    const templateOptions = yield* _(loadTemplateConfig())

    const result = yield* _(
      runWorkflow(spec, { user_input: params.prompt, cwd: process.cwd() }, {
        workflowsDir: wfDir
      }, templateOptions, params.externalRunId).pipe(
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
const foreground = Options.boolean("foreground").pipe(Options.withAlias("f"), Options.optional)
const runIdOption = Options.text("run-id").pipe(Options.optional)

export const runCommand = Command.make("run", { slug, prompt, variants, foreground, runIdOption }, ({ slug, prompt, variants, foreground, runIdOption }) =>
  Effect.gen(function* () {
    const promptText = prompt.join(" ")
    const isForeground = foreground._tag === "Some" ? foreground.value : false
    const externalRunId = runIdOption._tag === "Some" ? runIdOption.value : undefined

    if (!isForeground && !externalRunId) {
      const runId = buildRunId(slug)
      const allArgs = ["run", slug, ...prompt, "--foreground", "--run-id", runId]
      if (variants._tag === "Some") {
        allArgs.push("--variants", variants.value)
      }
      const child = Bun.spawn([process.execPath, process.argv[1], ...allArgs], { detached: true })
      child.unref()
const db = new Database(dbPath())
      migrate(db)
      insertRunWithPid(db, runId, slug, new Date().toISOString(), child.pid)
      db.close()
      yield* Console.log(`Run ID: ${runId}`)
      yield* Console.log("Running in background. Use 'hamilton status <run-id>' to check progress.")
      return
    }

    const result = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          const telemetryCfg = yield* loadTelemetryConfig
          const db = new Database(dbPath())
          const dbEnabled = !telemetryCfg.disableStores.has("db")
          yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
          yield* TelemetrySubscriber({
            turn: makeTurnRepository(db),
            toolCall: makeToolCallRepository(db),
            providerRequest: makeProviderRequestRepository(db),
            shouldWrite: () => dbEnabled
          })
          return yield* executeRun({ workflowSlug: slug, prompt: promptText, variants: variants._tag === "Some" ? variants.value : undefined, externalRunId })
        })
      ).pipe(Effect.provide(EventBusLive))
    )
    if (Exit.isFailure(result)) {
      const cause = result.cause
      yield* Console.error(`Workflow failed: ${String(cause)}`)
      if (cause._tag === "Fail") {
        const error = cause.error
        if (error != null && typeof error === "object" && "_tag" in error && (error as any)._tag === "WorkflowNotFoundError") {
const err = error as unknown as { workflowName: string; nearestMatches: string[] }
          if (err.nearestMatches && err.nearestMatches.length > 0) {
            yield* Console.log("")
            yield* Console.log("Did you mean:")
            for (const match of err.nearestMatches) {
              yield* Console.log(`  - ${match}`)
            }
          }
        }
      }
      return
    }
    yield* Console.log(`Run ID: ${result.value.runId}`)
    yield* Console.log(`Status: ${result.value.status}`)
    for (const [task, status] of Object.entries(result.value.taskResults)) {
      yield* Console.log(`  ${task}: ${status}`)
    }
  })
).pipe(Command.withDescription("Run a workflow"))