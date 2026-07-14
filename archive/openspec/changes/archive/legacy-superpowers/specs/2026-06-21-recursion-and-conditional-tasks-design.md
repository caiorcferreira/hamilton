# Recursion and Conditional Tasks (remove `retry_step`)

**Date:** 2026-06-21
**Status:** approved

## Problem

The `retry_step` field on `on_failure` is defined in the schema and parsed but never implemented. It was intended to re-execute a sibling task on failure, but the runner never inspects it. Additionally, the engine has no mechanism for recursive workflows where a templated sub-DAG re-expands itself under a condition (e.g., a verify → feedback → re-implement loop). The ROADMAP item "implement recursion support to solve this" is currently in Next Up.

## Solution

Remove `retry_step` entirely. Add three new primitives that compose into recursion without the engine knowing about "recursion" as a concept:

1. **`when` field** — a CEL expression evaluated before a task executes. If false, the task is skipped (marked complete). Universal — works on any task, not just templates.
2. **`depth` column** — materialized recursion depth on each task row, computed as `parent.depth + 1` at insertion time.
3. **`max_recursion_depth`** — configurable limit in `settings.yaml` (global default) with optional per-workflow override in `spec.run`. The runner fails a task if its depth would exceed the limit.

Recursion is a natural consequence: a task inside a template can name the parent template in its own `template` field, and its `when` condition determines whether another expansion happens.

## Design

### 1. Schema changes

#### Removals

| Location | Change |
|----------|--------|
| `OnFailureSchema` in `src/schemas.ts` | Remove `retry_step` field |
| `OnFailure` in `src/types.ts` | Remove `retry_step?: string` |
| `docs/workflow-yaml.md` | Remove `retry_step` documentation |
| `tests/fixtures/feature-dev.yml` | Remove `retry_step: implement` |
| All bundled workflow YAMLs | Remove any `retry_step` occurrences |

#### Additions

New optional `when` field on every task definition:

```typescript
// schemas.ts
const WorkflowTaskSchema = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(TaskAgentSchema),
  template: Schema.optional(Schema.String),
  arguments: Schema.optional(ArgumentsSchema),
  tasks: Schema.optional(Schema.Array(Schema.lazy(() => WorkflowTaskSchema))),
  when: Schema.optional(Schema.String)  // CEL expression
})
```

New optional `max_recursion_depth` on workflow run spec:

```typescript
const WorkflowRunSchema = Schema.Struct({
  entrypoint: Schema.String,
  timeout: Schema.optional(Schema.String),
  max_recursion_depth: Schema.optional(Schema.Int.pipe(Schema.positive()))
})
```

Task YAML example:

```yaml
- name: apply-verification
  dependencies: [verify-story]
  template: implement-stories
  when: inputs.tasks.verify-story.outputs.feedback != ""
  arguments:
    parameters:
      - name: current_task
        valueFrom:
          ref: inputs.current_task
      - name: feedback
        valueFrom:
          ref: inputs.tasks.verify-story.outputs.feedback
```

### 2. CEL integration (`@marcbachmann/cel-js`)

Library: `@marcbachmann/cel-js` v7.6.1 — zero dependencies, MIT license.

```ts
import { evaluate } from "@marcbachmann/cel-js"
```

The expression context maps `inputs` to the full `WorkflowEnv` object. Expressions use dot notation naturally:

```
inputs.tasks.plan.outputs.stories.size() > 0
inputs.tasks.verify-story.outputs.feedback != ""
inputs.tasks.test.outputs.passed == true
inputs.tasks.lint.outputs.issues.size() == 0 && inputs.tasks.test.outputs.passed
```

#### Strict path validation

Before calling `evaluate()`, parse the CEL AST to extract all variable path references. Walk each path against the `WorkflowEnv` context object. If any segment is missing (undefined), fail the task immediately with a clear error message: `"CEL path not found: inputs.tasks.nonexistent.outputs.x"`. This prevents CEL's default behavior of propagating `null` for undefined paths, which would silently produce surprising boolean results.

If the expression itself is invalid (parse error, type mismatch), fail the task with the CEL error message.

#### CEL macros available

CEL includes macros usable in expressions: `has()`, `size()`, `all()`, `exists()`, `filter()`, `map()`. These are available to workflow authors without any custom implementation.

### 3. `settings.yaml` — new `recursion` section

```yaml
recursion:
  max_depth: 10    # positive integer, optional

extensions:
  - name: rtk
    enabled: true

templating:
  strict: false
```

### 4. Workflow YAML override

```yaml
spec:
  run:
    entrypoint: implement-stories
    timeout: 300s
    max_recursion_depth: 5    # overrides settings.yaml
```

Resolution: `spec.run.max_recursion_depth` > `settings.yaml recursion.max_depth` > unbounded (no limit).

### 5. Database schema migration

New migration v6. Additive only — backward compatible.

```sql
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
```

Existing rows: `parent_task_id = NULL`, `depth = 0`. No data migration needed.

### 6. Runner flow

The runner already iterates over topologically sorted tasks sequentially. New control flow interleaved before execution:

```
for each sorted task:
  if shouldPause() → pause
  if shouldExecuteTask() is false → skip

  depth = task.depth                          // set at insertion time
  max = resolveMaxRecursionDepth()            // workflow YAML → settings → unbounded

  if depth > max → fail_task("max recursion depth exceeded")

  if task.when is set:
    if !validatePaths(task.when, context)     → fail_task("CEL path not found: ...")
    result = evaluate(task.when, { inputs: workflowEnv })
    if result is false                       → mark_task_complete(task), continue

  if task has template:
    expand template with parent_task_id = task.id, depth = depth + 1
  else if task has agent:
    execute agent (unchanged)
```

