import { Effect } from "effect"
import { Schema } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { WorkflowSpecSchema } from "../schemas.js"

export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>("WorkflowNotFoundError")("WorkflowNotFoundError", {
  workflowName: Schema.String,
  dir: Schema.String
}) {}

export class WorkflowParseError extends Schema.TaggedError<WorkflowParseError>("WorkflowParseError")("WorkflowParseError", {
  workflowName: Schema.String,
  message: Schema.String
}) {}

export function loadWorkflowSpec(
  workflowsDir: string,
  workflowName: string
): Effect.Effect<Schema.Schema.Type<typeof WorkflowSpecSchema>, WorkflowNotFoundError | WorkflowParseError> {
  return Effect.gen(function* (_) {
    const dir = Path.join(workflowsDir, workflowName)
    const filePath = Path.join(dir, "workflow.yml")

    const content = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(filePath, "utf-8"),
        catch: () => new WorkflowNotFoundError({ workflowName, dir })
      })
    )

    const raw = yield* _(
      Effect.try({
        try: () => Yaml.parse(content) as unknown,
        catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
      })
    )

    return yield* _(
      Effect.try({
        try: () => Schema.decodeUnknownSync(WorkflowSpecSchema)(raw),
        catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
      })
    )
  })
}