# Recursion and Conditional Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead `retry_step` field and implement recursion via `when` (CEL expressions), `depth` tracking, and `max_recursion_depth` configuration.

**Architecture:** `when` is a universal conditional gate on any task, evaluated before execution via `@marcbachmann/cel-js`. Recursion is a natural consequence of `template` self-reference guarded by `depth` (materialized in DB as `parent.depth + 1`) and a configurable `max_recursion_depth`. The engine never knows about "recursion" — it just gates tasks on conditions and enforces depth.

**Tech Stack:** TypeScript, bun, Effect-TS, `@marcbachmann/cel-js` v7.6.1, SQLite (bun:sqlite)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/cel/evaluate.ts` (new) | CEL expression evaluation with strict path validation |
| `src/types.ts` | Remove `retry_step`, add `when`, add `max_recursion_depth` to `RunConfig` |
| `src/schemas.ts` | Remove `retry_step` from `OnFailureSchema`, add `when` to `WorkflowTaskSchema`, add `max_recursion_depth` to `RunConfigSchema` |
| `src/db/schema.ts` | Migration v6: `parent_task_id` + `depth` columns |
| `src/db/queries.ts` | Update `insertTask`/`insertTasks` for new columns, add `insertTaskWithParent` |
| `src/db/migrations.ts` | Register migration v6 |
| `src/prompts/config.ts` | Add `loadRecursionConfig()` to read `recursion.max_depth` from `settings.yaml` |
| `src/workflow/loader.ts` | Validate `spec.run.max_recursion_depth` is a positive integer |
| `src/workflow/run-state-machine.ts` | `insertDynamicTask` accepts `parentTaskId` and `depth` |
| `src/workflow/runner.ts` | Wire `when` evaluation, depth check, parent tracking during template expansion |
| `src/cli/commands/run.ts` | Load recursion config, pass to runner |
| `src/cli/commands/resume.ts` | Load recursion config, pass to runner |
| `tests/fixtures/feature-dev.yml` | Remove `retry_step` |
| `docs/workflow-yaml.md` | Remove `retry_step`, add `when`, `depth`, `max_recursion_depth` docs |
| `tests/cel/evaluate.test.ts` (new) | Unit tests for CEL evaluation and path validation |
| `tests/workflow/runner-recursion.test.ts` (new) | Integration tests for recursion, when, depth |

---

### Task 1: Remove `retry_step` from schema and types

**Files:**
- Modify: `src/schemas.ts:62-67`
- Modify: `src/types.ts:42-47`

- [ ] **Step 1: Remove `retry_step` from `OnFailureSchema` in `src/schemas.ts`**

```typescript
const OnFailureSchema = Schema.Struct({
  max_retries: Schema.optional(Schema.Number),
  escalate_to: Schema.optional(Schema.String),
  on_exhausted: Schema.optional(OnExhaustedSchema)
})
```

- [ ] **Step 2: Remove `retry_step` from `OnFailure` in `src/types.ts`**

```typescript
export interface OnFailure {
  max_retries?: number
  escalate_to?: string
  on_exhausted?: OnExhausted
}
```

- [ ] **Step 3: Verify build passes**

Run: `bun run build`
Expected: PASS (no type errors related to `retry_step`)

- [ ] **Step 4: Commit**

```bash
git add src/schemas.ts src/types.ts
git commit -m "remove retry_step from schema and types"
```

---

### Task 2: Add `when` and `max_recursion_depth` to schema and types

**Files:**
- Modify: `src/types.ts:87-94` (WorkflowTask)
- Modify: `src/types.ts:6-9` (RunConfig)
- Modify: `src/schemas.ts:120-127` (WorkflowTaskSchema)
- Modify: `src/schemas.ts:129-132` (RunConfigSchema)

- [ ] **Step 1: Add `when` to `WorkflowTask` type in `src/types.ts`**

```typescript
export interface WorkflowTask {
  name: string
  dependencies?: string[]
  agent?: TaskAgent
  template?: string
  arguments?: Arguments
  tasks?: WorkflowTask[]
  when?: string
}
```

- [ ] **Step 2: Add `max_recursion_depth` to `RunConfig` type in `src/types.ts`**

```typescript
export interface RunConfig {
  entrypoint: string
  timeout: string
  max_recursion_depth?: number
}
```

- [ ] **Step 3: Add `when` to `WorkflowTaskSchema` in `src/schemas.ts`**

```typescript
const WorkflowTaskSchema: Schema.Schema<any> = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  agent: Schema.optional(TaskAgentSchema),
  template: Schema.optional(Schema.String),
  arguments: Schema.optional(ArgumentsSchema),
  tasks: Schema.optional(Schema.suspend(() => Schema.Array(WorkflowTaskSchema))),
  when: Schema.optional(Schema.String)
})
```

- [ ] **Step 4: Add `max_recursion_depth` to `RunConfigSchema` in `src/schemas.ts`**

```typescript
const RunConfigSchema = Schema.Struct({
  entrypoint: Schema.String,
  timeout: Schema.String,
  max_recursion_depth: Schema.optional(Schema.Int.pipe(Schema.positive()))
})
```

- [ ] **Step 5: Verify build passes**

Run: `bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/schemas.ts
git commit -m "add when field to WorkflowTask and max_recursion_depth to RunConfig"
```

---

### Task 3: Install `@marcbachmann/cel-js` and create CEL evaluation module

**Files:**
- Modify: `package.json`
- Create: `src/cel/evaluate.ts`
- Create: `tests/cel/evaluate.test.ts`

- [ ] **Step 1: Install dependency**

```bash
bun add @marcbachmann/cel-js@7.6.1
```

- [ ] **Step 2: Write the test for CEL evaluation**

Create `tests/cel/evaluate.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { evaluateWhen, WhenError } from "../../src/cel/evaluate.js"

