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

function walkTasks(tasks: any[]): any[] {
  for (const task of tasks) {
    if (task.tasks && task.tasks.length > 0) walkTasks(task.tasks)
  }
  return tasks
}

export function resolveWorkflowSpec(workflowDir: string, spec: any): any {
  const tasks = walkTasks(spec.tasks)
  for (const task of tasks) {
    if (!task.agent) continue
    if (task.agent.prompt?.file) {
      const promptPath = Path.resolve(workflowDir, task.agent.prompt.file)
      let content: string
      try {
        content = Fs.readFileSync(promptPath, "utf-8")
      } catch {
        throw new Error(`Prompt file not found: ${task.agent.prompt.file}`)
      }
      task.agent.prompt.content = content
    }
    if (task.agent.output?.schema?.file) {
      const schemaPath = Path.resolve(workflowDir, task.agent.output.schema.file)
      let raw: string
      try {
        raw = Fs.readFileSync(schemaPath, "utf-8")
      } catch {
        throw new Error(`Schema file not found: ${task.agent.output.schema.file}`)
      }
      task.agent.output.schema.content = JSON.parse(raw)
    }
  }
  return spec
}

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

    const spec = yield* _(
      Effect.try({
        try: () => resolveWorkflowSpec(dir, Schema.decodeUnknownSync(WorkflowSpecSchema)(raw)),
        catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
      })
    )

    return spec
  })
}