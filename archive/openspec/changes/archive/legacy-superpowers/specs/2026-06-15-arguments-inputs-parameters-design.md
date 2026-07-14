# Arguments, Inputs & Parameters Refactor

**Date:** 2026-06-15
**Status:** approved

## Problem

The current naming and structure around task context is incoherent:

- `forEach` and `context` are top-level YAML fields on tasks with no common parent. They serve the same purpose (defining what data a task receives) but look unrelated.
- `vars` is a runtime-only template namespace that appears nowhere in the YAML schema yet is used throughout prompt templates.
- The system prompt receives the entire task context as `JSON.stringify(context)` inside `<context>` tags — dumping every upstream output into every agent's system prompt, polluting it with irrelevant data.
- Internal terms (`initialContext`, `runningContext`, `Context`) are vaguely named and don't distinguish between workflow-scope state and task-scope data.

## Solution

Four interrelated changes:

1. **Group `forEach` and `context` under `arguments`** in the YAML schema. `context.fields` becomes `arguments.parameters`. This makes the parent-child data contract explicit.

2. **Consolidate template namespaces under `inputs.*`.** All data accessible in prompt templates — task outputs, forEach items, runtime values — lives under `{{inputs.*}}`. No more invisible `vars` namespace.

3. **Introduce `WorkflowEnv`** as the internal runtime data store. `initialContext` becomes `initialParameters` and is stored in the workflow env alongside task outputs. Task outputs no longer live in a raw `Context` map.

4. **Add agent-level context templates** (`CONTEXT.md`) that map workflow env to system prompt context. When present, only the fields the agent declares are included. When absent, a default template preserves backward-compatible behavior.

## Design

### 1. YAML Schema Changes

**`arguments` replaces `forEach` + `context`:**

```yaml
# Before
- name: implement-stories
  template: implement-story
  forEach:
    valueFrom:
      ref: tasks.plan.outputs.tasks
    as: current_task
  context:
    fields:
      - name: repository
        valueFrom:
          ref: tasks.setup.outputs.repo

# After
- name: implement-stories
  template: implement-story
  arguments:
    forEach:
      valueFrom:
        ref: inputs.tasks.plan.outputs.tasks
      as: current_task
    parameters:
      - name: repository
        valueFrom:
          ref: inputs.tasks.setup.outputs.repo
```

`ForEachSchema` and `ContextFieldsSchema` are replaced by a new `ArgumentsSchema`:

```typescript
const ArgumentsSchema = Schema.Struct({
  forEach: Schema.optional(ForEachSchema),
  parameters: Schema.optional(Schema.Array(ArgumentParameterSchema))
})
```

`WorkflowTaskSchema` drops the old `forEach` and `context` fields and gains `arguments: Schema.optional(ArgumentsSchema)`.

`valueFrom.ref` strings are updated to use the `inputs.` prefix — referencing `inputs.tasks.plan.outputs.tasks` instead of `tasks.plan.outputs.tasks`.

### 2. TypeScript Types

**New types in `src/types.ts`:**

```typescript
export interface ArgumentParameter {
  name: string
  valueFrom: { ref: string }
}

export interface Arguments {
  forEach?: ForEach
  parameters?: ArgumentParameter[]
}

// WorkflowTask drops: forEach?, context?
// WorkflowTask gains: arguments?: Arguments
```

The `ForEach` interface stays structurally identical, just moves under `Arguments.forEeach`.

The old `ContextField`, `ContextFields` interfaces are removed.

### 3. Template Namespace: `inputs.*`

All template references consolidate under `inputs.*`:

| Before | After |
|---|---|
| `{{vars.current_task}}` | `{{inputs.parameters.current_task}}` |
| `{{vars.current_task.title}}` | `{{inputs.parameters.current_task.title}}` |
| `{{tasks.setup.outputs.branch}}` | `{{inputs.tasks.setup.outputs.branch}}` |
| `{{cwd}}` | `{{inputs.cwd}}` |
| `{{user_input}}` | `{{inputs.user_input}}` |
| `{{run_id}}` | `{{inputs.run_id}}` |
| `{{progress}}` | `{{inputs.progress}}` |
| `{{progress_file}}` | `{{inputs.progress_file}}` |

The template resolver (`src/prompts/template.ts`) wraps the workflow env in `{ inputs: workflowEnv }` before resolution, so `{{inputs.tasks.setup.outputs.branch}}` traverses `workflowEnv.tasks.setup.outputs.branch`.

