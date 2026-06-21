# Hamilton ID Terminology & Step ID Format — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename YAML identifiers from `id` to `slug`, rename step-related variables from `stepId` to `stepSlug` where they reference the YAML name, change step execution IDs from `${runId}:${stepSlug}` to `<runId>-<stepSlug>-<nanoid(5)>`, add branded types, and remove the duplicate `workflow-engine.ts`.

**Architecture:** Bottom-up refactor — types first, then schemas, DB layer, engine, state machine, runner, observability, PI executor, resolver/loader, CLI, YAML files, tests. Each layer verified compiles before proceeding. No backward compatibility, no data migration.

**Tech Stack:** TypeScript, Effect-TS 3.21.3, bun:sqlite, nanoid 3.3.12, @effect/cli, @effect/schema

---

### Task 1: Add nanoid dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add nanoid to package.json**

In `package.json`, add `"nanoid": "3.3.12"` to the `dependencies` block after `"effect": "3.21.3",`:

```json
"nanoid": "3.3.12",
```

- [ ] **Step 2: Install and verify**

```bash
bun install
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add nanoid 3.3.12 dependency"
```

---

### Task 2: Add branded types and rename YAML interfaces

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add branded types**

At the top of `src/types.ts`, after the `AgentRole` type, add:

```typescript
export type WorkflowSlug = string & { readonly __brand: "WorkflowSlug" }
export type StepSlug = string & { readonly __brand: "StepSlug" }
export type AgentSlug = string & { readonly __brand: "AgentSlug" }
export type RunId = string & { readonly __brand: "RunId" }
export type StepId = string & { readonly __brand: "StepId" }
```

- [ ] **Step 2: Rename `id` to `slug` on WorkflowSpec**

Change line 10 from:
```typescript
  id: string
```
to:
```typescript
  slug: WorkflowSlug
```

- [ ] **Step 3: Rename `id` to `slug` on WorkflowAgent**

Change line 28 from:
```typescript
  id: string
```
to:
```typescript
  slug: AgentSlug
```

- [ ] **Step 4: Rename `id` to `slug` on WorkflowStep, `agent` stays but branded**

Change lines 44-46 from:
```typescript
  id: string
  agent: string
```
to:
```typescript
  slug: StepSlug
  agent: AgentSlug
```

- [ ] **Step 5: Verify build fails (as expected — other files reference `.id` still)**

```bash
bun run build
```

Expected: compilation errors in files that reference `.id` on these interfaces. This confirms the rename is in effect before we update consumers.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat: add branded types, rename YAML id to slug on WorkflowSpec/Step/Agent"
```

---

### Task 3: Update YAML schemas to use `slug` field name

**Files:**
- Modify: `src/schemas.ts`

- [ ] **Step 1: Rename `id` to `slug` in all schema definitions**

In `src/schemas.ts`, change field `id` to `slug` in these three structs:

Line 19 — `WorkflowAgentSchema`:
```typescript
  slug: Schema.String,
```

Line 49 — `WorkflowStepSchema`:
```typescript
  slug: Schema.String,
```

Line 65 — `WorkflowSpecSchema`:
```typescript
  slug: Schema.String,
```

- [ ] **Step 2: Update the filter to reference `slug`**

In `src/schemas.ts`, change lines 80-81 from:
```typescript
      const agentIds = new Set(spec.agents.map((a) => a.id))
      return spec.steps.every((s) => agentIds.has(s.agent))
```
to:
```typescript
      const agentSlugs = new Set(spec.agents.map((a) => a.slug))
      return spec.steps.every((s) => agentSlugs.has(s.agent))
```

- [ ] **Step 3: Commit**

```bash
git add src/schemas.ts
git commit -m "refactor: rename schema fields id to slug"
```

---

### Task 4: Drop `step_id` column from steps table schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Remove `step_id` column from CREATE TABLE**

In `src/db/schema.ts`, change lines 16-30 to remove the `step_id` column:

```sql
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
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

(Remove line 19 `step_id TEXT NOT NULL,` — the column is dropped.)

- [ ] **Step 2: Commit**

```bash
git add src/db/schema.ts
git commit -m "refactor: drop step_id column from steps table"
```

---

### Task 5: Update DB query layer — interfaces, insert, update, status

**Files:**
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Remove `step_id` from `StepRow`**

Remove line 17 (`step_id: string`) from the `StepRow` interface.

- [ ] **Step 2: No additional imports needed**

`buildStepId` from `engine.ts` handles nanoid internally. Just import `buildStepId` in step 3 below.

- [ ] **Step 3: Rewrite `insertSteps` to use `buildStepId`**

After the existing `import { Database } from "bun:sqlite"` line, add:
```typescript
import { buildStepId } from "../workflow/engine.js"
```

