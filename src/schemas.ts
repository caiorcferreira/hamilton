import { Schema } from "@effect/schema"

const AgentRoleSchema = Schema.Literal(
  "analysis",
  "coding",
  "verification",
  "testing",
  "pr",
  "scanning"
)

const SystemPromptPathsSchema = Schema.Struct({
  agent: Schema.String,
  soul: Schema.String,
  identity: Schema.String
})

const AgentSettingsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  systemPrompt: SystemPromptPathsSchema,
  skills: Schema.optional(Schema.Array(Schema.String))
})

const WorkflowAgentSchema = Schema.Struct({
  name: Schema.String,
  role: AgentRoleSchema,
  description: Schema.optional(Schema.String),
  settings: AgentSettingsSchema
})

const RefPathSchema = Schema.Struct({
  ref: Schema.String
})

const TimeoutSchema = Schema.Struct({
  fixed: Schema.String
})

const OnExhaustedSchema = Schema.Struct({
  escalate_to: Schema.optional(Schema.String)
})

const OnFailureSchema = Schema.Struct({
  max_retries: Schema.optional(Schema.Number),
  escalate_to: Schema.optional(Schema.String),
  retry_step: Schema.optional(Schema.String),
  on_exhausted: Schema.optional(OnExhaustedSchema)
})

const SchemaConfigSchema = Schema.Struct({
  content: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  file: Schema.optional(Schema.String)
}).pipe(
  Schema.filter(
    (s: any) => s.content || s.file,
    { message: () => "schema must have at least one of 'content' or 'file'" }
  )
)

const OutputConfigSchema = Schema.Struct({
  schema: Schema.optional(SchemaConfigSchema)
})

const PromptSchema = Schema.Struct({
  content: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String)
}).pipe(
  Schema.filter(
    (p: any) => (p.content ? !p.file : !!p.file),
    { message: () => "prompt must have exactly one of 'content' or 'file'" }
  )
)

const TaskAgentSchema = Schema.Struct({
  ref: Schema.String,
  timeout: Schema.optional(TimeoutSchema),
  on_failure: Schema.optional(OnFailureSchema),
  output: Schema.optional(OutputConfigSchema),
  prompt: PromptSchema
})

const ForEachSchema = Schema.Struct({
  valueFrom: RefPathSchema,
  as: Schema.String
})

const ContextFieldSchema = Schema.Struct({
  name: Schema.String,
  valueFrom: RefPathSchema
})

const ContextFieldsSchema = Schema.Struct({
  fields: Schema.Array(ContextFieldSchema)
})

const WorkflowTaskSchema: Schema.Schema<any> = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(TaskAgentSchema),
  template: Schema.optional(Schema.String),
  forEach: Schema.optional(ForEachSchema),
  context: Schema.optional(ContextFieldsSchema),
  tasks: Schema.optional(Schema.suspend(() => Schema.Array(WorkflowTaskSchema)))
})

const RunConfigSchema = Schema.Struct({
  entrypoint: Schema.String,
  timeout: Schema.String
})

export const WorkflowSpecSchema = Schema.Struct({
  version: Schema.Number,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  run: RunConfigSchema,
  agents: Schema.NonEmptyArray(WorkflowAgentSchema),
  tasks: Schema.Array(WorkflowTaskSchema)
}).pipe(
  Schema.filter(
    (spec: any) => {
      const taskNames = new Set(spec.tasks.map((t: any) => t.name))
      let valid = true
      for (const task of spec.tasks) {
        if (!task.agent && !task.template && !task.tasks) {
          valid = false
          break
        }
        if (task.template && !taskNames.has(task.template)) {
          valid = false
          break
        }
      }
      return valid
    },
    { message: () => "every task must have agent, template, or nested tasks. template references must be valid task names." }
  )
)