Runner-injected variables (`{{retry_feedback}}`, `{{verify_feedback}}`, `{{timeout_retry}}`, `{{changes}}`, `{{completed_stories}}`, `{{stories_remaining}}`, `{{has_frontend_changes}}`, `{{vulnerability_count}}`, `{{findings}}`) are injected directly into the task prompt template context (not the workflow env) and remain top-level references.

### 4. WorkflowEnv

**New module: `src/workflow/env.ts`**

```typescript
export interface WorkflowEnv {
  cwd?: string
  user_input?: string
  run_id?: string
  progress_file?: string
  progress?: string
  tasks: Record<string, { outputs: Record<string, unknown> }>
  parameters?: Record<string, unknown>
  [key: string]: unknown
}
```

**Lifecycle in the runner:**

1. **Init:** `workflowEnv = { ...initialParameters, tasks: {}, run_id, progress_file, progress, cwd, user_input }`
2. **Before each task:** `resolveArguments(task, workflowEnv)` produces `{ parameters: Record<string, unknown>, itemsCount: number }` — the resolved parameters for this task (plus how many forEach iterations).
3. **Per forEach iteration:** A shallow overlay `{ ...workflowEnv, parameters: resolvedParams }` is passed to `executeSingleTask`.
4. **After task completion:** `workflowEnv.tasks[instanceName] = { outputs }`.

`initialParameters` replaces `initialContext` throughout:
- `src/cli/commands/run.ts`: `{ user_input: params.prompt, cwd: process.cwd() }` (value unchanged, variable renamed)
- `src/workflow/runner.ts`: parameter renamed from `initialContext` to `initialParameters`
- `src/workflow/run-state-machine.ts`: parameter renamed from `context` to `params`
- `src/db/queries.ts`: `updateRunContext` → `updateRunEnv` (stores `workflowEnv` JSON)

### 5. Arguments Resolution

**New module: `src/workflow/arguments.ts`** — replaces `src/workflow/context.ts`

```typescript
export function resolveArguments(
  task: WorkflowTask,
  env: WorkflowEnv
): { parameters: Record<string, unknown>; itemsCount: number }
```

Logic:

1. If `task.arguments?.forEach` exists: resolve `valueFrom.ref` against `{ inputs: env }`. If the result is an array, set `items = result` and `itemsCount = result.length`; otherwise `items = [undefined]`, `itemsCount = 1`. If no `forEach`, `items = [undefined]`, `itemsCount = 1`.
2. For each item at index `i`:
   a. Start with base params `{ [as]: items[i] }` (if forEach; otherwise `{}`).
   b. If `task.arguments?.parameters` exists: create a temp env `{ ...env, parameters: baseParams }`, resolve each parameter's `valueFrom.ref` against `{ inputs: tempEnv }`, and merge into the result. This ordering ensures parameters can reference the forEach item via `inputs.parameters.<as>`.
   c. The resolved parameter map for this iteration is the merged result.
3. If no `parameters` and no valid forEach item: return `{ parameters: {}, itemsCount: 1 }`.

The old `buildAutoContext` and `mergeContext` functions are deleted. The old `Context` type is deleted (replaced by `WorkflowEnv`).

### 6. Agent Context Templates

**New optional file in agent directories:** `CONTEXT.md`

```
bundle/workflows/feature-dev/agents/developer/
├── INSTRUCTIONS.md
├── SOUL.md
└── CONTEXT.md          ← new, optional
```

`CONTEXT.md` is a template that receives the workflow env as `{{inputs.*}}` and renders the `<context>` block in the system prompt. Example:

```markdown
## Repository
- Path: {{inputs.cwd}}
- Branch: {{inputs.tasks.setup.outputs.current_branch}}
- Build: {{inputs.tasks.setup.outputs.build_cmd}}
- Test: {{inputs.tasks.setup.outputs.test_cmd}}

## Current Task
{{inputs.parameters.current_task}}

## Patterns
{{inputs.progress}}
```

**Default template** — when the agent has no `CONTEXT.md`:

```markdown
## Inputs
{{inputs}}
```

