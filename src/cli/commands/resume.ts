import { Args, Command } from "@effect/cli"
import { Console, Data, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { openDb } from "../../workflow/state.js"
import { getRunById, getWorkflowState } from "../../db/queries.js"
import { workflowsDir, hamiltonHome } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import type { WorkflowDescriptor } from "../../workflow/agent-registry.js"
import { runWorkflow } from "../../workflow/runner.js"
import type { WorkflowSpec } from "../../types.js"
import { EventBus } from "../../events/bus.js"
import { TaskLogger } from "../../observability/subscribers.js"
import { CliRenderer } from "../subscribers.js"
import { loadTemplateConfig, loadRecursionConfig } from "../../prompts/config.js"

export class ResumeError extends Data.TaggedError("ResumeError")<{
  runId: string
  message: string
}> {}

export function resumeWorkflow(runId: string): Effect.Effect<string, ResumeError, EventBus> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new ResumeError({
        runId,
        message: 'Hamilton is not initialized. Run "hamilton setup" first.'
      })))
    }

    const db = yield* _(openDb().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const run = getRunById(db, runId)
    if (!run) {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: "Run not found" })))
    }

    if (run.status !== "paused") {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: `Cannot resume run in state "${run.status}"` })))
    }

    const wfDir = Path.join(workflowsDir(), run.workflow_id)
    const ymlPath = Path.join(wfDir, "workflow.yml")
    if (!Fs.existsSync(ymlPath)) {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: `Workflow "${run.workflow_id}" not found on disk` })))
    }

    const contextJson = getWorkflowState(db, runId, "context")
    let context: Record<string, unknown> = {}
    if (contextJson) {
      try {
        context = JSON.parse(contextJson)
      } catch {
        context = {}
      }
    }
    context.project_dir = process.cwd()
    db.close()

    const sharedAgentsDir = Path.join(hamiltonHome(), "agents")
    const wfBaseDir = workflowsDir()
    const workflowEntries: WorkflowDescriptor[] = Fs.existsSync(wfBaseDir)
      ? Fs.readdirSync(wfBaseDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => ({ name: e.name, dir: Path.join(wfBaseDir, e.name) }))
      : []

    const spec = yield* _(loadWorkflowSpec(wfBaseDir, run.workflow_id, sharedAgentsDir, workflowEntries).pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const templateOptions = yield* _(loadTemplateConfig().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))
    const recursionConfig = yield* _(loadRecursionConfig().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const result = yield* _(
      Effect.scoped(
        Effect.gen(function* () {
          yield* TaskLogger
          yield* CliRenderer
          return yield* runWorkflow(spec as unknown as WorkflowSpec, context, templateOptions, runId, recursionConfig.maxDepth ?? undefined).pipe(
            Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
          )
        })
      )
    )

    return `Resumed ${runId}. Status: ${result.status}`
  })
}

const runIdArg = Args.text({ name: "id" })

export const resumeCommand = Command.make("resume", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(resumeWorkflow(id))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Resume failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(result.value)
  })
).pipe(Command.withDescription("Resume a paused workflow"))