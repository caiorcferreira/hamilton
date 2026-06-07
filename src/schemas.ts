import { Schema } from "@effect/schema"

const AgentRoleSchema = Schema.Literal(
  "analysis",
  "coding",
  "verification",
  "testing",
  "pr",
  "scanning"
)

const WorkflowAgentWorkspaceSchema = Schema.Struct({
  baseDir: Schema.String,
  skills: Schema.optional(Schema.Array(Schema.String)),
  files: Schema.Record({ key: Schema.String, value: Schema.String })
})

const WorkflowAgentSchema = Schema.Struct({
  slug: Schema.String,
  name: Schema.optional(Schema.String),
  role: AgentRoleSchema,
  description: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  pollingModel: Schema.optional(Schema.String),
  timeoutSeconds: Schema.optional(Schema.Number),
  workspace: WorkflowAgentWorkspaceSchema
})

const LoopConfigSchema = Schema.Struct({
  over: Schema.Literal("stories"),
  completion: Schema.optional(Schema.String),
  fresh_session: Schema.optional(Schema.Boolean),
  verify_each: Schema.optional(Schema.Boolean),
  verify_step: Schema.optional(Schema.String)
})

const OnExhaustedConfigSchema = Schema.Struct({
  escalate_to: Schema.optional(Schema.String)
})

const OnFailConfigSchema = Schema.Struct({
  escalate_to: Schema.optional(Schema.String),
  retry_step: Schema.optional(Schema.String),
  max_retries: Schema.optional(Schema.Number),
  on_exhausted: Schema.optional(OnExhaustedConfigSchema)
})

const WorkflowStepSchema = Schema.Struct({
  slug: Schema.String,
  agent: Schema.String,
  type: Schema.optional(Schema.Literal("default", "loop", "create_git_worktree", "cleanup_git_worktree")),
  loop: Schema.optional(LoopConfigSchema),
  input: Schema.String,
  expects: Schema.optional(Schema.String),
  timeoutSeconds: Schema.optional(Schema.Number),
  on_fail: Schema.optional(OnFailConfigSchema)
})

const WorkflowPollingSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  timeoutSeconds: Schema.optional(Schema.Number)
})

export const WorkflowSpecSchema = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  description: Schema.optional(Schema.String),
  polling: Schema.optional(WorkflowPollingSchema),
  agents: Schema.NonEmptyArray(WorkflowAgentSchema),
  steps: Schema.NonEmptyArray(WorkflowStepSchema),
  context: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  notifications: Schema.optional(Schema.Unknown),
  run: Schema.optional(Schema.Unknown)
}).pipe(
  Schema.filter(
    (spec) => {
      const agentSlugs = new Set(spec.agents.map((a) => a.slug))
      return spec.steps.every((s) => agentSlugs.has(s.agent))
    },
    { message: () => "every step.agent must reference a defined agent id" }
  )
)