This preserves backward-compatible behavior (the full env is serialized, equivalent to today's `JSON.stringify(context)`). Agents opt into refinement by adding `CONTEXT.md`.

**Persona resolution** (`src/prompts/persona.ts`) now reads `CONTEXT.md` alongside `INSTRUCTIONS.md` and `SOUL.md`, returning it as a third field.

**`buildAgentPrompt`** changes:

```typescript
export interface PromptParams {
  agentFile: string
  soulFile: string
  contextTemplate?: string   // new
  env: WorkflowEnv           // was: context: Context
  agentConfig: Partial<AgentManifest>
}
```

The system template drops the inline `{{context}}` JSON dump. The rendered context template is injected into the system template's `<context>` slot directly.

### 7. System Prompt Builder Changes

**`src/prompts/builder.ts`** — updated system template:

```
<platform>
# Hamilton Agentic Orchestration
...
</platform>

<instructions>
{{instructions}}
</instructions>

{{persona}}

<context>
{{context}}
</context>
```

Where `{{context}}` is the resolved `CONTEXT.md` (or default template), not `JSON.stringify(params.context)`.

The old pattern of resolving `systemTemplate` against `{ ...params.context, instructions, persona, context }` is replaced by resolving each section independently:

1. Resolve `{{instructions}}` against `{ instructions: agentFile }`
2. Resolve persona section (unchanged)
3. Render context block from `CONTEXT.md` template against `{ inputs: workflowEnv }`
4. Assemble final system prompt

## Affected Files

| File | Change |
|---|---|
| `src/types.ts` | Add `ArgumentParameter`, `Arguments`. Remove `ContextField`, `ContextFields`. Update `WorkflowTask` (`forEach?`, `context?` → `arguments?`) |
| `src/schemas.ts` | Replace `ForEachSchema` (top-level) + `ContextFieldsSchema` with `ArgumentsSchema` containing `forEach?` + `parameters?` |
| `src/workflow/context.ts` | **Delete.** Replaced by `src/workflow/arguments.ts` + `src/workflow/env.ts` |
| `src/workflow/arguments.ts` | **New.** `resolveArguments(task, env)` |
| `src/workflow/env.ts` | **New.** `WorkflowEnv` interface |
| `src/workflow/runner.ts` | `initialContext` → `initialParameters`. `runningContext` → `workflowEnv`. Use `resolveArguments`. Pass `WorkflowEnv` to `buildAgentPrompt`. |
| `src/workflow/run-state-machine.ts` | `createWorkflowRuntime(spec, context)` → `createWorkflowRuntime(spec, params)`. Update `updateRunContext` calls. |
| `src/db/queries.ts` | `updateRunContext` → `updateRunEnv`. Column `context_json` keeps same name but stores env. |
| `src/prompts/builder.ts` | `PromptParams.context` → `PromptParams.env`. `PromptParams.contextTemplate?`. System template context section refactored. |
| `src/prompts/persona.ts` | Read `CONTEXT.md` from agent dir. Return as third field. |
| `src/prompts/template.ts` | Template resolver wraps env in `{ inputs: env }` before resolution. |
| `src/cli/commands/run.ts` | `initialContext` → `initialParameters` (variable rename only). |
| `bundle/workflows/*/workflow.yml` | Move `forEach` + `context` under `arguments`. Rename `vars.*` → `inputs.parameters.*`, `tasks.*` → `inputs.tasks.*`, top-level → `inputs.*`. |
| `tests/fixtures/feature-dev.yml` | Same YAML structural changes. |
| `tests/workflow/context.test.ts` | Replace with `tests/workflow/arguments.test.ts`. New tests for `resolveArguments`. |
| `tests/prompts/builder.test.ts` | Update `PromptParams` shape. Add context template tests. |
| `tests/prompts/template.test.ts` | Update `vars.*` → `inputs.parameters.*`, `tasks.*` → `inputs.tasks.*`. |
| `tests/workflow/runner.test.ts` | Update context variable names. |
| `tests/workflow/run-state-machine.test.ts` | Update `createWorkflowRuntime` calls. |
| `tests/cli/run.test.ts` | `initialContext` → `initialParameters`. |
| `tests/db/queries.test.ts` | `updateRunContext` → `updateRunEnv`. |

## Testing

- **Unit (`resolveArguments`):** Array forEach, single-item forEach, `parameters` with `inputs.*` ref resolution, no arguments (empty params), `parameters` + forEach merge priority.
- **Unit (`WorkflowEnv`):** Shallow overlay for task-scoped parameters, task output storage path.
- **Unit (context template):** Agent with `CONTEXT.md` gets refined context; agent without gets default `{{inputs}}` dump; empty `CONTEXT.md` produces empty context block.
- **Unit (template resolver):** `{{inputs.tasks.setup.outputs.branch}}`, `{{inputs.cwd}}`, `{{inputs.parameters.current_task}}` resolve correctly through the `{ inputs: env }` wrapper. Old `{{vars.*}}` and `{{tasks.*}}` patterns are rejected (remain unreplaced).
- **Integration (runner):** Full workflow with forEach task — verify forEach items resolve through `inputs.parameters.*`, outputs stored in `workflowEnv.tasks`, next task accesses them via `inputs.tasks.*`.
- **Integration (resume):** Paused run serializes/deserializes `workflowEnv` through the DB correctly.
