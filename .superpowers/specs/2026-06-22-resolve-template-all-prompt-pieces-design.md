# Resolve Template for All System Prompt Pieces — Design

**Date:** 2026-06-22  
**Status:** proposed

## Problem

`buildAgentPrompt` applies Handlebars template resolution only to `CONTEXT.md` (and the task prompt). `INSTRUCTIONS.md` and `SOUL.md` are inserted as raw text into the system template. A `{{inputs.tasks.setup.outputs.branch}}` expression works in CONTEXT.md but renders as literal `{{...}}` text in INSTRUCTIONS.md or SOUL.md.

## Change

Apply `resolveTemplate()` to all three persona files before assembling the system prompt. Same context (`{ inputs: WorkflowEnv }`), same `strict` flag from settings, same behavior as CONTEXT.md today.

## Affected File

`src/prompts/builder.ts` — `buildAgentPrompt` function only. No interface changes, new types, or changes to any other file.

## Before/After

```typescript
// BEFORE (current)
const persona = params.soulFile
  ? `<persona>\n${params.soulFile}\n</persona>`
  : ""

const renderedContext = resolveTemplate(template, contextForTemplate, options)

const resolvedSystem = resolveTemplate(systemTemplate, {
  instructions: params.agentFile,   // raw
  persona,                          // raw
  context: renderedContext,
}, options)
```

```typescript
// AFTER
const resolvedAgentFile = resolveTemplate(params.agentFile, { inputs: params.env }, options)

const resolvedSoul = params.soulFile
  ? resolveTemplate(params.soulFile, { inputs: params.env }, options)
  : ""

const persona = resolvedSoul
  ? `<persona>\n${resolvedSoul}\n</persona>`
  : ""

const renderedContext = resolveTemplate(
  params.contextTemplate || defaultContextTemplate,
  params.contextTemplate ? { inputs: params.env } : { inputs: JSON.stringify(params.env) },
  options
)

const resolvedSystem = resolveTemplate(systemTemplate, {
  instructions: resolvedAgentFile,
  persona,
  context: renderedContext,
}, options)
```

## Edge Cases

| Case | Behavior |
|------|----------|
| Empty SOUL.md | No `<persona>` block. Resolution of empty string is a no-op. |
| File without `{{ }}` | `resolveTemplate` fast path returns immediately. Zero overhead. |
| Missing variable, `strict: false` | Renders as empty string (same as CONTEXT.md today). |
| Missing variable, `strict: true` | `MissingVariableError` thrown from whichever file hits first. |
| Template syntax error | `TemplateSyntaxError` thrown (same as today for CONTEXT.md). |

## Template Context

All three persona files share: `{ inputs: params.env }` where `WorkflowEnv` provides `tasks`, `parameters`, `cwd`, `user_input`, `run_id`, `change_dir`, etc.

## Non-Goals

- No changes to `resolvePersona` or the `Persona` interface.
- No changes to the runner, Pi executor, agent manifests, or agent registry.
- No new Handlebars helpers.
- CONTEXT.md default template (`## Inputs\n{{inputs}}`) is unchanged.
