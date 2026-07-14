# Tool Prompt Snippets — Design Spec

**Date:** 2026-06-26
**Status:** approved

## Goal

Inject active tool descriptions into the system prompt dynamically, using Pi SDK's native tool snippet injection instead of Hamilton's hardcoded tool list.

## Scope

Two changes. No new files, no new types.

---

## Changes

### 1. `src/prompts/builder.ts` — Remove hardcoded tool list from `defaultContextTemplate`

**File:** `src/prompts/builder.ts:59-64`

Before:
```typescript
const defaultContextTemplate = `## Context
- Current directory: {{inputs.parameters.cwd}}
- Available tools:
  - All built-in tools: read, bash, edit, write, grep, find, ls
  - write_task_output: saves your task results (call once when done, input must be a JSON object with 'status' field)
`
```

After:
```typescript
const defaultContextTemplate = `## Context
- Current directory: {{inputs.parameters.cwd}}
`
```

The context template is now purely about workflow state. Tool descriptions are handled by Pi's native system prompt builder.

### 2. `src/executors/pi/pi-executor.ts` — Swap `systemPromptOverride` for `appendSystemPrompt`

**File:** `src/executors/pi/pi-executor.ts:154`

Before:
```typescript
      systemPromptOverride: () => systemPrompt,
```

After:
```typescript
      appendSystemPrompt: () => systemPrompt,
```

The `systemPrompt` variable is the already-rendered Handlebars output from `systemTemplate.render()` — the Hamilton-specific wrapper (platform intro, instructions, persona if present, context). Pi SDK now builds its own base system prompt first (which includes dynamic tool snippets from every registered `ToolDefinition.promptSnippet`), then appends Hamilton's text.

### No changes needed

- `workflow-extension.ts`: `write_task_output` and `git_diff` already define `promptSnippet` on their `ToolDefinition` registrations.
- `builder.ts` system template: `{{context}}` placeholder still renders the (now shorter) context string.
- `PromptBuilt` event: emitted after rendering, will contain the full system prompt as assembled by Pi.

## How it works

```
Pi SDK base system prompt (auto-generated)
  ├── Available tools (from ToolDefinition.promptSnippet on all registered tools)
  ├── Task description
  └── Guidelines
+
Hamilton appendSystemPrompt
  ├── <platform> block
  ├── <instructions> block
  ├── <persona> block (if present)
  └── <context> block
```

Pi discovers which tools are active at session creation time and injects their `promptSnippet` strings into its base system prompt. Hamilton no longer needs to know or list tools — any extension that registers a tool with a `promptSnippet` gets it automatically included.

## Testing strategy

- `tests/prompts/builder.test.ts`: the "uses default context template" test currently asserts on `/tmp/repo` and `## Context` — update to remove assertions about tool listings.
- `tests/workflow/runner.test.ts` and `tests/workflow/runner-regression.test.ts`: no functional change — the PromptBuilt event still fires with the rendered system prompt. The mock continues to return synthetic values.
- `tests/workflow/runner.test.ts` "does not publish PromptBuilt event for script tasks": unaffected.
