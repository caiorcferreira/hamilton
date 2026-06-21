# Prompts Package — Design Spec

## Goal

Extract prompt-related concerns from `src/agent/` and `src/workflow/context.ts` into a dedicated `src/prompts/` package with five modules, each with one clear responsibility. Introduce a `ResolvablePrompt` type that bundles system prompt, task prompt, and instruction files into a single object passed to the executor.

## Approach: Clean Slice

Move five modules into `src/prompts/` with minimal reshuffling. Delete the originals. Update all imports across the codebase.

## File Structure

```
src/prompts/
  template.ts      — resolveTemplate(), resolveDottedPath()
  persona.ts       — resolvePersona(), Persona, PersonaNotFoundError
  instructions.ts  — loadInstructionFiles(), parseFrontmatter(), scanExtensions()
  builder.ts       — buildAgentPrompt(), PromptParams, BuiltPrompt
  types.ts         — ResolvablePrompt
```

## Module Responsibilities

### `template.ts`

Pure functions, no I/O. Moves from `src/workflow/context.ts`.

- `resolveDottedPath(context: Context, path: string): unknown` — walks `foo.bar.baz` paths
- `resolveTemplate(template: string, context: Context): string` — replaces `{{dotted.path}}` placeholders

Depends on: nothing external.

### `persona.ts`

Reads persona MD files from disk. Moves from `src/agent/persona.ts`.

- `Persona` interface: `{ agent: string, soul: string, identity: string }`
- `PersonaNotFoundError` — `Data.TaggedError("PersonaNotFoundError")<{ agentPath: string }>`
- `resolvePersona(paths: SystemPromptPaths, workflowDir: string): Effect.Effect<Persona, PersonaNotFoundError>`

Depends on: `src/types.ts` (SystemPromptPaths).

### `instructions.ts`

Loads `~/.hamilton/instruction/*.md`, filters by project file extensions. Moves from `src/agent/instructions.ts`.

- `parseFrontmatter(raw: string)` — parses `---yaml---\nbody` format
- `scanExtensions(cwd: string): string[]` — recursively finds file extensions in project dir
- `loadInstructionFiles(cwd: string): Effect.Effect<Array<{name: string, content: string}>>`

Depends on: `src/paths.ts` (instructionDir).

### `builder.ts`

Assembles the final prompt. Moves from `src/agent/activity.ts`.

- `PromptParams` interface: `{ agentFile, soulFile, identityFile, prompt, context, agentConfig }`
- `BuiltPrompt` interface: `{ systemPrompt: string, taskPrompt: string, instructionFiles: Array<{name: string, content: string}> }`
- `buildAgentPrompt(params: PromptParams, instructionFiles: Array<{name: string, content: string}>): BuiltPrompt`

The system prompt is assembled from XML-tagged sections (identity, style, context, harness, agent) joined with `\n\n`. The task prompt is `resolveTemplate(params.prompt.content, params.context)`. Instruction files are passed through as-is into `BuiltPrompt.instructionFiles`.

Depends on: `src/prompts/template.ts`, `src/types.ts` (Prompt, WorkflowAgent).

### `types.ts`

Type definitions only, no runtime code.

- `ResolvablePrompt` interface: `{ systemPrompt: string, taskPrompt: string, instructionFiles: Array<{name: string, content: string}> }`

This is the unified type the executor receives. The runner constructs it by spreading `BuiltPrompt` (which now includes instructionFiles).

Depends on: nothing.

## Data Flow (Post-Refactor)

```
Runner calls:
  1. resolvePersona()           → Persona          (from prompts/persona.ts)
  2. buildAutoContext()         → Context          (from workflow/context.ts — unchanged)
  3. loadInstructionFiles()    → InstructionFile[] (from prompts/instructions.ts)
  4. buildAgentPrompt(params, instructionFiles) → BuiltPrompt (from prompts/builder.ts)
  5. executeWithPi({ prompt: BuiltPrompt as ResolvablePrompt, stepId, runId, model, ... })
```

Steps 3 and 4 may be called in any order (they're independent). Step 3 currently runs once per workflow; step 4 runs per task.

## PiExecutorConfig Change

**Before:**
```ts
interface PiExecutorConfig {
  systemPrompt: string
  taskPrompt: string
  instructionFiles?: Array<{name: string, content: string}>
  stepId: string
  runId: string
  ...
}
```

**After:**
```ts
interface PiExecutorConfig {
  prompt: ResolvablePrompt
  stepId: string
  runId: string
  ...
}
```

The executor destructures internally:
```ts
const { systemPrompt, taskPrompt, instructionFiles } = config.prompt
```

## Import Graph

```
src/prompts/template.ts      → (none — pure)
src/prompts/types.ts          → (none — type definitions)
src/prompts/persona.ts        → src/types.ts
src/prompts/instructions.ts   → src/paths.ts
src/prompts/builder.ts        → src/prompts/template.ts, src/prompts/types.ts, src/types.ts
src/workflow/runner.ts        → src/prompts/persona.ts, src/prompts/builder.ts,
                                src/prompts/instructions.ts, src/prompts/types.ts,
                                src/workflow/context.ts
src/executors/pi/pi-executor  → src/prompts/types.ts
```

No circular dependencies. `src/prompts/` depends only on `src/types.ts` and `src/paths.ts` (leaf modules).

## Files Deleted

| File | Reason |
|---|---|
| `src/agent/activity.ts` | Replaced by `src/prompts/builder.ts` |
| `src/agent/persona.ts` | Replaced by `src/prompts/persona.ts` |
| `src/agent/instructions.ts` | Replaced by `src/prompts/instructions.ts` |

`src/agent/config.ts` stays — `resolveAgentDefaults()` is an agent concern, not a prompt concern.

`src/workflow/context.ts` stays but shrinks — `resolveTemplate()` and `resolveDottedPath()` move out, leaving `Context`, `mergeContext()`, `buildAutoContext()`.

## Test Relocation

| Old | New |
|---|---|
| `tests/agent/activity.test.ts` | `tests/prompts/builder.test.ts` |
| `tests/agent/persona.test.ts` | `tests/prompts/persona.test.ts` |
| `tests/agent/instructions.test.ts` | `tests/prompts/instructions.test.ts` |
| (new) | `tests/prompts/template.test.ts` |

`tests/workflow/context.test.ts` stays but loses `resolveTemplate` and `resolveDottedPath` tests.

## Harness Block

The hardcoded harness XML block (explaining Hamilton workflow and `write_step_output`) stays in `builder.ts`. It is tightly coupled to system prompt assembly.

## Context Type Note

`Context` (type alias for `Record<string, unknown>`) stays defined in `src/workflow/context.ts`. `src/prompts/template.ts` imports it from there. This is acceptable — `Context` is a workflow concern and template rendering depends on it.