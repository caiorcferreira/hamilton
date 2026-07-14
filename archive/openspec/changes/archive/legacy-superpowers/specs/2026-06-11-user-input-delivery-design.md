# User Input Delivery Fix

**Date:** 2026-06-11
**Status:** approved

## Problem

If a workflow's entrypoint task prompt template does not contain `{{task}}`, the user's CLI input is silently lost — the agent never receives it.

Currently, user input from `hamilton run <slug> "do something"` is placed in context as `{ task: "do something" }` (`src/cli/commands/run.ts:68`). Template resolution (`src/prompts/template.ts:15`) only injects `{{task}}` if the template explicitly includes it. If the author forgets, user input is dropped.

## Solution

Two changes:

1. **Rename `task` → `user_input`** in the initial context key. This clarifies the variable's purpose and avoids name collision with the workflow concept of "task" (DAG node).

2. **Force-inject user input into the entrypoint task prompt.** After `buildAgentPrompt` renders the task prompt, the runner appends a final section with the user input. This guarantees delivery regardless of template content.

## Design

### Change 1: Rename context key

**File:** `src/cli/commands/run.ts:68`

```
// Before
{ task: params.prompt }

// After
{ user_input: params.prompt }
```

The runner spreads `initialContext` into `runningContext` at `src/workflow/runner.ts:107`, so `user_input` propagates automatically. Any downstream task can access it via `{{user_input}}` if needed.

Bundled workflow YAMLs currently contain `{{task}}` in their entrypoint prompts. These references are **removed** since the wrapping makes them redundant (see Change 2). The YAML templates become simpler — they describe only the task intent, and user input is always appended.

### Change 2: Wrap entrypoint prompt in runner

**File:** `src/workflow/runner.ts`, inside `executeSingleTask`, after line 141 (`buildAgentPrompt` returns)

```typescript
let finalTaskPrompt = prompt.taskPrompt
if (task.name === spec.spec.run.entrypoint) {
  finalTaskPrompt = `${finalTaskPrompt}\n\n# User input\n\n${runningContext.user_input}`
}
```

The `finalTaskPrompt` replaces `prompt.taskPrompt` in:
- The `PromptBuilt` event (line 143) — published prompt reflects what was actually sent
- The `executeWithPi` call (line 159) — agent receives the wrapped prompt

`buildAgentPrompt` stays pure: it renders the template as given. The wrapping is a runner concern.

### Entrypoint detection is variant-safe

Variants prepend "start" tasks as dependencies of the original entrypoint (`src/workflow/variants.ts:170-174`), but the original entrypoint task **name is preserved**. The check `task.name === spec.spec.run.entrypoint` always identifies the correct task regardless of variant composition.

Variant start tasks (e.g., `create-branch`, `create-worktree`) are separate DAG nodes with different names. They are not wrapped.

### Wrapping only when task uses an agent

The wrapping is conditional on the task having an agent — which is already guarded by the `if (!task.agent) return` check at `runner.ts:119`. Non-agent tasks (existing only in variants or future extensions) are never wrapped.

## Affected files

| File | Change |
|---|---|
| `src/cli/commands/run.ts` | `{ task: params.prompt }` → `{ user_input: params.prompt }` |
| `src/workflow/runner.ts` | Add entrypoint wrapping after `buildAgentPrompt` |
| `bundle/workflows/*/workflow.yml` | Remove `{{task}}` from entrypoint task prompts |
| `tests/fixtures/feature-dev.yml` | Remove `{{task}}` from test fixture entrypoint prompts |
| `tests/cli/run.test.ts` | Update `task` context key assertions to `user_input` |

## Testing

- **Unit:** Wrap logic can be tested with a mock context — given an entrypoint task name and `user_input`, verify the prompt is appended.
- **Integration:** Existing runner tests that assert `PromptBuilt` event content will need their `taskPrompt` expectations updated to include the forced `# User input` section.
- **CLI:** The `executeRun` tests in `tests/cli/run.test.ts` pass `{ task: ... }` as initial context — update to `{ user_input: ... }`.
- **Edge cases:** Empty user input (whitespace-only prompt), entrypoint with no prompt content (empty string), non-agent entrypoint task (should not wrap).
