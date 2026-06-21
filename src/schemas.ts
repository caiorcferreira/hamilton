import { Schema } from "@effect/schema"
import { Data } from "effect"

export class InvalidManifestEnvelopeError extends Data.TaggedError("InvalidManifestEnvelopeError")<{
  message: string
}> { }

const ApiVersionSchema = Schema.Literal("dag.hamiltonai.dev/v1alpha1")

const KindSchema = Schema.Literal("Agent", "Workflow", "Guideline")

const AgentMetadataSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String)
})

const WorkflowMetadataSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.Number,
  description: Schema.optional(Schema.String)
})

const GuidelineMetadataSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String)
})

const ManifestEnvelopeSchema = Schema.Struct({
  apiVersion: ApiVersionSchema,
  kind: KindSchema,
  metadata: Schema.Union(AgentMetadataSchema, WorkflowMetadataSchema, GuidelineMetadataSchema)
})

const SystemPromptPathsSchema = Schema.Struct({
  agent: Schema.String,
  soul: Schema.String
})

const AgentManifestSettingsSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(Schema.String))
})

export const AgentManifestSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamiltonai.dev/v1alpha1"),
  kind: Schema.Literal("Agent"),
  metadata: AgentMetadataSchema,
  spec: Schema.Struct({
    settings: AgentManifestSettingsSchema,
    systemPrompt: Schema.optional(SystemPromptPathsSchema)
  })
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
  
  on_exhausted: Schema.optional(OnExhaustedSchema)
})

const SchemaConfigSchema = Schema.Union(
  Schema.Struct({
    content: Schema.Record({ key: Schema.String, value: Schema.Unknown })
  }),
  Schema.Struct({
    file: Schema.String
  }),
  Schema.Struct({
    content: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    file: Schema.String
  })
)

const OutputConfigSchema = Schema.Struct({
  schema: Schema.optional(SchemaConfigSchema)
})

const PromptSchema = Schema.Struct({
  content: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  skipTemplate: Schema.optional(Schema.Boolean)
}).pipe(
  Schema.filter(
    (p: any) => (p.content ? !p.file : !!p.file),
    { message: () => "prompt must have exactly one of 'content' or 'file'" }
  )
)

const TaskAgentSchema = Schema.Struct({
  executorRef: Schema.String,
  timeout: Schema.optional(TimeoutSchema),
  on_failure: Schema.optional(OnFailureSchema),
  output: Schema.optional(OutputConfigSchema),
  prompt: PromptSchema
})

const TaskScriptSchema = Schema.Struct({
  command: Schema.String,
  workdir: Schema.optional(Schema.String),
  timeout: Schema.optional(TimeoutSchema),
  on_failure: Schema.optional(OnFailureSchema),
  output: Schema.optional(OutputConfigSchema)
})

const ForEachSchema = Schema.Struct({
  valueFrom: Schema.Struct({ ref: Schema.String }),
  as: Schema.String
})

const ArgumentParameterSchema = Schema.Struct({
  name: Schema.String,
  valueFrom: Schema.Struct({ ref: Schema.String })
})

const ArgumentsSchema = Schema.Struct({
  forEach: Schema.optional(ForEachSchema),
  parameters: Schema.optional(Schema.Array(ArgumentParameterSchema))
})

const WorkflowTaskSchema: Schema.Schema<any> = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(TaskAgentSchema),
  script: Schema.optional(TaskScriptSchema),
  template: Schema.optional(Schema.String),
  arguments: Schema.optional(ArgumentsSchema),
  tasks: Schema.optional(Schema.suspend(() => Schema.Array(WorkflowTaskSchema))),
  when: Schema.optional(Schema.String)
})

const RunConfigSchema = Schema.Struct({
  entrypoint: Schema.String,
  timeout: Schema.String,
  max_recursion_depth: Schema.optional(Schema.Int.pipe(Schema.positive()))
})

const VariantsConfigSchema = Schema.Struct({
  supported: Schema.Array(Schema.String)
})

export const WorkflowSpecSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamiltonai.dev/v1alpha1"),
  kind: Schema.Literal("Workflow"),
  metadata: WorkflowMetadataSchema,
  spec: Schema.Struct({
    run: RunConfigSchema,
    variants: Schema.optional(VariantsConfigSchema),
    tasks: Schema.Array(WorkflowTaskSchema)
  })
}).pipe(
  Schema.filter(
    (spec: any) => {
      const taskNames = new Set(spec.spec.tasks.map((t: any) => t.name))
      let valid = true
      for (const task of spec.spec.tasks) {
        if (!task.agent && !task.script && !task.template && !task.tasks) {
          valid = false
          break
        }
        if (task.agent && task.script) {
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
    { message: () => "every task must have agent, script, template, or nested tasks. agent and script are mutually exclusive. template references must be valid task names." }
  )
)

const GuidelineRuleSchema = Schema.Struct({
  name: Schema.String,
  toolNames: Schema.Array(Schema.String),
  target: Schema.Literal("command", "path", "input"),
  pattern: Schema.String,
  reason: Schema.String
})

const GuidelineInstructionEntrySchema = Schema.Struct({
  matching: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String)
})

export const GuidelineSpecSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamiltonai.dev/v1alpha1"),
  kind: Schema.Literal("Guideline"),
  metadata: GuidelineMetadataSchema,
  spec: Schema.Struct({
    instructions: Schema.optional(Schema.Array(GuidelineInstructionEntrySchema)),
    rules: Schema.optional(Schema.Array(GuidelineRuleSchema))
  })
})

export function parseManifest(raw: unknown): any {
  const envelope = Schema.decodeUnknownSync(ManifestEnvelopeSchema)(raw)
  if (envelope.kind === "Agent") {
    return Schema.decodeUnknownSync(AgentManifestSchema)(raw)
  }
  if (envelope.kind === "Guideline") {
    return Schema.decodeUnknownSync(GuidelineSpecSchema)(raw)
  }
  return Schema.decodeUnknownSync(WorkflowSpecSchema)(raw)
}