describe("evaluateWhen", () => {
  const context = {
    inputs: {
      tasks: {
        plan: { outputs: { stories: [{ id: 1 }, { id: 2 }] } },
        test: { outputs: { passed: true } },
        verify: { outputs: { feedback: "" } }
      },
      foo: { bar: "hello" }
    }
  }

  it("returns true for equality check", () => {
    expect(evaluateWhen('inputs.tasks.test.outputs.passed == true', context)).toBe(true)
  })

  it("returns false for inequality check", () => {
    expect(evaluateWhen('inputs.tasks.verify.outputs.feedback != ""', context)).toBe(false)
  })

  it("returns true for inequality when values differ", () => {
    expect(evaluateWhen('inputs.foo.bar != "world"', context)).toBe(true)
  })

  it("supports size() macro on arrays", () => {
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() > 0", context)).toBe(true)
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() > 10", context)).toBe(false)
  })

  it("supports logical AND/OR", () => {
    expect(evaluateWhen("inputs.tasks.test.outputs.passed == true && inputs.tasks.verify.outputs.feedback == \"\"", context)).toBe(true)
    expect(evaluateWhen("inputs.tasks.test.outputs.passed == true || inputs.tasks.verify.outputs.feedback != \"\"", context)).toBe(true)
  })

  it("supports numeric comparison", () => {
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() >= 2", context)).toBe(true)
    expect(evaluateWhen("inputs.tasks.plan.outputs.stories.size() < 1", context)).toBe(false)
  })

  it("returns false for false condition", () => {
    expect(evaluateWhen("false", context)).toBe(false)
  })

  it("fails with WhenError on invalid syntax", () => {
    expect(() => evaluateWhen("inputs.tasks.===", context)).toThrow(WhenError)
  })

  it("fails with WhenError on missing path", () => {
    expect(() => evaluateWhen("inputs.tasks.nonexistent.outputs.x != ''", context)).toThrow(WhenError)
  })

  it("fails with WhenError on partial missing path", () => {
    expect(() => evaluateWhen("inputs.tasks.plan.outputs.nonexistent == 1", context)).toThrow(WhenError)
  })

  it("includes path in error message", () => {
    try {
      evaluateWhen("inputs.tasks.bogus.foo == 1", context)
      expect(false).toBe(true)
    } catch (e) {
      const err = e as WhenError
      expect(err.message).toContain("inputs.tasks.bogus")
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --bun vitest run tests/cel/evaluate.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Implement CEL evaluation module**

Create `src/cel/evaluate.ts`:

```typescript
import { evaluate as celEvaluate } from "@marcbachmann/cel-js"
import { Data } from "effect"

export class WhenError extends Data.TaggedError("WhenError")<{
  message: string
}> {}

function extractPaths(expression: string): string[] {
  const paths: string[] = []
  const regex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\b/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(expression)) !== null) {
    const candidate = match[1]
    if (candidate.startsWith("inputs.") && !candidate.match(/\b(true|false|null|size|has|all|exists|filter|map)\b/)) {
      paths.push(candidate)
    }
  }
  return paths
}

function pathExists(context: Record<string, unknown>, path: string): boolean {
  const segments = path.split(".")
  let current: unknown = context
  for (const seg of segments) {
    if (current === null || current === undefined) return false
    if (typeof current !== "object") return false
    if (!(seg in (current as Record<string, unknown>))) return false
    current = (current as Record<string, unknown>)[seg]
  }
  return true
}

export function evaluateWhen(expression: string, context: { inputs: Record<string, unknown> }): boolean {
  const paths = extractPaths(expression)
  for (const path of paths) {
    if (!pathExists(context, path)) {
      throw new WhenError({ message: `CEL path not found: ${path}` })
    }
  }

  try {
    const result = celEvaluate(expression, context)
    return Boolean(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new WhenError({ message: `CEL evaluation error: ${message}` })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun --bun vitest run tests/cel/evaluate.test.ts`
Expected: PASS (all 11 tests)

- [ ] **Step 6: Verify build passes**

Run: `bun run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/cel/evaluate.ts tests/cel/evaluate.test.ts
git commit -m "add CEL evaluation module with strict path validation"
```

---

### Task 4: Database migration v6 — `parent_task_id` and `depth` columns

**Files:**
- Modify: `src/db/migrations.ts:10-33`
- Modify: `src/db/schema.ts:4-60`
- Modify: `src/db/queries.ts:16-30` (TaskRow), `src/db/queries.ts:90-101` (insertTask), `src/db/queries.ts:77-88` (insertTasks)
- Create: `tests/db/queries-parent-depth.test.ts`

- [ ] **Step 1: Write the migration v6 test**

Create `tests/db/queries-parent-depth.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { Database } from "bun:sqlite"
import { createSchema } from "../../src/db/schema.js"
import { migrate } from "../../src/db/migrations.js"
import { insertTask } from "../../src/db/queries.js"
import { buildTaskId } from "../../src/workflow/engine.js"

function tempDb(): Database {
  const db = new Database(":memory:")
  return db
}

describe("db migration v6 — parent_task_id and depth", () => {
  it("adds parent_task_id and depth columns via migration", () => {
    const db = tempDb()
    migrate(db)

    const info = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>
    const columns = info.map(c => c.name)

    expect(columns).toContain("parent_task_id")
    expect(columns).toContain("depth")
  })

  it("existing rows default to depth 0 and null parent", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-1"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const taskId = buildTaskId(runId, "plan")
    insertTask(db, runId, taskId, "planner", "plan", 0)

    const row = db.prepare("SELECT parent_task_id, depth FROM tasks WHERE id = ?").get(taskId) as { parent_task_id: string | null; depth: number }
    expect(row.parent_task_id).toBeNull()
    expect(row.depth).toBe(0)
  })

  it("can store parent_task_id and depth", () => {
    const db = tempDb()
    migrate(db)

    const runId = "test-run-2"
    db.prepare(`INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(runId, "test", new Date().toISOString())

    const parentId = buildTaskId(runId, "parent")
    insertTask(db, runId, parentId, "parent-agent", "parent", 0)
    db.prepare("UPDATE tasks SET depth = 2 WHERE id = ?").run(parentId)

    const childId = buildTaskId(runId, "child")
    db.prepare(
      `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status, parent_task_id, depth) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(childId, runId, "child-agent", "child", 1, parentId, 3)

    const row = db.prepare("SELECT parent_task_id, depth FROM tasks WHERE id = ?").get(childId) as { parent_task_id: string | null; depth: number }
    expect(row.parent_task_id).toBe(parentId)
    expect(row.depth).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/db/queries-parent-depth.test.ts`
Expected: FAIL (columns don't exist)

- [ ] **Step 3: Add migration v6 to `src/db/migrations.ts`**

```typescript
const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => createSchema(db),
  2: (db) => {
    for (const col of ["model_provider", "model_id"]) {
      try { db.exec("ALTER TABLE tasks ADD COLUMN " + col + " TEXT") }
      catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    }
  },
  3: (db) => {
    db.exec("CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_index INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, stop_reason TEXT, tool_result_count INTEGER DEFAULT 0, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id))")
    db.exec("CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, tool_name TEXT NOT NULL, args_summary TEXT NOT NULL, result_summary TEXT, is_error INTEGER DEFAULT 0, partial_update_count INTEGER DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
    db.exec("CREATE TABLE IF NOT EXISTS provider_requests (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL, turn_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status_code INTEGER, payload_summary TEXT NOT NULL, headers_summary TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, latency_ms INTEGER, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (task_id) REFERENCES tasks(id), FOREIGN KEY (turn_id) REFERENCES turns(id))")
  },
  4: (db) => {
    try { db.exec("ALTER TABLE tasks ADD COLUMN task_name TEXT NOT NULL DEFAULT ''") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    try { db.exec("ALTER TABLE tasks ADD COLUMN execution_index INTEGER NOT NULL DEFAULT 0") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  },
  5: (db) => {
    try { db.exec("ALTER TABLE runs ADD COLUMN pid INTEGER") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  },
  6: (db) => {
    try { db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id)") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
    try { db.exec("ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  }
}
```

- [ ] **Step 4: Update `TaskRow` in `src/db/queries.ts`**

```typescript
export interface TaskRow {
  id: string
  run_id: string
  agent_id: string
  task_name: string
  execution_index: number
  status: string
  started_at: string | null
  completed_at: string | null
  tokens_in: number
  tokens_out: number
  retry_count: number
  error_message: string | null
  output_json: string | null
  parent_task_id: string | null
  depth: number
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --bun vitest run tests/db/queries-parent-depth.test.ts`
Expected: PASS

- [ ] **Step 6: Verify build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations.ts src/db/schema.ts src/db/queries.ts tests/db/queries-parent-depth.test.ts
git commit -m "add migration v6: parent_task_id and depth columns on tasks"
```

---

### Task 5: Add `insertTaskWithParent` query and update `insertDynamicTask`

**Files:**
- Modify: `src/db/queries.ts` (add `insertTaskWithParent`)
- Modify: `src/workflow/run-state-machine.ts:140-148` (`insertDynamicTask`)

- [ ] **Step 1: Add `insertTaskWithParent` to `src/db/queries.ts`**

```typescript
export function insertTaskWithParent(
  db: Database,
  runId: string,
  taskId: string,
  agentName: string,
  taskName: string,
  executionIndex: number,
  parentTaskId: string | null,
  depth: number
): void {
  db.prepare(
    `INSERT OR REPLACE INTO tasks (id, run_id, agent_id, task_name, execution_index, status, parent_task_id, depth) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(taskId, runId, agentName, taskName, executionIndex, parentTaskId, depth)
}
```

- [ ] **Step 2: Update `insertDynamicTask` signature in `src/workflow/run-state-machine.ts`**

Update the interface definition:

```typescript
export interface WorkflowRuntime {
  readonly db: Database
  readonly runId: string
  readonly state: RunState
  readonly spec: WorkflowSpec
  readonly compoundTaskIds: ReadonlyMap<string, string>

  readonly shouldExecuteTask: (taskName: string) => Effect.Effect<boolean, EngineError>
  readonly shouldPause: () => Effect.Effect<boolean, EngineError>
  readonly transitionTask: (taskName: string, transition: "start" | "complete" | "fail") => Effect.Effect<void, EngineError>
  readonly insertDynamicTask: (taskName: string, agentName: string, parentTaskId?: string) => Effect.Effect<void, EngineError>
  readonly pause: () => Effect.Effect<void, EngineError>
  readonly complete: () => Effect.Effect<void, EngineError>
  readonly fail: (error: string) => Effect.Effect<void, EngineError>
  readonly close: () => Effect.Effect<void>
}
```

- [ ] **Step 3: Update `insertDynamicTask` implementation in `src/workflow/run-state-machine.ts`**

Replace the existing `insertDynamicTask` method:

```typescript
  insertDynamicTask(taskName: string, agentName: string, parentTaskId?: string): Effect.Effect<void, EngineError> {
    return Effect.sync(() => {
      const taskId = buildTaskId(this._runId, taskName)
      const idx = this._nextExecutionIndex++
      let depth = 0
      if (parentTaskId) {
        const parentRow = this._db.prepare(
          "SELECT depth FROM tasks WHERE id = ?"
        ).get(parentTaskId) as { depth: number } | null
        depth = (parentRow?.depth ?? 0) + 1
      }
      insertTaskWithParent(this._db, this._runId, taskId, agentName, taskName, idx, parentTaskId ?? null, depth)
      this._taskStates.set(taskName, "pending")
      this._compoundTaskIds.set(taskName, taskId)
    })
  }
```

- [ ] **Step 4: Add `insertTaskWithParent` import to `src/workflow/run-state-machine.ts`**

```typescript
import {
  insertRun,
  insertTasks,
  insertTask,
  insertTaskWithParent,
  getRunById,
  getTasksByRunId,
  updateTaskStarted,
  updateTaskCompleted,
  updateTaskFailed,
  updateRunCompleted,
  updateRunFailed,
  setDurableDeferred,
  getDurableDeferred,
  updateRunEnv
} from "../db/queries.js"
```

- [ ] **Step 5: Verify build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/queries.ts src/workflow/run-state-machine.ts
git commit -m "add insertTaskWithParent query, update insertDynamicTask for parent/depth"
```

---

### Task 6: Add recursion config loading from `settings.yaml`

**Files:**
- Modify: `src/prompts/config.ts`

- [ ] **Step 1: Add `RecursionConfig` type and `loadRecursionConfig()` to `src/prompts/config.ts`**

Add below the existing `loadTemplateConfig()`:

```typescript
export interface RecursionConfig {
  maxDepth: number | null
}

export function loadRecursionConfig(): Effect.Effect<RecursionConfig, TemplateConfigError> {
  return Effect.try({
    try: () => {
      const path = settingsPath()
      if (!Fs.existsSync(path)) return { maxDepth: null }

      const content = Fs.readFileSync(path, "utf-8")
      const doc = Yaml.parse(content) as Record<string, unknown> | null
      if (!doc || typeof doc !== "object") return { maxDepth: null }

      const recursion = doc["recursion"]
      if (!recursion || typeof recursion !== "object") return { maxDepth: null }

      const raw = (recursion as Record<string, unknown>)["max_depth"]
      if (raw === undefined || raw === null) return { maxDepth: null }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) return { maxDepth: null }
      return { maxDepth: n }
    },
    catch: (e) => new TemplateConfigError({ message: String(e) })
  })
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/prompts/config.ts
git commit -m "add loadRecursionConfig to read recursion.max_depth from settings.yaml"
```

---

### Task 7: Update `run.ts` and `resume.ts` to load and pass recursion config

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/resume.ts`
- Modify: `src/workflow/runner.ts:31-36` (WorkflowRunnerConfig)
- Modify: `src/workflow/runner.ts:44-50` (runWorkflow signature)

- [ ] **Step 1: Add `maxRecursionDepth` to `WorkflowRunnerConfig` in `src/workflow/runner.ts`**

```typescript
export interface WorkflowRunnerConfig {
  workflowsDir: string
  maxRecursionDepth?: number
}
```

- [ ] **Step 2: Update `runWorkflow` signature to extract config**

No signature change needed — `config` already contains `WorkflowRunnerConfig`. Just extract `config.maxRecursionDepth` in the function body for later use. Add a local variable near the top of `runWorkflow`:

At line 52, after `const startedAt = ...`:

```typescript
const settingsMaxDepth = config.maxRecursionDepth
```

- [ ] **Step 3: Load recursion config in `src/cli/commands/run.ts`**

Update imports:

```typescript
import { loadTemplateConfig, loadRecursionConfig } from "../../prompts/config.js"
```

Update `executeRun` to load and pass recursion config (after line 80, where `templateOptions` is loaded):

```typescript
    const templateOptions = yield* _(loadTemplateConfig())
    const recursionConfig = yield* _(loadRecursionConfig())

    const result = yield* _(
      runWorkflow(spec, { user_input: params.prompt, cwd: process.cwd() }, {
        workflowsDir: wfDir,
        maxRecursionDepth: recursionConfig.maxDepth ?? undefined
      }, templateOptions, params.externalRunId).pipe(
        Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
      )
    )
```

- [ ] **Step 4: Load recursion config in `src/cli/commands/resume.ts`**

Update imports:

```typescript
import { loadTemplateConfig, loadRecursionConfig } from "../../prompts/config.js"
```

Find the `runWorkflow` call in `resume.ts` and add recursion config loading before it. The existing call is around line 70-80:

```typescript
    const templateOptions = yield* _(loadTemplateConfig())
    const recursionConfig = yield* _(loadRecursionConfig())

    const result = yield* _(
      runWorkflow(spec, params, {
        workflowsDir: wfDir,
        maxRecursionDepth: recursionConfig.maxDepth ?? undefined
      }, templateOptions, runId).pipe(
        ...
      )
    )
```

- [ ] **Step 5: Verify build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/run.ts src/cli/commands/resume.ts src/workflow/runner.ts
git commit -m "pass maxRecursionDepth from settings to runner config"
```

---

### Task 8: Resolve `max_recursion_depth` (workflow YAML override > settings)

**Files:**
- Modify: `src/workflow/runner.ts` (add `resolveMaxRecursionDepth` helper)

- [ ] **Step 1: Add `resolveMaxRecursionDepth` helper in `src/workflow/runner.ts`**

Add inside `runWorkflow`, after loading `settingsMaxDepth` (from task 7 step 2), right before the `executeSingleTask` definition:

```typescript
    const resolveMaxRecursionDepth = (): number | null => {
      if (spec.spec.run.max_recursion_depth !== undefined) return spec.spec.run.max_recursion_depth
      return settingsMaxDepth ?? null
    }
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "add resolveMaxRecursionDepth with workflow > settings precedence"
```

---

### Task 9: Wire `when` evaluation and depth enforcement into the runner

**Files:**
- Modify: `src/workflow/runner.ts` (template expansion block, depth check, when evaluation)

- [ ] **Step 1: Add imports to `src/workflow/runner.ts`**

```typescript
import { evaluateWhen, WhenError } from "../cel/evaluate.js"
```

- [ ] **Step 2: Add `when` evaluation and depth check before template expansion**

In the runner's `body` Effect (the `for (const task of sortedTasks)` loop), add the `when` check and depth enforcement before the existing template expansion block. Replace the block starting at line 237 (`for (const task of sortedTasks)`) through the `continue` at line 268.

The new block at the start of the loop (after `if (workflowStatus === "failed") break`):

```typescript
      for (const task of sortedTasks) {
        if (workflowStatus === "failed") break

        if (task.when) {
          const maxDepth = resolveMaxRecursionDepth()
          const taskDepth = task.template ? 0 : 0
          if (maxDepth !== null && taskDepth >= maxDepth) {
            yield* _(ctx.transitionTask(task.name, "fail"))
            const errorMsg = `max recursion depth (${maxDepth}) exceeded for task "${task.name}"`
            yield* _(ctx.fail(errorMsg))
            workflowStatus = "failed"
            break
          }

          try {
            const result = evaluateWhen(task.when, { inputs: workflowEnv as Record<string, unknown> })
            if (!result) {
              yield* _(ctx.transitionTask(task.name, "complete"))
              continue
            }
          } catch (e) {
            const errorMsg = e instanceof WhenError ? e.message : String(e)
            yield* _(ctx.transitionTask(task.name, "fail"))
            yield* _(ctx.fail(errorMsg))
            workflowStatus = "failed"
            break
          }
        }

        if (task.template) {
```

- [ ] **Step 3: Add depth enforcement and parent tracking in template expansion block**

In the template expansion block (after the `when` check added above), update the `insertDynamicTask` calls to pass `parentTaskId`. The parent task ID is the compound ID of the current task:

Find the two `ctx.insertDynamicTask` calls inside the template expansion block:

For sub-task expansion (line 260):
```typescript
                yield* _(ctx.insertDynamicTask(subInstanceName, subTask.agent!.executorRef, compoundParentTaskId))
```

For single agent template (line 264):
```typescript
              yield* _(ctx.insertDynamicTask(instanceName, templateTask.agent!.executorRef, compoundParentTaskId))
```

Where `compoundParentTaskId` is computed right before the forEach loop:

```typescript
          const compoundParentTaskId = ctx.compoundTaskIds.get(task.name) ?? undefined

          for (let i = 0; i < resolvedArgs.itemsCount; i++) {
```

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "wire when evaluation, depth check, and parent tracking into runner"
```

---

### Task 10: Remove `retry_step` from test fixture and docs

**Files:**
- Modify: `tests/fixtures/feature-dev.yml:84`
- Modify: `docs/workflow-yaml.md`

- [ ] **Step 1: Remove `retry_step` from `tests/fixtures/feature-dev.yml`**

Line 84 currently reads:
```yaml
              retry_step: implement
```
Remove that line. The resulting `test` task block should be:

```yaml
         - name: test
           dependencies:
             - implement
           agent:
             executorRef: tester
             on_failure:
               max_retries: 4
               on_exhausted:
                 escalate_to: human
             prompt:
               content: Test the implementation.
```

- [ ] **Step 2: Update `docs/workflow-yaml.md` — remove `retry_step`, add `when`, `depth`, `max_recursion_depth`**

Remove the `retry_step` row from the `on_failure` table (line 239 area) and the example (line 230 area). Add new sections documenting `when`, `max_recursion_depth`, and the `depth` column.

- [ ] **Step 3: Run existing tests to verify they pass**

Run: `bun --bun vitest run`
Expected: PASS (all 155 tests)

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/feature-dev.yml docs/workflow-yaml.md
git commit -m "remove retry_step from fixtures and docs, document when and recursion"
```

---

### Task 11: Write integration tests for `when` and recursion

**Files:**
- Create: `tests/workflow/runner-recursion.test.ts`

- [ ] **Step 1: Write integration test file**

Create `tests/workflow/runner-recursion.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Stream, Scope } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import { Event, EventBus, EventBusLive } from "../../src/events/bus.js"
import type { WorkflowSpec, AgentManifest } from "../../src/types.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done", result: "ok", feedback: "fix this" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolvePersona: vi.fn(() => E.succeed({ agent: "test-agent", soul: "test-soul" })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})

const makeAgentManifest = (name: string): AgentManifest => ({
  metadata: { name },
  dirPath: `/agents/${name}`,
  spec: {
    settings: { model: "default" },
    systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
  },
  systemPrompt: { agent: `${name}/INSTRUCTIONS.md`, soul: `${name}/SOUL.md` }
})

describe("workflow recursion", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-recursion-test-"))
    process.env.HOME = tmpHome
    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "agents"), { recursive: true })
    const piDir = Path.join(hh, "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  const collectEvents = (effect: Effect.Effect<unknown, unknown, EventBus | Scope.Scope>): Promise<Event[]> => {
    const events: Event[] = []
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          yield* _(effect)
        })
      ).pipe(Effect.provide(EventBusLive))
    ).then(() => events)
  }

  it("skips task when 'when' evaluates to false", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "skip-test" },
      spec: {
        run: { entrypoint: "maybe-run", timeout: "300s" },
        tasks: [
          {
            name: "maybe-run",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "false"
          },
          {
            name: "after",
            dependencies: ["maybe-run"],
            agent: { executorRef: "worker", prompt: { content: "After" } }
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
    expect(started[0].taskName).toBe("after")
  })

  it("executes task when 'when' evaluates to true", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "run-test" },
      spec: {
        run: { entrypoint: "will-run", timeout: "300s" },
        tasks: [
          {
            name: "will-run",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "true"
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
    expect(started[0].taskName).toBe("will-run")
  })

  it("fails task when 'when' has invalid CEL syntax", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "bad-cel" },
      spec: {
        run: { entrypoint: "bad", timeout: "300s" },
        tasks: [
          {
            name: "bad",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "inputs.tasks.==="
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") }, { strict: false })
    )

    const failed = events.filter(e => e._tag === "WorkflowCompleted")
    expect(failed.length).toBeGreaterThan(0)
  })

  it("fails task when 'when' references missing path", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "missing-path" },
      spec: {
        run: { entrypoint: "bad", timeout: "300s" },
        tasks: [
          {
            name: "bad",
            agent: { executorRef: "worker", prompt: { content: "Do work" } },
            when: "inputs.tasks.nonexistent.outputs.x != ''"
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") }, { strict: false })
    )

    const failed = events.filter(e => e._tag === "WorkflowCompleted")
    expect(failed.length).toBeGreaterThan(0)
  })

  it("fails when recursion depth exceeds max", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "depth-limit" },
      spec: {
        run: { entrypoint: "looper", timeout: "300s", max_recursion_depth: 2 },
        tasks: [
          {
            name: "looper",
            template: "looper",
            when: "true"
          },
          {
            name: "fixer",
            agent: { executorRef: "worker", prompt: { content: "Fix" } }
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") }, { strict: false })
    )

    const completed = events.filter(e => e._tag === "WorkflowCompleted")
    expect(completed.length).toBe(1)
  })

  it("depth defaults to 0 for root tasks", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "root-depth" },
      spec: {
        run: { entrypoint: "plan", timeout: "300s" },
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan" } } }
        ]
      },
      agentRegistry: new Map([["planner", makeAgentManifest("planner")]])
    }

    const result = await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") }, { strict: false })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(result.status).toBe("completed")
  })

  it("when works without template (agent task)", async () => {
    const spec: WorkflowSpec = {
      metadata: { version: 1, name: "agent-when" },
      spec: {
        run: { entrypoint: "maybe", timeout: "300s" },
        tasks: [
          {
            name: "maybe",
            agent: { executorRef: "worker", prompt: { content: "Maybe" } },
            when: "true"
          }
        ]
      },
      agentRegistry: new Map([["worker", makeAgentManifest("worker")]])
    }

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") }, { strict: false })
    )

    const started = events.filter(e => e._tag === "TaskStarted")
    expect(started.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun --bun vitest run tests/workflow/runner-recursion.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `bun --bun vitest run`
Expected: PASS (all tests)

- [ ] **Step 4: Commit**

```bash
git add tests/workflow/runner-recursion.test.ts
git commit -m "add integration tests for when evaluation, recursion depth, and conditional tasks"
```

---

### Task 12: Final verification and ROADMAP update

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run full build**

```bash
bun run build
```

- [ ] **Step 2: Run full test suite**

```bash
bun --bun vitest run
```

- [ ] **Step 3: Update ROADMAP.md**

Move the line `- [ ] Ensure retry_step and status: retry work -> implement recursion support...` from `## Next Up` to `## Completed` as:

```markdown
- [x] Remove retry_step and implement recursion support with `when` (CEL), `depth` tracking, and `max_recursion_depth`
```

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md
git commit -m "update ROADMAP: mark recursion support as completed"
```
