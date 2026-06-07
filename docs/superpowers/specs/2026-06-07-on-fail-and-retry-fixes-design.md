# on_fail Support, Run ID Fix, and write_step_output Reminders

## Problem

Three bugs identified in the workflow runner that cause silent failures:

1. **`on_fail.max_retries` is dead** — 20 workflow YAMLs configure it, but `runner.ts` only reads `step.max_retries`. Steps like `verify` that lack step-level `max_retries` default to 1 attempt and fail immediately, even though `on_fail.max_retries: 4` is configured.

2. **Run ID mismatch on error** — `run.ts` catchAll calls `buildRunId(spec.slug)` in the error path, generating a fresh random ID instead of preserving the original run's ID. The CLI output shows a different run ID at the end than the one displayed during step execution.

3. **Agents forget to call `write_step_output`** — Agents occasionally produce text responses concluding "STATUS: done" without calling the tool. With 1 retry, this fails the workflow. Evidence: the developer agent (step `implement`) failed on its first 3 attempts and only succeeded on the 4th — it needed the retries.

## Design

### 1. Single `max_retries` source: `on_fail.max_retries`

**Remove `max_retries` from `WorkflowStep`** (types.ts, schemas.ts). All retry configuration lives inside `on_fail`.

Runner change (`src/workflow/runner.ts:102`):

```typescript
const maxRetries = step.on_fail?.max_retries ?? 1
```

**YAML migration**: Every workflow step that has `max_retries: N` at the step level moves it into `on_fail`:

Before:
```yaml
  - slug: plan
    max_retries: 4
    on_fail:
      escalate_to: human
```

After:
```yaml
  - slug: plan
    on_fail:
      max_retries: 4
      escalate_to: human
```

Steps that already have `max_retries` inside `on_fail` (like `verify` in feature-dev) need no YAML change — they start working as-is.

**20 workflow YAMLs affected** (all files under `workflows/`). Each has 1-7 instances of `max_retries` to relocate.

**`retry_step` is not implemented** — the field remains in the schema (parsed, not enforced) and is not acted upon by the runner. The runner only uses `on_fail.max_retries` for step-level retry via `Effect.retry(Schedule.recurs(...))`.

**`escalate_to: "human"`** on both `on_fail` and `on_exhausted` maps to `workflowStatus = "failed"` and breaks the step loop.

### 2. Run ID preservation

In `src/cli/commands/run.ts`, the `Effect.catchAll` handler at line 74-86 generates a new run ID:

```typescript
Effect.catchAll((error) =>
  Effect.succeed<WorkflowResult>({
    runId: buildRunId(spec.slug),  // ← bug: new random ID
    status: "failed",
    ...
  })
)
```

Fix: catch the error inside `runWorkflow` (in `runner.ts`), where `runId` is already in scope at line 76 (`const runId = ctx.runId`). Wrap the `body` Effect so failures return a `WorkflowResult` with the original `runId` instead of propagating the error to the caller.

In `runner.ts`, change the `body` return from propagating errors to catching them:

```typescript
const body = Effect.gen(function* () {
  // ... existing step loop ...
  return { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt }
})

// Catch errors in body — preserve runId instead of propagating
return yield* _(body.pipe(
  Effect.catchAll((error) =>
    Effect.succeed({
      runId,          // original runId, not a new one
      status: "failed" as const,
      stepResults: {},
      context: runningContext,
      startedAt,
      completedAt: new Date().toISOString()
    } satisfies WorkflowResult)
  ),
  Effect.ensuring(ctx.close())
))
```

Then in `run.ts`, remove the `Effect.catchAll` that generates a new runId — `runWorkflow` now always returns a `WorkflowResult`, never throws.

### 3. write_step_output reminder injection

In `src/agent/pi-executor.ts`, after `session.prompt(config.taskPrompt)` completes, if the output file doesn't exist, prompt the agent up to 2 more times within the same session:

```
session.prompt(taskPrompt)
  → output file missing?
  → session.prompt("You haven't called write_step_output yet.
                     Call it now with your results as a JSON object
                     that includes a 'status' field.")
  → still missing?
  → session.prompt(same reminder, second attempt)
  → still missing?
  → PiExecutionError → propagates to runner's on_fail retry layer
```

The reminder count (2) is a constant in `pi-executor.ts`. Each reminder call continues the existing conversation — the agent has full context of everything it already did.

Combined with `on_fail.max_retries: 4`, a step gets up to 12 total chances to call `write_step_output` (4 fresh sessions × 3 prompts each).

## Files Changed

| File | Change |
|---|---|
| `src/types.ts` | Remove `max_retries` from `WorkflowStep` |
| `src/schemas.ts` | Remove `max_retries` from `WorkflowStepSchema` |
| `src/workflow/runner.ts` | Read `step.on_fail?.max_retries ?? 1`; handle `escalate_to: human`; catch `body` errors to preserve runId |
| `src/agent/pi-executor.ts` | Add reminder injection loop after `session.prompt()` |
| `src/cli/commands/run.ts` | Remove `Effect.catchAll` that generated a new runId (now handled in runner.ts) |
| `workflows/**/workflow.yml` | Move `max_retries` into `on_fail` for all steps (20 files) |

## Testing

- **Unit tests for reminder injection**: Mock session to fail on first 2 `prompt()` calls and succeed on the 3rd → verify file is written
- **Unit tests for `on_fail.max_retries` fallback**: Step with only `on_fail.max_retries: 3` → runner retries 3 times
- **Unit tests for runId preservation**: Trigger workflow error → verify result.runId matches the original
- **Existing tests must continue passing** (155 tests)