#### Depth enforcement order

Depth check fires **before** CEL evaluation. An over-depth task fails immediately without running any expression. This prevents a deep tree from burning CPU on condition evaluation.

#### Parent tracking

`parent_task_id` is set at insertion time for every dynamically created task:

- Template expansion via `forEach`: each child gets `parent_task_id = expander.id`
- Template expansion via recursion: same mechanism
- Root tasks (static, from YAML): `parent_task_id = NULL`, `depth = 0`

Depth is always `SELECT depth FROM tasks WHERE id = parent_task_id` + 1 at insertion time. No recursive CTE queries needed — depth is materialized eagerly.

### 7. Task naming convention (cosmetic only)

Task instance names reflect the expansion path for readability but are never parsed for logic:

```
implement-stories/0                   (first forEach iteration of implement-stories)
implement-stories/0-implement-story   (sub-task inside iteration 0)
implement-stories/0-verify-story
implement-stories/0-apply-verification

# If recursion triggers:
implement-stories/0-apply-verification/0-implement-story
implement-stories/0-apply-verification/0-test
implement-stories/0-apply-verification/0-verify-story
implement-stories/0-apply-verification/0-apply-verification
```

Names are assembled as `parentName/{iterationIndex}-{taskName}` (for `forEach`) or `parentName/{taskName}` (for non-iterated templates), but this is purely cosmetic. All logic uses `depth` and `parent_task_id`.

### 8. Error handling

| Error | Trigger | Result |
|-------|---------|--------|
| CEL parse error | Invalid expression syntax | Task fails, message includes CEL error |
| CEL path not found | Referenced path in expression doesn't exist in context | Task fails, message lists the missing path |
| CEL runtime error | Type mismatch, division by zero, etc. | Task fails, message includes CEL error |
| Max depth exceeded | Task's `depth` exceeds resolved `max_recursion_depth` during the runner's pre-execution check | Task fails, message: "max recursion depth (N) exceeded" |
| Unbounded recursion | No `max_depth` configured anywhere, infinite loop | The workflow runs forever — same as any infinite loop in code. No engine safeguard. Users must configure `max_depth` if they write recursive templates. |

### 9. Files affected

| File | Change |
|------|--------|
| `src/schemas.ts` | Remove `retry_step` from `OnFailureSchema`. Add `when` to `WorkflowTaskSchema`. Add `max_recursion_depth` to `WorkflowRunSchema`. |
| `src/types.ts` | Remove `retry_step` from `OnFailure`. Add `when?: string` to `WorkflowTask`. Add `max_recursion_depth?: number` to `WorkflowRun`. |
| `src/workflow/runner.ts` | Add `when` evaluation, depth check, `parent_task_id`/`depth` insertion for dynamic tasks. |
| `src/workflow/run-state-machine.ts` | Update `insertDynamicTask` to accept and store `parent_task_id` and `depth`. |
| `src/db/schema.ts` | Migration v6: add `parent_task_id` and `depth` columns. |
| `src/db/queries.ts` | Update INSERT queries to include new columns. |
| `src/db/migrations.ts` | Register migration v6. |
| `src/paths.ts` | Add `recursion.max_depth` to settings loading (or add to settings config module). |
| `src/workflow/loader.ts` | Validate `spec.run.max_recursion_depth` is a positive integer if present. |
| `package.json` | Add `@marcbachmann/cel-js` dependency (v7.6.1). |
| `docs/workflow-yaml.md` | Remove `retry_step`, add `when`, `depth`, `max_recursion_depth` docs. |
| `docs/settings.md` | Add `recursion.max_depth` docs. |
| `bundle/workflows/feature-dev/workflow.yml` | Replace `retry_step`-based example with recursion-based example (verify → feedback → re-implement loop). |
| `tests/fixtures/feature-dev.yml` | Remove `retry_step`. Add recursion test fixtures. |
| All bundled workflow YAMLs | Remove any `retry_step` occurrences. |

### 10. Testing

Existing tests:
- Update fixtures that reference `retry_step`
- Tests for `OnFailure` type must not reference `retry_step`
- All 155 existing tests must continue passing

New tests:

| Test | What it verifies |
|------|-----------------|
| `when` on root task, condition false | Task skipped, dependents run |
| `when` on root task, condition true | Task executes normally |
| `when` with invalid CEL syntax | Task fails with parse error |
| `when` referencing missing path | Task fails with "path not found" error |
| `when` with runtime type error | Task fails with CEL error |
| `when` without template (agent task) | Task gates execution on condition |
| Recursion base case hits | `when` becomes false, recursion stops, workflow completes |
| Recursion depth exceeds max | Task fails with "max recursion depth exceeded" |
| Depth computed correctly | `parent.depth + 1` for both `forEach` and recursion |
| Depth column is 0 for root tasks | Static tasks have `parent_task_id = NULL, depth = 0` |
| `max_recursion_depth` precedence | Workflow override > settings > unbounded |
| `settings.yaml` missing `recursion` section | Defaults to unbounded, no errors |
| CEL `size()` macro | Works on arrays in context |
| Multiple recursion levels | Depth accumulates correctly |
| `retry_count` still works | Same-task retry from `max_retries` unaffected |

### 11. What is not included

- Recursion with fork/join parallelism — out of scope (only sequential expansion)
- Visualizing recursion depth in CLI output — can be added later
- Recursion-aware logging or metrics — reuses existing observability
- Automatic unbounded recursion guard — users who omit `max_depth` get no protection
