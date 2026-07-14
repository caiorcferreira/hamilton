# Template Class Refactor — Design Spec

**Date:** 2026-06-26
**Status:** approved

## Goal

Resolve all 17 TODOs across 5 source files by centralizing template rendering through the existing `Template` class and cleaning up naming/encapsulation in the prompts subsystem.

## Scope

Every TODO in `src/prompts/template.ts`, `src/prompts/builder.ts`, `src/prompts/persona.ts`, `src/workflow/runner.ts`, and `src/executors/pi/pi-executor.ts`.

## Strategy

Three sequential phases, each independently buildable and testable. Commit after each phase; merge only after all three are complete.

---

## Phase 1 — Renames & Persona structural changes

### `src/prompts/persona.ts`

| Before | After |
|--------|-------|
| `Persona` interface | `SystemPromptFragments` |
| `agent: string` | `agent: Prompt` |
| `soul: string` | `soul: Prompt` |
| `context: string` | `context: Prompt` |
| `tryReadOptional(filePath: string)` | `readOptionalFile(filePath: string)` |
| `resolvePersona(...)` | `resolveSystemPromptFragments(...)` |

Behavior changes:
- Remove the early-return guard `if (!paths.agent) return ""`. A missing agent file should surface as an error, not silently produce an empty string.
- Replace the hardcoded `"CONTEXT.md"` filename with `paths.context` provided by the caller. `resolveSystemPromptFragments` no longer assumes a fixed filename.

### `src/prompts/builder.ts`

| Before | After |
|--------|-------|
| `PromptParams` with `agentFile`, `soulFile`, `contextTemplate` fields | `PromptParams` with single `fragments: SystemPromptFragments` field |
| `prompt: Prompt` | `taskPrompt: Prompt` |
| `BuiltPrompt` | `AgentPrompts` |
| `buildAgentPrompt(...)` | `buildAgentsPrompts(...)` |

### Call sites

- `src/workflow/runner.ts`: replace `buildAgentPrompt` → `buildAgentsPrompts`, `resolvePersona` → `resolveSystemPromptFragments`, adapt `PromptParams` shape.
- All test files importing renamed symbols: mechanical find/replace.

### Phase 1 invariants

- No behavioral change beyond removing the early-return guard and the hardcoded context filename.
- `buildAgentsPrompts` still returns string fields (`systemPrompt`, `taskPrompt`). Runtime output is identical.

---

## Phase 2 — Template class becomes the sole rendering API

### Core principle

Construct early, render late. The `Template` class holds compiled Handlebars templates with variables. Only `executeWithPi` calls `.render()` to produce final strings. All intermediate code works with opaque `Template` instances.

### `src/prompts/template.ts`

- Export the `Template` class (currently private to the module).
- `resolveTemplate()` → **unexported**. Becomes an internal helper called by `Template.render()`.
- `resolveFileTemplate()` → **unexported**. Its logic moves into a new static factory:
  ```
  Template.fromFile(path: string, options?: TemplateOptions): Effect<Template, TemplateFileError>
  ```
  Reads the `.hbs` file, compiles it, returns a `Template` instance.

- Remove the two TODO comments (lines 51 and 91) — they are now resolved.

### `src/prompts/builder.ts`

- `buildAgentsPrompts` return type changes from `{ systemPrompt: string, taskPrompt: string }` to `{ systemTemplate: Template, taskTemplate: Template }`.
- Internally constructs templates via `Template.make()`, populates variables via `.setVar()`. Never calls `.render()`.
- Remove the TODO on line 5 (accept `SystemPromptFragments`) — resolved in Phase 1.

### All callers

Any code currently calling `resolveTemplate()` or `resolveFileTemplate()` switches to constructing and passing `Template` instances. No one calls `.render()` except `executeWithPi`.

### `src/workflow/runner.ts`

No longer receives strings from `buildAgentsPrompts`. Receives `{ systemTemplate, taskTemplate }` and passes them through to the agent execution config unchanged.

### Phase 2 invariants

- `Template` is the only template API visible outside this module.
- No string rendering happens before `executeWithPi`.
- All existing tests pass with type adjustments.

---

## Phase 3 — Logic moves and cleanup

### `src/prompts/builder.ts`

- The JavaScript ternary that conditionally wraps `resolvedSoul` in `<persona>` tags moves into the Handlebars system template, using `{{#if persona}}...{{/if}}`. Remove the TODO on line 75.

- `buildAgentsPrompts` gains responsibility for wrapping the task prompt with output-schema tags (`<task_output_schema>`) and user-prompt tags (`<user_prompt>`). It receives the output schema and user input as parameters. The runner no longer does this.

### `src/workflow/runner.ts`

- Delete the 12-line block (line ~156) that mutates `taskPromptContent` with schema and user-prompt wrapping. The runner just passes raw inputs to `buildAgentsPrompts` and forwards the returned `Template` instances. Remove the TODO on line 156.

### `src/executors/pi/pi-executor.ts`

- Receives `{ systemTemplate, taskTemplate }` in the execution config instead of raw prompt strings.
- Calls `.render()` on both templates at execution time to produce final strings.
- Publishes the `PromptBuilt` event here, after rendering. Remove the `PromptBuilt` emission currently in `runner.ts:168`. Remove the TODO on line 114.

### Phase 3 invariants

- The runner owns zero prompt-formatting logic. It is a pure orchestrator.
- `executeWithPi` is the sole rendering point and the sole `PromptBuilt` publisher.
- All 17 TODOs are resolved.

---

## Files touched

| File | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| `src/prompts/template.ts` | — | ✓ | — |
| `src/prompts/persona.ts` | ✓ | — | — |
| `src/prompts/builder.ts` | ✓ | ✓ | ✓ |
| `src/workflow/runner.ts` | ✓ | ✓ | ✓ |
| `src/executors/pi/pi-executor.ts` | — | ✓ | ✓ |
| Test files (matching structure) | ✓ | ✓ | ✓ |

## Error handling

- The removed early-return guard in `resolveSystemPromptFragments` means a missing agent file now throws a `TemplateFileError` from `readOptionalFile`. This is the intended behavior — silent fallback to empty string masked configuration errors.
- `Template.fromFile()` uses the same `TemplateFileError` type already defined in `template.ts`.
- `Template.render()` continues to produce `MissingVariableError` and `TemplateSyntaxError` as before.

## Testing strategy

- Existing tests are the primary safety net. Renames are mechanical; type errors will catch mismatches.
- Phase 2: tests that previously asserted on rendered strings will instead assert on Template instances (or defer to Phase 3 where rendering is tested at the `executeWithPi` level).
- Phase 3: new or updated tests verify that `PromptBuilt` is emitted by `executeWithPi` with the correct rendered content, and that the runner produces no rendered strings.
