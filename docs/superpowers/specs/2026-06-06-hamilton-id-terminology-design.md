# Hamilton ID Terminology & Step ID Format — Design Spec

## Summary

Rename identifiers across the codebase to clarify the distinction between
reusable YAML-defined identifiers (slugs) and runtime execution identifiers
(IDs). Change the step execution ID format from a colon-separated composite to
a nanoid-prefixed compound ID. Replace `Crypto.randomUUID()` with `nanoid(5)`
for all runtime ID generation.

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
- Use `nanoid(5)` instead of `Crypto.randomUUID()` for all runtime IDs (shorter, URL-safe, add `nanoid` 3.3.12 as direct dependency)

## Terminology Mapping

| Old Name              | New Name    | Example                                  | Notes                             |
|-----------------------|-------------|------------------------------------------|-----------------------------------|
| `WorkflowSpec.id`     | `slug`      | `feature-dev`                            | YAML field `id:` → `slug:`       |
| `WorkflowStep.id`     | `slug`      | `plan`                                   | YAML field `id:` → `slug:`       |
| `WorkflowAgent.id`    | `slug`      | `planner`                                | YAML field `id:` → `slug:`       |
| `runId`               | `runId`     | `feature-dev-a1b2c`                       | **No change**                    |
| `stepId` (YAML name)  | `stepSlug`  | `plan`                                    | When referencing the YAML step   |
| `steps.id` (old PK)   | `stepId`    | `feature-dev-a1b2c-plan-e5f6g`            | New format                       |
| `buildRunId()`        | `buildRunId()` | same | Remove duplicate from `workflow-engine.ts` |

## ID Generation (nanoid)

All runtime IDs use `nanoid(5)` — 5-character URL-safe random strings. This
replaces `Crypto.randomUUID()` for both run IDs and step IDs. Shorter IDs are
easier to read in CLI output and file paths.

Add `"nanoid": "3.3.12"` to `package.json` (already a transitive dependency via
postcss).

### Generation

```typescript
import { nanoid } from "nanoid"

export function buildRunId(workflowSlug: string): string {
  return `${workflowSlug}-${nanoid(5)}`
}

export function buildStepId(runId: string, stepSlug: string): string {
  return `${runId}-${stepSlug}-${nanoid(5)}`
}
```

### Examples

| ID type  | Example                         |
|----------|---------------------------------|
| runId    | `feature-dev-a1b2c`             |
| stepId   | `feature-dev-a1b2c-plan-e5f6g`  |

### Where it changes

| Context                   | Old Value                | New Value                           |
|---------------------------|--------------------------|-------------------------------------|
| `steps.id` (PK)           | `feature-dev-abc:triage` | `feature-dev-a1b2c-triage-e5f6g`    |
| `token_events.step_id`    | `triage`                 | `feature-dev-a1b2c-triage-e5f6g`    |
| Run dir step output file  | `step-outputs/triage.json`  | `step-outputs/feature-dev-a1b2c-triage-e5f6g.json` |
| Run dir step log file     | `logs/triage.jsonl`         | `logs/feature-dev-a1b2c-triage-e5f6g.jsonl`        |
| `PiExecutorConfig.stepId` | `triage`                 | `feature-dev-a1b2c-triage-e5f6g`    |
| State machine `transitionStep(stepId)` | `triage`       | `feature-dev-a1b2c-triage-e5f6g`    |

### DB Schema Change

The `steps` table loses the `step_id` column — slug is embedded in `id`.

```sql
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,          -- now: feature-dev-xxxxx-plan-xxxxx
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
- Remove `import { Crypto } from "node:crypto"` — replaced by nanoid.

## Error Handling

No new error paths. Existing errors (`WorkflowNotFoundError`,
`PiExecutionError`, etc.) get parameter name updates (`workflowId` → `slug`
or `runId`). Error types and handling logic remain unchanged.

## Testing

All existing 155 tests should pass after the rename. No new test files needed.

| Area | Change |
|------|--------|
| `buildStepId` format | New test for `<runId>-<stepSlug>-<nanoid(5)>` pattern |
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
