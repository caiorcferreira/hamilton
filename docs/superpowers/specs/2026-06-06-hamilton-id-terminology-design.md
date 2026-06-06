# Hamilton ID Terminology & Step ID Format — Design Spec

## Summary

Rename identifiers across the codebase to clarify the distinction between
reusable YAML-defined identifiers (slugs) and runtime execution identifiers
(IDs). Change the step execution ID format from a colon-separated composite to
a UUID-prefixed compound ID.

## Motivation

Today `id` is overloaded: `WorkflowSpec.id` is a human-readable slug like
`feature-dev`, but `steps.id` is a runtime composite like
`feature-dev-abc:triage`. The word "id" means different things depending on
context. Tasks 3–6 in ROADMAP.md define a consistent vocabulary.

## Decisions Made

- Clean break — no YAML backward compatibility (only Hamilton reads these files)
- No database migration — fresh start on existing data
- Drop `steps.step_slug` column — the slug is parseable from the new step ID
- Include branded types and remove the duplicate `buildRunId` in `workflow-engine.ts`

## Terminology Mapping

| Old Name              | New Name    | Example                                  | Notes                             |
|-----------------------|-------------|------------------------------------------|-----------------------------------|
| `WorkflowSpec.id`     | `slug`      | `feature-dev`                            | YAML field `id:` → `slug:`       |
| `WorkflowStep.id`     | `slug`      | `plan`                                   | YAML field `id:` → `slug:`       |
| `WorkflowAgent.id`    | `slug`      | `planner`                                | YAML field `id:` → `slug:`       |
| `runId`               | `runId`     | `feature-dev-a1b2c3d4-...`              | **No change**                    |
| `stepId` (YAML name)  | `stepSlug`  | `plan`                                   | When referencing the YAML step   |
| `steps.id` (old PK)   | `stepId`    | `feature-dev-a1b2-...-plan-e5f6-...`    | New format                       |
| `buildRunId()`        | `buildRunId()` | same | Remove duplicate from `workflow-engine.ts` |

## Step ID Format

**New format:** `<runId>-<stepSlug>-<uuid>`

Each step execution gets its own globally unique identifier. The slug is
embedded in the ID and parseable without a separate DB column.

### Generation

```typescript
export function buildStepId(runId: string, stepSlug: string): string {
  return `${runId}-${stepSlug}-${Crypto.randomUUID()}`
}
```

Called at `insertSteps` time in `src/db/queries.ts`, replacing the old composite
`${runId}:${stepSlug}`.

### Where it changes

| Context                   | Old Value                | New Value                           |
|---------------------------|--------------------------|-------------------------------------|
| `steps.id` (PK)           | `feature-dev-abc:triage` | `feature-dev-abc-triage-def`        |
| `token_events.step_id`    | `triage`                 | `feature-dev-abc-triage-def`        |
| Run dir step output file  | `step-outputs/triage.json`  | `step-outputs/feature-dev-abc-triage-def.json` |
| Run dir step log file     | `logs/triage.jsonl`         | `logs/feature-dev-abc-triage-def.jsonl`        |
| `PiExecutorConfig.stepId` | `triage`                 | `feature-dev-abc-triage-def`        |
| State machine `transitionStep(stepId)` | `triage`       | `feature-dev-abc-triage-def`        |

### DB Schema Change

The `steps` table loses the `step_id` column — slug is embedded in `id`.

```sql
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,          -- now: feature-dev-<uuid>-plan-<uuid>
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  output_json TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

`token_events.step_id` stores the full step ID, not the slug. No FK constraint
change needed.

## Branded Types

Added to `src/types.ts` for compile-time disambiguation:

```typescript
export type WorkflowSlug = string & { readonly __brand: "WorkflowSlug" }
export type StepSlug = string & { readonly __brand: "StepSlug" }
export type AgentSlug = string & { readonly __brand: "AgentSlug" }
export type RunId = string & { readonly __brand: "RunId" }
export type StepId = string & { readonly __brand: "StepId" }
```

Applied to all relevant interfaces (`WorkflowSpec`, `WorkflowStep`,
`WorkflowAgent`, `RunRow`, `StepRow`, `RunStatusRow`, `PiExecutorConfig`,
`WorkflowEvent`, `SubscribeConfig`, etc.) and function signatures.

Branded types are erased at runtime — they only enforce correct usage at
compile time. A bare `string` cannot be passed where a `RunId` is expected
without an explicit cast.

## Cleanup

- Delete `buildRunId` from `src/workflow/workflow-engine.ts`. If that file has no other exports, remove the file entirely.
- Remove `step_id` column from `steps` table in `src/db/schema.ts`.

## Error Handling

No new error paths. Existing errors (`WorkflowNotFoundError`,
`PiExecutionError`, etc.) get parameter name updates (`workflowId` → `slug`
or `runId`). Error types and handling logic remain unchanged.

## Testing

All existing 155 tests should pass after the rename. No new test files needed.

| Area | Change |
|------|--------|
| `buildStepId` format | New test for `<runId>-<stepSlug>-<uuid>` pattern |
| `buildRunId` dedup | Verify only one `buildRunId` exists, in `src/workflow/engine.ts` |
| YAML parsing | Update `WorkflowSpec` schema for `slug:` field; update test fixture YAMLs |
| DB queries | `db/queries.test.ts` — step inserts use new format, assertions use compound step IDs |
| Run dir files | `run-dir.test.ts` — file paths use new step ID format |
| CLI output | `status.test.ts`, `runs.test.ts` — `stepId` now shows compound ID |
| State machine | `transitionStep` takes compound `stepId` |
| Branded types | Verify branded types reject bare strings at compile time |

## Execution Order

Bottom-up refactor in a single pass:

1. **Types** — `src/types.ts`: add branded types, rename `id` → `slug` on `WorkflowSpec`, `WorkflowStep`, `WorkflowAgent`
2. **Schemas** — `src/schemas.ts`, `src/db/schema.ts`: YAML schema `id:` → `slug:`, DB schema drop `step_id` column
3. **DB queries** — `src/db/queries.ts`: rename params/fields, `insertSteps` uses `buildStepId`, update `RunRow`/`StepRow`/`RunStatusRow` interfaces
4. **Engine** — `src/workflow/engine.ts`: add `buildStepId`, remove duplicate `buildRunId`
5. **State machine** — `src/workflow/run-state-machine.ts`: `stepId` params/fields → compound format
6. **Runner** — `src/workflow/runner.ts`: `WorkflowEvent.stepId`, `ctx.stepId` → compound
7. **Observability** — `src/observability/run-dir.ts`, `src/observability/streaming.ts`: file names, config fields
8. **PI executor** — `src/agent/pi-executor.ts`: `PiExecutorConfig.stepId` → compound
9. **Resolver/loader** — `src/workflow/resolver.ts`, `src/workflow/loader.ts`: workflow `id` → `slug`
10. **CLI** — `src/cli/commands/*.ts`: parameter and display updates
11. **YAML files** — `workflows/**/workflow.yml`, `agents/shared/**/*.yml`: `id:` → `slug:`
12. **Tests** — update all test files to match new names and formats
13. **Verify** — `bun run build && bun --bun vitest run`
