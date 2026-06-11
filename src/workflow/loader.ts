import { Effect, Data } from "effect"
import { Schema } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { WorkflowSpec } from "../types.js"
import { WorkflowSpecSchema, InvalidManifestEnvelopeError } from "../schemas.js"
import { composeVariants } from "./variants.js"
import { loadAgentManifests, DuplicateAgentError, AgentManifestParseError } from "./agent-registry.js"
import type { WorkflowDescriptor } from "./agent-registry.js"

export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>("WorkflowNotFoundError")("WorkflowNotFoundError", {
  workflowName: Schema.String,
  dir: Schema.String
}) { }

export class WorkflowParseError extends Schema.TaggedError<WorkflowParseError>("WorkflowParseError")("WorkflowParseError", {
  workflowName: Schema.String,
  message: Schema.String
}) { }

export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  taskName: string
  executorRef: string
}> { }

function walkTasks(tasks: any[]): any[] {
  for (const task of tasks) {
    if (task.tasks && task.tasks.length > 0) walkTasks(task.tasks)
  }
  return tasks
}

export function resolveWorkflowSpec(workflowDir: string, spec: any): any {
  const tasks = walkTasks(spec.spec.tasks)
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
  workflowName: string,
  sharedAgentsDir: string,
  workflows: WorkflowDescriptor[],
  activeVariants: string[] = []
): Effect.Effect<WorkflowSpec, WorkflowNotFoundError | WorkflowParseError | AgentNotFoundError | DuplicateAgentError | AgentManifestParseError | InvalidManifestEnvelopeError> {
  return Effect.gen(function* (_) {
    const agentRegistry = yield* _(loadAgentManifests(sharedAgentsDir, workflows))

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

    yield* _(
      Effect.try({
        try: () => {
          if ((raw as any).apiVersion !== "dag.hamiltonai.dev/v1alpha1") {
            throw new Error(`Invalid apiVersion: ${(raw as any).apiVersion}`)
          }
          if ((raw as any).kind !== "Workflow") {
            throw new Error(`Invalid kind: ${(raw as any).kind}, expected Workflow`)
          }
        },
        catch: (e) => new InvalidManifestEnvelopeError({ message: String(e) })
      })
    )

    const spec = yield* _(
      Effect.try({
        try: () => {
          const decoded = resolveWorkflowSpec(dir, Schema.decodeUnknownSync(WorkflowSpecSchema)(raw))
          return (composeVariants(decoded as WorkflowSpec, agentRegistry, activeVariants) as unknown) as Schema.Schema.Type<typeof WorkflowSpecSchema>
        },
        catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
      })
    )

    for (const task of walkTasks((spec as any).spec.tasks as any[])) {
      if (task.agent && !agentRegistry.has(task.agent.executorRef)) {
        yield* _(Effect.fail(new AgentNotFoundError({ taskName: task.name, executorRef: task.agent.executorRef })))
      }
    }

    return { ...spec, agentRegistry } as unknown as WorkflowSpec
  })
}