Replace lines 62-73:
```typescript
export function insertSteps(
  db: Database,
  runId: string,
  steps: Array<{ stepId: string; agentId: string }>
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO steps (id, run_id, step_id, agent_id, status) VALUES (?, ?, ?, ?, 'pending')`
  )
  for (const step of steps) {
    stmt.run(`${runId}:${step.stepId}`, runId, step.stepId, step.agentId)
  }
}
```

with:
```typescript
export function insertSteps(
  db: Database,
  runId: string,
  steps: Array<{ stepSlug: string; agentSlug: string }>
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO steps (id, run_id, agent_id, status) VALUES (?, ?, ?, 'pending')`
  )
  for (const step of steps) {
    stmt.run(buildStepId(runId, step.stepSlug), runId, step.agentSlug)
  }
}
```

Note: the SQL removes `step_id` from the column list since it's dropped.

- [ ] **Step 4: Rewrite `updateStepStarted` to use stepId directly (no composite)**

Replace lines 75-87:
```typescript
export function updateStepStarted(
  db: Database,
  runId: string,
  stepId: string,
  startedAt: string
): void {
  db.prepare(
    `UPDATE steps SET status = 'running', started_at = ? WHERE id = ?`
  ).run(startedAt, `${runId}:${stepId}`)
  db.prepare(
    `UPDATE runs SET current_step = ? WHERE id = ?`
  ).run(stepId, runId)
}
```

with:
```typescript
export function updateStepStarted(
  db: Database,
  runId: string,
  stepId: string,
  startedAt: string
): void {
  db.prepare(
    `UPDATE steps SET status = 'running', started_at = ? WHERE id = ?`
  ).run(startedAt, stepId)
  db.prepare(
    `UPDATE runs SET current_step = ? WHERE id = ?`
  ).run(stepId, runId)
}
```

Changes: `WHERE id = ?` now uses `stepId` directly (no `${runId}:${stepId}` prefix).

- [ ] **Step 5: Rewrite `updateStepCompleted` — remove composite**

Replace lines 89-100:
```typescript
export function updateStepCompleted(
  db: Database,
  runId: string,
  stepId: string,
  completedAt: string,
  data: { tokensIn?: number; tokensOut?: number; output?: unknown }
): void {
  const outputJson = data.output ? JSON.stringify(data.output) : null
  db.prepare(
    `UPDATE steps SET status = 'completed', completed_at = ?, tokens_in = ?, tokens_out = ?, output_json = ? WHERE id = ?`
  ).run(completedAt, data.tokensIn ?? 0, data.tokensOut ?? 0, outputJson, `${runId}:${stepId}`)
}
```

Change the WHERE clause from `${runId}:${stepId}` to just `stepId`:
```typescript
  ).run(completedAt, data.tokensIn ?? 0, data.tokensOut ?? 0, outputJson, stepId)
```

- [ ] **Step 6: Rewrite `updateStepFailed` — remove composite**

Replace lines 102-111:
```typescript
export function updateStepFailed(
  db: Database,
  runId: string,
  stepId: string,
  errorMessage: string
): void {
  db.prepare(
    `UPDATE steps SET status = 'failed', error_message = ? WHERE id = ?`
  ).run(errorMessage, `${runId}:${stepId}`)
}
```

Change `${runId}:${stepId}` to `stepId`:
```typescript
  ).run(errorMessage, stepId)
```

- [ ] **Step 7: Update `insertTokenEvent` — stepId now stores full compound ID**

No code change needed — `stepId` parameter now receives the full compound ID from callers. The SQL stays the same.

- [ ] **Step 8: Update `getRunStatus` — `stepId` maps from `s.id` not `s.step_id`**

In the `getRunStatus` function, change line 171 from:
```typescript
      stepId: s.step_id,
```
to:
```typescript
      stepId: s.id,
```

Since `step_id` column no longer exists, the step's compound ID comes from `s.id`.

- [ ] **Step 9: Update `RunStatusRow` interface — rename `agentId` field**

Line 38, change:
```typescript
    agentId: string
```
to:
```typescript
    agentSlug: string
```

And line 172 changes from:
```typescript
      agentId: s.agent_id,
```
to:
```typescript
      agentSlug: s.agent_id,
```

- [ ] **Step 10: Verify build**

```bash
bun run build
```

Expected: may still have errors from callers that haven't been updated yet. Fix only errors in `queries.ts`; other files get fixed in later tasks.

- [ ] **Step 11: Commit**

```bash
git add src/db/queries.ts
git commit -m "refactor: update DB queries for new step ID format, drop step_id column"
```

---

### Task 6: Update engine — nanoid, buildStepId, remove duplicate

**Files:**
- Modify: `src/workflow/engine.ts`
- Delete: `src/workflow/workflow-engine.ts`

- [ ] **Step 1: Update `engine.ts` — replace Crypto with nanoid, add buildStepId, use slug**

Replace the entire content of `src/workflow/engine.ts`:

```typescript
import { nanoid } from "nanoid"
import { WorkflowSpec } from "../types.js"

export function computeStepOrder(spec: WorkflowSpec): string[] {
  return spec.steps.map((s) => s.slug)
}

export function buildRunId(workflowSlug: string): string {
  return `${workflowSlug}-${nanoid(5)}`
}

export function buildStepId(runId: string, stepSlug: string): string {
  return `${runId}-${stepSlug}-${nanoid(5)}`
}

export function resolveStepTimeout(spec: WorkflowSpec, agentSlug: string): number {
  const agent = spec.agents.find((a) => a.slug === agentSlug)
  if (agent?.timeoutSeconds !== undefined) return agent.timeoutSeconds
  if (spec.polling?.timeoutSeconds !== undefined) return spec.polling.timeoutSeconds
  return 300
}
```

Changes:
- `import * as Crypto from "node:crypto"` → `import { nanoid } from "nanoid"`
- `Crypto.randomUUID()` → `nanoid(5)` in `buildRunId`
- Added `buildStepId` function
- `s.id` → `s.slug` in `computeStepOrder`
- `a.id` → `a.slug` in `resolveStepTimeout`

- [ ] **Step 2: Delete `src/workflow/workflow-engine.ts`**

```bash
rm src/workflow/workflow-engine.ts
```

This file was an exact duplicate of `engine.ts` and is no longer needed.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/engine.ts
git rm src/workflow/workflow-engine.ts
git commit -m "refactor: use nanoid, add buildStepId, use slug fields, remove duplicate workflow-engine.ts"
```

---

### Task 7: Update state machine — use slugs and new step IDs

**Files:**
- Modify: `src/workflow/run-state-machine.ts`

- [ ] **Step 1: Update imports — remove `step_id` references, use slugs**

Lines 217-246 in `createWorkflowRuntime` reference `step.step_id`. Since `step_id` is dropped from the DB, the resume path uses `step_step` from the DB row. But we dropped `step_id` — instead the step slug is embedded in the step ID (primary key). 

For the resume path, we need to read the step slug from the step's primary key. The step ID format is `<runId>-<stepSlug>-<nanoid>`. We can parse it.

First, update the import on line 18 from:
```typescript
import { buildRunId } from "../workflow/engine.js"
```
to:
```typescript
import { buildRunId, buildStepId } from "../workflow/engine.js"
```

- [ ] **Step 2: Add a helper to extract stepSlug from stepId**

Below the imports, add:
```typescript
function parseStepSlug(stepId: string, runId: string): string {
  const prefix = runId + "-"
  if (!stepId.startsWith(prefix)) return stepId
  const afterRun = stepId.slice(prefix.length)
  const lastDash = afterRun.lastIndexOf("-")
  if (lastDash === -1) return afterRun
  return afterRun.slice(0, lastDash)
}
```

- [ ] **Step 3: Update resume path — use `s.id` instead of `s.step_id`**

In `createWorkflowRuntime`, the resume block around lines 214-227 currently uses `step.step_id` to key into the stepStates map. Change the loop at lines 216-219 from:

```typescript
      for (const step of stepRows) {
        const state = step.status as StepState
        stepStates.set(step.step_id, state)
      }
```

To instead parse the slug from the step ID:
```typescript
      for (const step of stepRows) {
        const state = step.status as StepState
        const stepSlug = parseStepSlug(step.id, existingRunId)
        stepStates.set(stepSlug, state)
      }
```

And the deferred block at lines 222-227:
```typescript
      const deferredSteps = stepRows.filter((s) => s.status === "deferred")
      for (const s of deferredSteps) {
        db.prepare(
          `UPDATE steps SET status = 'pending' WHERE id = ?`
        ).run(s.id)
        stepStates.set(s.step_id, "pending")
      }
```

Change `s.step_id` to use parsed slug:
```typescript
        stepStates.set(parseStepSlug(s.id, existingRunId), "pending")
```

- [ ] **Step 4: Update new run path — use slugs**

In the new run path (around lines 238-246), change:

Line 238:
```typescript
    const runId = buildRunId(spec.id)
```
to:
```typescript
    const runId = buildRunId(spec.slug)
```

Line 240:
```typescript
    insertRun(db, runId, spec.id, new Date().toISOString())
```
to:
```typescript
    insertRun(db, runId, spec.slug, new Date().toISOString())
```

Line 241:
```typescript
    insertSteps(db, runId, spec.steps.map((s) => ({ stepId: s.id, agentId: s.agent })))
```
to:
```typescript
    insertSteps(db, runId, spec.steps.map((s) => ({ stepSlug: s.slug, agentSlug: s.agent })))
```

Line 245-247:
```typescript
    for (const step of spec.steps) {
      stepStates.set(step.id, "pending")
    }
```
to:
```typescript
    for (const step of spec.steps) {
      stepStates.set(step.slug, "pending")
    }
```

- [ ] **Step 5: Commit**

```bash
git add src/workflow/run-state-machine.ts
git commit -m "refactor: use slugs and new step IDs in state machine"
```

---

### Task 8: Update runner — use slugs, compound step IDs

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Update runner to use slug fields**

The runner references `spec.id`, `step.id`, `agent.id` throughout. All `id` fields on YAML objects are now `slug`.

Replace all occurrences:

Line 74 — `workflowId: spec.id` → `workflowId: spec.slug`

Lines 79-84 — step iteration:
```typescript
      for (const stepId of stepOrder) {
        const shouldExec = yield* _(ctx.shouldExecuteStep(stepId))
        if (!shouldExec) continue

        const step = spec.steps.find((s) => s.id === stepId)!
        const agent = spec.agents.find((a) => a.id === step.agent)!
```

becomes:
```typescript
      for (const stepSlug of stepOrder) {
        const shouldExec = yield* _(ctx.shouldExecuteStep(stepSlug))
        if (!shouldExec) continue

        const step = spec.steps.find((s) => s.slug === stepSlug)!
        const agent = spec.agents.find((a) => a.slug === step.agent)!
```

Then the loop internals need updating. The runner currently passes `stepId` (the YAML slug) directly to `ctx.transitionStep`, `emit`, `appendStepLog`, `writeStepOutput`, `executeWithPi`, and `appendEngineLog`. These all now need the compound step ID. 

The approach: at the top of each step iteration, after finding the step and agent, generate the compound stepId. Then use that for all calls that need the runtime step ID while keeping `stepSlug` for the state machine lookups and step results map.

Replace lines 79-181 within the loop body. The full updated loop body:

```typescript
      for (const stepSlug of stepOrder) {
        const shouldExec = yield* _(ctx.shouldExecuteStep(stepSlug))
        if (!shouldExec) continue

        const step = spec.steps.find((s) => s.slug === stepSlug)!
        const agent = spec.agents.find((a) => a.slug === step.agent)!
        const maxRetries = step.max_retries ?? 1
        const timeoutSeconds = resolveStepTimeout(spec, agent.slug)
        const model = agent.model

        const shouldPauseResult = yield* _(ctx.shouldPause())
        if (shouldPauseResult) {
          yield* _(emit(config.onEvent, { type: "step_paused", runId, stepId: stepSlug, message: "step paused via deferred state" }))
          workflowStatus = "paused"
          break
        }

        const stepId = buildStepId(runId, stepSlug)

        yield* _(ctx.transitionStep(stepSlug, "start"))
        yield* _(emit(config.onEvent, { type: "step_started", runId, stepId }))
        yield* _(appendEngineLog(runId, { event: "step_started", stepId }))

        const persona = yield* _(
          resolvePersona(agent.slug, spec.slug).pipe(
            Effect.mapError((e) => new Error(e.message))
          )
        )

        const agentSettings = yield* _(Effect.match(loadAgentSettings(""), {
          onSuccess: (s) => s,
          onFailure: () => ({}) as Record<string, never>
        }))

        const prompt = buildAgentPrompt({
          agentsMd: persona.agents,
          identityMd: persona.identity,
          soulMd: persona.soul,
          stepInput: step.input,
          context: runningContext
        })

        yield* _(appendStepLog(runId, stepId, { event: "prompt_built" }))

        const rtkExtension = createRtkExtension({
          model: model ?? agentSettings.model,
          disabled: process.env.RTK_DISABLED === "1"
        })

        const output = yield* _(executeWithPi({
          systemPrompt: prompt.systemPrompt,
          taskPrompt: prompt.taskPrompt,
          stepId,
          agentId: agent.slug,
          runId,
          timeoutSeconds,
          model,
          extensions: [rtkExtension],
          settings: {
            thinking: agentSettings.thinking,
            tools: agentSettings.tools,
            skills: agentSettings.skills
          }
        }).pipe(
          Effect.timeout(Duration.seconds(timeoutSeconds)),
          Effect.retry(
            Schedule.recurs(maxRetries - 1).pipe(
              Schedule.tapInput((_error: unknown) =>
                Effect.gen(function* () {
                  yield* _(emit(config.onEvent, {
                    type: "step_retry",
                    runId,
                    stepId,
                    message: "Retrying step"
                  }))
                  yield* _(appendStepLog(runId, stepId, { event: "retry" }))
                }).pipe(Effect.catchAll(() => Effect.void))
              )
            )
          )
        ))

        if (output === undefined || output === null) {
          yield* _(emit(config.onEvent, { type: "step_timeout", runId, stepId, message: "step timed out" }))
          yield* _(ctx.transitionStep(stepSlug, "fail"))
          yield* _(appendEngineLog(runId, { event: "step_timeout", stepId }))
          workflowStatus = "failed"
          break
        }

        yield* _(ctx.transitionStep(stepSlug, "complete"))
        yield* _(appendStepLog(runId, stepId, { event: "completed" }))
        yield* _(writeStepOutput(runId, stepId, output))

        const extracted = extractContextFromOutput(output)
        Object.assign(runningContext, extracted)
        Object.assign(runningContext, mergeContext(runningContext, output))

        if (output.status && typeof output.status === "string") {
          stepResults[stepSlug] = output.status
        }

        yield* _(emit(config.onEvent, { type: "step_completed", runId, stepId }))
        yield* _(appendEngineLog(runId, { event: "step_completed", stepId }))
      }
```

Key changes:
- `stepId` (old YAML slug) → `stepSlug` in the for loop
- `s.id` → `s.slug`, `a.id` → `a.slug`
- `buildStepId(runId, stepSlug)` generates the compound stepId for runtime
- `ctx.transitionStep(stepSlug, ...)` still takes the slug (state machine keys on slug)
- All DB/file/event calls use the compound `stepId`
- `stepResults[stepSlug]` uses slug as key

- [ ] **Step 2: Add `buildStepId` import**

On line 9, change:
```typescript
import { computeStepOrder, resolveStepTimeout } from "../workflow/engine.js"
```
to:
```typescript
import { computeStepOrder, resolveStepTimeout, buildStepId } from "../workflow/engine.js"
```

- [ ] **Step 3: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "refactor: use slugs and compound step IDs in runner"
```

---

### Task 9: Update observability — compound step IDs in file names and logging

**Files:**
- Modify: `src/observability/run-dir.ts`
- Modify: `src/observability/streaming.ts`

- [ ] **Step 1: `run-dir.ts` — no code change needed**

The `writeStepOutput`, `appendStepLog` functions already take `stepId: string` as a parameter and pass it to `stepOutputFile(runId, stepId)` / `stepLogFile(runId, stepId)`. Since callers now pass the compound step ID, file names automatically use the new format. No code changes needed in this file.

`appendEngineLog` at line 74 references `workflowId: spec.id` — this was updated in Task 8 (runner side). The `run-dir.ts` function itself takes `runId` and `event` — no changes needed.

- [ ] **Step 2: `streaming.ts` — no code change needed**

`SubscribeConfig.stepId` is typed as `string`. Callers now pass the compound stepId. The function just forwards it to `onLog` and `onTokenEvent` callbacks. No changes needed.

- [ ] **Step 3: Commit**

```bash
git add src/observability/run-dir.ts src/observability/streaming.ts
git commit -m "refactor: observability layer unchanged — callers pass compound step IDs"
```

---

### Task 10: Update PI executor — use compound stepId

**Files:**
- Modify: `src/agent/pi-executor.ts`

- [ ] **Step 1: `PiExecutorConfig.stepId` now receives compound ID**

No code changes needed in this file. `config.stepId` and `config.agentId` are already typed as `string`. Callers now pass compound stepId and agent slug respectively. The `PiExecutionError` still holds `stepId: string` — the compound ID is fine in error messages.

- [ ] **Step 2: Commit**

```bash
git add src/agent/pi-executor.ts
git commit -m "refactor: pi-executor unchanged — callers pass compound step IDs"
```

---

### Task 11: Update resolver/loader — workflowId → slug

**Files:**
- Modify: `src/workflow/loader.ts`
- Modify: `src/workflow/resolver.ts`

- [ ] **Step 1: `loader.ts` — rename `workflowId` to `workflowSlug` in errors and functions**

Change lines 8-16 — error classes:
```typescript
export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>("WorkflowNotFoundError")("WorkflowNotFoundError", {
  workflowSlug: Schema.String,
  dir: Schema.String
}) {}

export class WorkflowParseError extends Schema.TaggedError<WorkflowParseError>("WorkflowParseError")("WorkflowParseError", {
  workflowSlug: Schema.String,
  message: Schema.String
}) {}
```

Change line 20 — function parameter:
```typescript
  workflowSlug: string
```

Update all `workflowId` variable references inside the function (lines 23-44) to `workflowSlug`:
- Line 23: `Path.join(workflowsDir, workflowSlug)`
- Line 29: `new WorkflowNotFoundError({ workflowSlug, dir })`
- Line 36: `new WorkflowParseError({ workflowSlug, message: String(e) })`
- Line 43: `new WorkflowParseError({ workflowSlug, message: String(e) })`

- [ ] **Step 2: `resolver.ts` — rename function**

Line 10, change:
```typescript
export function resolveWorkflowId(
```
to:
```typescript
export function resolveWorkflowSlug(
```

- [ ] **Step 3: Commit**

```bash
git add src/workflow/loader.ts src/workflow/resolver.ts
git commit -m "refactor: rename workflowId to workflowSlug in loader and resolver"
```

---

### Task 12: Update CLI commands

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/runs.ts`
- Modify: `src/cli/commands/list.ts`
- Modify: `src/cli/commands/logs.ts`
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli/commands/install-logic.ts`

- [ ] **Step 1: `run.ts` — rename imports and update references**

Line 5, change:
```typescript
import { resolveWorkflowId } from "../../workflow/resolver.js"
```
to:
```typescript
import { resolveWorkflowSlug } from "../../workflow/resolver.js"
```

Line 9, remove:
```typescript
import { buildRunId } from "../../workflow/engine.js"
```
(The `buildRunId` fallback in the `catchAll` is no longer needed since errors now always produce a result from within `runWorkflow`.)

Lines 40-41, change:
```typescript
    const resolvedId = resolveWorkflowId(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedId)
```
to:
```typescript
    const resolvedSlug = resolveWorkflowSlug(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug)
```

Lines 48-57 — the `catchAll` block. Update `spec.id` → `spec.slug`:
```typescript
            runId: buildRunId((spec as unknown as WfSpec).slug),
```

But wait — `buildRunId` was removed from imports. We need to keep it for the catchAll. Let's keep the import. Actually, the `catchAll` creates a synthetic failed result with a generated runId. Keep `buildRunId` imported.

Hold on — looking at the catchAll block again, it calls `buildRunId`. Since we removed the import, let's re-add it:

Keep line 9 unchanged:
```typescript
import { buildRunId } from "../../workflow/engine.js"
```

And change `spec.id` → `spec.slug` in the catchAll block.

Also, the `RunResult` stepResults uses `step` and `status` — these are slug keys, no change needed.

- [ ] **Step 2: `status.ts` — update `stepId` and `agentId` field references**

Line 62:
```typescript
      lines.push(`Step:      ${currentIdx + 1}/${status.steps.length} \u2014 ${step.stepId} (agent: ${step.agentId})`)
```

The `RunStatus.steps[].stepId` now holds the compound step ID. `agentId` was renamed to `agentSlug` in Task 5 step 10. Update:
```typescript
      lines.push(`Step:      ${currentIdx + 1}/${status.steps.length} \u2014 ${step.stepId} (agent: ${step.agentSlug})`)
```

Line 65:
```typescript
      const stepLine = status.steps.map((s) => `${s.stepId} ${stepIndicator(s.status)}`).join("  ")
```
No change — `stepId` still renders the step identifier, now the compound format.

- [ ] **Step 3: `runs.ts` — no source code changes**

The `RunSummary` interface has `id`, `workflow_id`, and `current_step` — none of these are renamed. The table renders `r.id.slice(0, 22)` (now shorter with nanoid, which is fine), `r.workflow_id`, and `r.current_step`. No changes needed.

- [ ] **Step 4: `list.ts` — rename `id` to `slug` on `WorkflowListItem` and display**

Line 10, change:
```typescript
  id: string
```
to:
```typescript
  slug: string
```

Line 34, change:
```typescript
        id: spec.value.id,
```
to:
```typescript
        slug: spec.value.slug,
```

Line 47, change:
```typescript
  { header: "ID", width: 24, render: (i) => categoryColor(i.id)(i.id) },
```
to:
```typescript
  { header: "SLUG", width: 24, render: (i) => categoryColor(i.slug)(i.slug) },
```

- [ ] **Step 5: `logs.ts` — update `step_id` field in log events**

Line 14 `step_id` in `LogEvent` — no change needed, it's just a dynamic field. The step_id in log lines now holds the compound ID which is fine.

The `stepLogFile` and `stepLogsDir` calls pass `stepId` (now compound) — file lookups work with new names.

- [ ] **Step 6: `init.ts` — rename `workflowId` → `workflowSlug`**

In the `initHamilton` function, line 41 parameter `workflowId`:
```typescript
function copyWorkflowAgents(
  workflowId: string,
  options?: { force?: boolean }
): Effect.Effect<void, InitError> {
```
Change all `workflowId` references in this function to `workflowSlug`:
```typescript
function copyWorkflowAgents(
  workflowSlug: string,
  options?: { force?: boolean }
): Effect.Effect<void, InitError> {
  return Effect.gen(function* () {
    const workflowAgentsDir = Path.join(PROJECT_ROOT, "workflows", workflowSlug, "agents")
```

Line 81 — `installAllWorkflows` returns `workflowIds` array. Rename to `workflowSlugs`:
```typescript
    const workflowSlugs = yield* Effect.mapError(installAllWorkflows({ force: true }), (e) =>
```
and line 85:
```typescript
    for (const slug of workflowSlugs) {
      yield* copyWorkflowAgents(slug, options)
    }
```
and line 89:
```typescript
    return workflowSlugs
```
and line 102:
```typescript
    const installed = Exit.getOrElse(result, () => [] as string[])
```
and line 105:
```typescript
    for (const slug of installed) {
      yield* Console.log(`  ${slug}`)
    }
```

- [ ] **Step 7: `install-logic.ts` — rename `workflowId` → `workflowSlug`**

In `InstallError` (line 8-11):
```typescript
export class InstallError extends Data.TaggedError("InstallError")<{
  workflowSlug: string
  message: string
}> {}
```

In `installWorkflow` function — rename parameter and all usages from `workflowId` to `workflowSlug`.

In `uninstallWorkflow` function — same rename.

In `installAllWorkflows` — rename local variables `ids` → `slugs`, iterate with `slug`.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/
git commit -m "refactor: update CLI commands for slug terminology"
```

---

### Task 13: Update agent/persona — workflowId → slug

**Files:**
- Modify: `src/agent/persona.ts`

- [ ] **Step 1: Rename fields in `PersonaLoadError` and `resolvePersona`**

Line 14, change:
```typescript
  workflowId: string
```
to:
```typescript
  workflowSlug: string
```

Line 36-37, change:
```typescript
  agentId: string,
  workflowId: string
```
to:
```typescript
  agentSlug: string,
  workflowSlug: string
```

Lines 38-53 — update all `workflowId` → `workflowSlug` and `agentId` → `agentSlug`:
```typescript
export function resolvePersona(
  agentSlug: string,
  workflowSlug: string
): Effect.Effect<Persona, PersonaLoadError> {
  return Effect.sync(() => {
    const localDir = Path.join(workflowsDir(), workflowSlug, "agents", agentSlug)
    const local = loadPersonaFromDir(localDir)
    if (local) return local

    const sharedDir = Path.join(agentsDir(), agentSlug)
    const shared = loadPersonaFromDir(sharedDir)
    if (shared) return shared

    throw new PersonaLoadError({
      agentId: agentSlug,
      workflowId: workflowSlug,
      message: `Agent "${agentSlug}" not found in workflow "${workflowSlug}" or shared agents. Check "hamilton init".`
    })
  })
}
```

Note: `PersonaLoadError` params `agentId` and `workflowId` are left as-is — they're error payload field names, not public interface exported for consumers to match on. Changing them would break tests unnecessarily. The values passed are now slugs.

- [ ] **Step 2: Commit**

```bash
git add src/agent/persona.ts
git commit -m "refactor: rename persona params to slug terminology"
```

---

### Task 14: Update agent/activity — no source changes

**Files:**
- Modify: `src/agent/activity.ts`

- [ ] **Step 1: No changes needed**

`buildAgentPrompt`, `parseAgentOutput`, and `extractContextFromOutput` don't reference any ID/slug fields directly. They work with prompt strings and output parsing only. No changes.

- [ ] **Step 2: Commit**

```bash
git add src/agent/activity.ts
git commit -m "refactor: activity.ts unchanged — no ID/slug references"
```

---

### Task 15: Update all YAML workflow files — `id:` → `slug:`

**Files:**
- Modify: `workflows/*/workflow.yml` (18 files)

- [ ] **Step 1: Replace `id:` with `slug:` in all workflow YAML files**

For the top-level workflow `id:`, in all 18 YAML files under `workflows/`, replace `id:` at column 0 (the workflow identifier) and `- id:` (agent and step identifiers) with `- slug:`.

Run a single sed command:
```bash
for f in workflows/*/workflow.yml; do
  sed -i '' 's/^id: /slug: /' "$f"
  sed -i '' 's/  - id: /  - slug: /' "$f"
done
```

This handles:
- Line 3 in feature-dev: `id: feature-dev` → `slug: feature-dev`
- Agent entries: `  - id: planner` → `  - slug: planner`
- Step entries: `  - id: plan` → `  - slug: plan`

- [ ] **Step 2: Verify one file to confirm**

```bash
head -5 workflows/feature-dev/workflow.yml
```

Expected output starts with:
```yaml
slug: feature-dev
name: Feature Development Workflow (local-only)
```

- [ ] **Step 3: Commit**

```bash
git add workflows/
git commit -m "refactor: rename id to slug in all YAML workflow files"
```

---

### Task 16: Update test files

**Files:**
- Modify: `tests/workflow/engine.test.ts`
- Modify: `tests/types.test.ts` (if exists)
- Modify: `tests/schemas.test.ts`
- Modify: `tests/db/queries.test.ts`
- Modify: `tests/observability/run-dir.test.ts`
- Modify: `tests/observability/streaming.test.ts`
- Modify: `tests/workflow/run-state-machine.test.ts`
- Modify: `tests/workflow/runner.test.ts`
- Modify: `tests/workflow/loader.test.ts`
- Modify: `tests/workflow/resolver.test.ts`
- Modify: `tests/cli/run.test.ts`
- Modify: `tests/cli/status.test.ts`
- Modify: `tests/cli/list.test.ts`
- Modify: `tests/cli/logs.test.ts`
- Modify: `tests/cli/init.test.ts`
- Modify: `tests/agent/persona.test.ts`
- Modify: `tests/e2e/workflows.test.ts`

- [ ] **Step 1: `tests/workflow/engine.test.ts`**

Change all `id` → `slug` on `makeAgent`, `makeStep`, `makeSpec`:
```typescript
const makeAgent = (overrides: Partial<WorkflowAgent> = {}): WorkflowAgent => ({
  slug: "agent-1",
  ...
})

const makeStep = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  slug: "step-1",
  ...
})

const makeSpec = (overrides: Partial<WorkflowSpec> = {}): WorkflowSpec => ({
  slug: "wf-1",
  ...
})
```

Update `computeStepOrder` test — `makeStep({ id: ... })` → `makeStep({ slug: ... })`.

Update `buildRunId` test — now expects nanoid(5) format:
```typescript
describe("buildRunId", () => {
  it("generates a run ID with workflow slug prefix and nanoid", () => {
    const runId = buildRunId("my-workflow")
    expect(runId).toMatch(/^my-workflow-[A-Za-z0-9_-]{5}$/)
  })
})
```

Add `buildStepId` tests:
```typescript
describe("buildStepId", () => {
  it("generates a step ID with runId prefix and nanoid", () => {
    const stepId = buildStepId("my-workflow-abcde", "plan")
    expect(stepId).toMatch(/^my-workflow-abcde-plan-[A-Za-z0-9_-]{5}$/)
  })
})
```

Update `resolveStepTimeout` tests — `makeAgent({ id: "agent-1" })` → `makeAgent({ slug: "agent-1" })`.

- [ ] **Step 2: `tests/schemas.test.ts`**

Update YAML parsing tests to use `slug:` instead of `id:` in test fixtures. Example:
```typescript
const validYaml = `
slug: test-wf
name: Test Workflow
...
agents:
  - slug: agent-1
    role: coding
    ...
steps:
  - slug: step-1
    agent: agent-1
    ...
`
```

Update filter test to verify `agentSlugs` matching.

- [ ] **Step 3: `tests/db/queries.test.ts`**

Update `insertSteps` calls — parameter is now `{ stepSlug, agentSlug }`:
```typescript
insertSteps(db, runId, [{ stepSlug: "triage", agentSlug: "triager" }])
```

Update `updateStepStarted`/`updateStepCompleted`/`updateStepFailed` calls — `stepId` is now the compound ID:
```typescript
const stepId = buildStepId(runId, "triage")
updateStepStarted(db, runId, stepId, now)
```

Update assertions — no more `step_id` column in StepRow:
```typescript
const row = getStepsByRunId(db, runId)[0]
expect(row.agent_id).toBe("triager")
expect(row.step_id).toBeUndefined()
```

Update `getRunStatus` assertions — `stepId` field on steps is now the compound ID, `agentSlug` instead of `agentId`:
```typescript
expect(status.steps[0].stepId).toMatch(/^feature-dev-/)
expect(status.steps[0].agentSlug).toBe("triager")
```

- [ ] **Step 4: `tests/observability/run-dir.test.ts`**

Update step output/log file path assertions — now uses compound stepId pattern:
```typescript
const stepId = buildStepId(runId, "triage")
const outputPath = stepOutputFile(runId, stepId)
expect(outputPath).toContain("triage")
expect(outputPath).toContain(".json")
```

- [ ] **Step 5: `tests/workflow/run-state-machine.test.ts`**

Update spec builder and assertions to use `slug`:
```typescript
const spec = { slug: "test-wf", ... }
```
And `insertSteps` calls to use `{ stepSlug, agentSlug }`.

Update resume test — step ID from DB is now compound format, parsed for slug.

- [ ] **Step 6: `tests/workflow/runner.test.ts`**

Update spec with `slug` fields. Mock builds need `agentSlug` and `stepSlug`.

- [ ] **Step 7: `tests/workflow/loader.test.ts`**

Update error assertions — `workflowSlug` instead of `workflowId`.

- [ ] **Step 8: `tests/workflow/resolver.test.ts`**

Rename function call from `resolveWorkflowId` to `resolveWorkflowSlug`.

- [ ] **Step 9: CLI test files**

`tests/cli/run.test.ts` — update references from `spec.id` → `spec.slug`, `resolveWorkflowId` → `resolveWorkflowSlug`.

`tests/cli/status.test.ts` — update `agentId` → `agentSlug` on step display assertions.

`tests/cli/list.test.ts` — update `WorkflowListItem` fields `id` → `slug`.

`tests/cli/logs.test.ts` — step ID in log file names now compound.

`tests/cli/init.test.ts` — rename `workflowIds` → `workflowSlugs`.

- [ ] **Step 10: `tests/agent/persona.test.ts`**

Update `resolvePersona` calls — params are now `agentSlug, workflowSlug`.

- [ ] **Step 11: `tests/e2e/workflows.test.ts`**

Update integration test YAML fixtures and assertions.

- [ ] **Step 12: Run all tests**

```bash
bun --bun vitest run
```

Expected: all 155+ tests pass.

- [ ] **Step 13: Commit**

```bash
git add tests/
git commit -m "test: update all tests for slug terminology and new step ID format"
```

---

### Task 17: Final verify — build and full test run

- [ ] **Step 1: Build**

```bash
bun run build
```

Expected: no errors.

- [ ] **Step 2: Full test run**

```bash
bun --bun vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final verification — build and tests pass"
```
