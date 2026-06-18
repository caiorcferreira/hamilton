# Roadmap Batch Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six focused improvements: inject output schema in task prompts, fuzzy-match error suggestions, background runs (default) with foreground flag, fix guideline file naming, eliminate taskId string parsing via event enrichment, and add a git_diff tool to the workflow extension.

**Architecture:** Each task is independent and touches 1-3 files. Four tasks modify the workflow runner/extension layer, one touches the resolver/loader/CLI error path, one touches the CLI run command and DB layer, and one fixes the guideline loader. All use existing patterns (TaggedError, Effect.gen, vitest).

**Tech Stack:** TypeScript, bun, Effect-TS, vitest, bun:sqlite, Pi SDK (TypeBox, defineTool), YAML

---

### Task 1: Output Schema Injection in Task Prompt

**Files:**
- Modify: `src/workflow/runner.ts:149-171`
- Test: `tests/workflow/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test case at the end of the first `describe` block in `tests/workflow/runner.test.ts` (after line 260, inside the `describe("runWorkflow DAG-aware executor")` block):

```typescript
import type { Event } from "../../src/events/bus.js"
```

```typescript
  it("injects output schema into task prompt when schema is present", async () => {
    const schemaContent = { type: "object", properties: { status: { type: "string" }, repo: { type: "string" } }, required: ["status"] }
    const spec = makeSpec({
      spec: {
        ...makeSpec().spec,
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan the feature" }, output: { schema: { content: schemaContent } } } },
          { name: "implement", dependencies: ["plan"], agent: { executorRef: "coder", prompt: { content: "Implement it" } } }
        ]
      }
    })

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
    )

    const planPromptBuilt = events.find(e => e._tag === "PromptBuilt" && e.taskId.includes("plan"))
    expect(planPromptBuilt).toBeDefined()
    const ppb = planPromptBuilt as Extract<Event, { _tag: "PromptBuilt" }>
    expect(ppb.taskPrompt).toContain("<expected_output_schema>")
    expect(ppb.taskPrompt).toContain("</expected_output_schema>")
    expect(ppb.taskPrompt).toContain('"type": "object"')
    expect(ppb.taskPrompt).toContain("<task>")
    expect(ppb.taskPrompt).toContain("</task>")
    expect(ppb.taskPrompt).toContain("Plan the feature")

    const implPromptBuilt = events.find(e => e._tag === "PromptBuilt" && e.taskId.includes("implement"))
    expect(implPromptBuilt).toBeDefined()
    const ipb = implPromptBuilt as Extract<Event, { _tag: "PromptBuilt" }>
    expect(ipb.taskPrompt).not.toContain("<expected_output_schema>")
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/workflow/runner.test.ts -t "injects output schema"
```
Expected: FAIL — taskPrompt does not contain `<expected_output_schema>`.

- [ ] **Step 3: Implement schema wrapping in runner.ts**

In `src/workflow/runner.ts`, replace lines 153-156:

Replace:
```typescript
        const finalPrompt = task.name === spec.spec.run.entrypoint
          ? { ...prompt, taskPrompt: `${prompt.taskPrompt}\n\n# User input\n\n${taskEnv.user_input ?? ""}` }
          : prompt
```

With:
```typescript
        let taskPromptContent = prompt.taskPrompt
        if (task.agent?.output?.schema?.content) {
          const schemaJson = JSON.stringify(task.agent.output.schema.content, null, 2)
          taskPromptContent = `<expected_output_schema>\n${schemaJson}\n</expected_output_schema>\n\n<task>\n${taskPromptContent}\n</task>`
        }
        if (task.name === spec.spec.run.entrypoint) {
          taskPromptContent = `${taskPromptContent}\n\n# User input\n\n${taskEnv.user_input ?? ""}`
        }
        const finalPrompt = { ...prompt, taskPrompt: taskPromptContent }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/workflow/runner.test.ts -t "injects output schema"
```
Expected: PASS.

- [ ] **Step 5: Run full runner test suite**

```bash
bun --bun vitest run tests/workflow/runner.test.ts
```
Expected: All 10 tests pass (9 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/runner.test.ts
git commit -m "feat: inject output schema into task prompt"
```

---

### Task 2: Levenshtein Distance + Nearest Match Utility

**Files:**
- Modify: `src/workflow/resolver.ts` — add `findNearestSlugs` export
- Test: `tests/workflow/resolver.test.ts` — add test cases

- [ ] **Step 1: Write tests for findNearestSlugs**

In `tests/workflow/resolver.test.ts`, change the import line to:

```typescript
import { resolveWorkflowSlug, findNearestSlugs } from "../../src/workflow/resolver.js"
```

Add these test cases before the closing `})`:

```typescript
  it("findNearestSlugs returns top 3 nearest matches sorted by distance", () => {
    const available = new Set(["feature-dev", "feature-review", "bug-fix", "hotfix", "deploy"])
    expect(findNearestSlugs("featuer-dev", available)).toEqual(["feature-dev", "feature-review", "hotfix"])
  })

  it("findNearestSlugs returns empty array when available set is empty", () => {
    expect(findNearestSlugs("anything", new Set())).toEqual([])
  })

  it("findNearestSlugs returns exact match first with distance 0", () => {
    const available = new Set(["bug-fix", "feature"])
    expect(findNearestSlugs("bug-fix", available)).toEqual(["bug-fix", "feature"])
  })

  it("findNearestSlugs handles case where available has fewer than 3 entries", () => {
    const available = new Set(["abc"])
    expect(findNearestSlugs("xyz", available)).toEqual(["abc"])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/workflow/resolver.test.ts -t "findNearestSlugs"
```
Expected: FAIL — `findNearestSlugs is not exported`.

- [ ] **Step 3: Implement levenshtein and findNearestSlugs**

In `src/workflow/resolver.ts`, replace the entire file content:

```typescript
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(dp[j], dp[j - 1], prev) + 1
      prev = temp
    }
  }
  return dp[n]
}

export function findNearestSlugs(input: string, available: ReadonlySet<string>): string[] {
  const entries = [...available]
  if (entries.length === 0) return []
  const scored = entries.map((slug) => ({ slug, distance: levenshtein(input, slug) }))
  scored.sort((a, b) => a.distance - b.distance)
  return scored.slice(0, 3).map((s) => s.slug)
}

export function resolveWorkflowSlug(
  input: string,
  available: ReadonlySet<string>
): string {
  const idx = input.indexOf("--variants")
  const base = idx === -1 ? input : input.substring(0, idx)
  if (available.has(base)) return base
  return input
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/workflow/resolver.test.ts -t "findNearestSlugs"
```
Expected: All 4 new tests PASS.

- [ ] **Step 5: Run full resolver suite**

```bash
bun --bun vitest run tests/workflow/resolver.test.ts
```
Expected: All 8 tests pass (4 existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/workflow/resolver.ts tests/workflow/resolver.test.ts
git commit -m "feat: add Levenshtein-based nearest slug suggestion"
```

---

### Task 3: Error Messages with Nearest Match Suggestions

**Files:**
- Modify: `src/workflow/loader.ts:12-15, 82`
- Modify: `src/cli/commands/run.ts:112-113`

- [ ] **Step 1: Add nearestMatches to WorkflowNotFoundError**

In `src/workflow/loader.ts`, add an import for `findNearestSlugs` after the existing `import { composeVariants } from "./variants.js"` line:

```typescript
import { findNearestSlugs } from "./resolver.js"
```

Change the `WorkflowNotFoundError` definition (lines 12-15) from:

```typescript
export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>("WorkflowNotFoundError")("WorkflowNotFoundError", {
  workflowName: Schema.String,
  dir: Schema.String
}) { }
```

To:

```typescript
export class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>("WorkflowNotFoundError")("WorkflowNotFoundError", {
  workflowName: Schema.String,
  dir: Schema.String,
  nearestMatches: Schema.Array(Schema.String)
}) { }
```

- [ ] **Step 2: Compute nearest matches when error is thrown**

Change line 82 from:

```typescript
        catch: () => new WorkflowNotFoundError({ workflowName, dir })
```

To:

```typescript
        catch: () => {
          const availableNames = new Set(workflows.map((w) => w.name))
          const nearestMatches = findNearestSlugs(workflowName, availableNames)
          return new WorkflowNotFoundError({ workflowName, dir, nearestMatches })
        }
```

- [ ] **Step 3: Display suggestions in CLI error handler**

In `src/cli/commands/run.ts`, change lines 112-113 from:

```typescript
    if (Exit.isFailure(result)) {
      yield* Console.error(`Workflow failed: ${String(result.cause)}`)
      return
    }
```

To:

```typescript
    if (Exit.isFailure(result)) {
      const cause = result.cause
      yield* Console.error(`Workflow failed: ${String(cause)}`)
      if (typeof cause === "object" && cause !== null && "_tag" in cause && (cause as any)._tag === "WorkflowNotFoundError") {
        const err = cause as { workflowName: string; nearestMatches: string[] }
        if (err.nearestMatches && err.nearestMatches.length > 0) {
          yield* Console.log("")
          yield* Console.log("Did you mean:")
          for (const match of err.nearestMatches) {
            yield* Console.log(`  - ${match}`)
          }
        }
      }
      return
    }
```

- [ ] **Step 4: Run existing tests to verify no regressions**

```bash
bun --bun vitest run tests/workflow/resolver.test.ts tests/cli/run.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/loader.ts src/cli/commands/run.ts
git commit -m "feat: suggest nearest workflow names on NotFound error"
```

---

### Task 4: Background Run — DB Column + Migration

**Files:**
- Modify: `src/db/schema.ts:10-13`
- Modify: `src/db/migrations.ts`
- Modify: `src/db/queries.ts`
- Test: `tests/db/queries.test.ts`

- [ ] **Step 1: Add pid column to runs table in schema**

In `src/db/schema.ts`, find the `runs` table CREATE statement and add `pid INTEGER,` between `error_message TEXT,` and `context_json TEXT DEFAULT '{}'`:

```
      error_message TEXT,
      pid INTEGER,
      context_json TEXT DEFAULT '{}'
```

- [ ] **Step 2: Add migration version 5**

In `src/db/migrations.ts`, add after migration 4 (the `}` on line 28):

```typescript
  5: (db) => {
    try { db.exec("ALTER TABLE runs ADD COLUMN pid INTEGER") }
    catch (e: any) { if (!String(e).includes("duplicate column name")) throw e }
  }
```

- [ ] **Step 3: Add insertRunPid query and update RunRow type**

In `src/db/queries.ts`, add `pid: number | null` to the `RunRow` interface (line 11, after `error_message`):

```typescript
  pid: number | null
```

Add `RunPidRow` export (used as return type) and `insertRunPid` function after `updateRunEnv` (after line 253):

```typescript
export function insertRunPid(
  db: Database,
  runId: string,
  pid: number
): void {
  db.prepare(
    `UPDATE runs SET pid = ? WHERE id = ?`
  ).run(pid, runId)
}
```

- [ ] **Step 4: Write test for insertRunPid**

In `tests/db/queries.test.ts`, add `insertRunPid` to the import block (line 25 area):

```typescript
  insertRunPid
```

Add this test case before the closing `})`:

```typescript
  it("insertRunPid stores pid on a run", () => {
    insertRun(db, "run-abc", "test-wf", new Date().toISOString())
    insertRunPid(db, "run-abc", 4242)

    const row = getRunById(db, "run-abc")
    expect(row?.pid).toBe(4242)
  })
```

- [ ] **Step 5: Run tests**

```bash
bun --bun vitest run tests/db/queries.test.ts -t "insertRunPid"
```
Expected: PASS.

- [ ] **Step 6: Run full DB test suite**

```bash
bun --bun vitest run tests/db/queries.test.ts tests/db/schema.test.ts tests/db/migrations.test.ts
```
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts src/db/queries.ts tests/db/queries.test.ts
git commit -m "feat: add runs.pid column for background run process tracking"
```

---

### Task 5: Background Run — CLI Spawn Logic

**Files:**
- Modify: `src/cli/commands/run.ts`

- [ ] **Step 1: Add --foreground, --run-id options**

In `src/cli/commands/run.ts`, add new options after line 88:

```typescript
const foreground = Options.boolean("foreground").pipe(Options.withAlias("f"), Options.optional)
const runIdOption = Options.text("run-id").pipe(Options.optional)
```

- [ ] **Step 2: Add buildRunId and DB imports**

Add these imports at the top of the file:

```typescript
import { Database } from "bun:sqlite"
import { dbPath } from "../../paths.js"
import { migrate } from "../../db/migrations.js"
import { insertRunPid } from "../../db/queries.js"
import { buildRunId } from "../../workflow/engine.js"
```

(Note: `Database`, `dbPath` may already be imported — `dbPath` is at line 19 already. Check and add only missing ones.)

- [ ] **Step 3: Add externalRunId to RunParams**

In `src/cli/commands/run.ts`, change the `RunParams` interface (lines 22-26):

```typescript
export interface RunParams {
  workflowSlug: string
  prompt: string
  variants?: string
  externalRunId?: string
}
```

- [ ] **Step 4: Add PID write and externalRunId passthrough in executeRun**

In `executeRun`, after the `availableSlugs` computation (before line 59), add:

```typescript
    if (params.externalRunId) {
      yield* _(Effect.sync(() => {
        const db = new Database(dbPath())
        migrate(db)
        insertRunPid(db, params.externalRunId, process.pid)
        db.close()
      }))
    }
```

- [ ] **Step 5: Change executeRun call to pass externalRunId**

Find the line where `executeRun` is called inside the command handler (approximately line 108). Change the argument object to include `externalRunId`:

```typescript
          return yield* executeRun({ workflowSlug: slug, prompt: promptText, variants: variants._tag === "Some" ? variants.value : undefined, externalRunId })
```

- [ ] **Step 6: Replace the command handler with background spawn logic**

Replace the entire command handler (lines 90-121). The full new handler:

```typescript
export const runCommand = Command.make("run", { slug, prompt, variants, foreground, runIdOption }, ({ slug, prompt, variants, foreground, runIdOption }) =>
  Effect.gen(function* () {
    const promptText = prompt.join(" ")
    const isForeground = foreground._tag === "Some" ? foreground.value : false
    const externalRunId = runIdOption._tag === "Some" ? runIdOption.value : undefined

    if (!isForeground && !externalRunId) {
      const runId = buildRunId(slug)
      const allArgs = ["run", slug, ...prompt, "--foreground", "--run-id", runId]
      if (variants._tag === "Some") {
        allArgs.push("--variants", variants.value)
      }
      const child = Bun.spawn([process.execPath, process.argv[1], ...allArgs], { detached: true })
      child.unref()

      const db = new Database(dbPath())
      migrate(db)
      insertRunPid(db, runId, child.pid)
      db.close()

      yield* Console.log(`Run ID: ${runId}`)
      yield* Console.log("Running in background. Use 'hamilton status <run-id>' to check progress.")
      return
    }

    const result = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          const telemetryCfg = yield* loadTelemetryConfig
          const db = new Database(dbPath())
          const dbEnabled = !telemetryCfg.disableStores.has("db")
          yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
          yield* TelemetrySubscriber({
            turn: makeTurnRepository(db),
            toolCall: makeToolCallRepository(db),
            providerRequest: makeProviderRequestRepository(db),
            shouldWrite: () => dbEnabled
          })
          return yield* executeRun({
            workflowSlug: slug,
            prompt: promptText,
            variants: variants._tag === "Some" ? variants.value : undefined,
            externalRunId
          })
        })
      ).pipe(Effect.provide(EventBusLive))
    )
    if (Exit.isFailure(result)) {
      const cause = result.cause
      yield* Console.error(`Workflow failed: ${String(cause)}`)
      if (typeof cause === "object" && cause !== null && "_tag" in cause && (cause as any)._tag === "WorkflowNotFoundError") {
        const err = cause as { workflowName: string; nearestMatches: string[] }
        if (err.nearestMatches && err.nearestMatches.length > 0) {
          yield* Console.log("")
          yield* Console.log("Did you mean:")
          for (const match of err.nearestMatches) {
            yield* Console.log(`  - ${match}`)
          }
        }
      }
      return
    }
    yield* Console.log(`Run ID: ${result.value.runId}`)
    yield* Console.log(`Status: ${result.value.status}`)
    for (const [task, status] of Object.entries(result.value.taskResults)) {
      yield* Console.log(`  ${task}: ${status}`)
    }
  })
).pipe(Command.withDescription("Run a workflow"))
```

- [ ] **Step 7: Run existing tests**

```bash
bun --bun vitest run tests/cli/run.test.ts
```
Expected: All tests pass (executeRun is tested directly, not the command handler).

- [ ] **Step 8: Verify build compiles**

```bash
bun run build
```
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/run.ts
git commit -m "feat: default to background runs, add --foreground flag"
```

---

### Task 6: Fix Guideline File Naming

**Files:**
- Modify: `src/guidelines/loader.ts:108`
- Test: `tests/guidelines/loader.test.ts`

- [ ] **Step 1: Write failing test**

Add this test case before the closing `})` in `tests/guidelines/loader.test.ts`:

```typescript
  it("tags instruction files as guideline-name:file-name", async () => {
    const dir = writeGuideline("my-guideline", [
      "apiVersion: dag.hamiltonai.dev/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: my-guideline",
      "spec:",
      "  instructions:",
      "  - matching: ['*']",
      "    files: [instructions.md]"
    ])
    Fs.writeFileSync(Path.join(dir, "instructions.md"), "do not use console.log")

    Fs.writeFileSync(Path.join(tmpProject, "src/index.ts"), "console.log('hi')")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.length).toBe(1)
      const guideline = exit.value[0]
      expect(guideline.instructions).not.toBeNull()
      const firstInstruction = guideline.instructions![0]
      expect(firstInstruction.name).toBe("my-guideline:instructions.md")
    }
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/guidelines/loader.test.ts -t "guideline-name:file-name"
```
Expected: FAIL — name is `"my-guideline"` not `"my-guideline:instructions.md"`.

- [ ] **Step 3: Fix the name format in loader.ts**

In `src/guidelines/loader.ts`, change line 108 from:

```typescript
            files.push({ name: manifest.metadata.name, content })
```

To:

```typescript
            files.push({ name: `${manifest.metadata.name}:${file}`, content })
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/guidelines/loader.test.ts -t "guideline-name:file-name"
```
Expected: PASS.

- [ ] **Step 5: Run full guidelines test suite**

```bash
bun --bun vitest run tests/guidelines/loader.test.ts
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/guidelines/loader.ts tests/guidelines/loader.test.ts
git commit -m "fix: use guideline-name:file-name format for instruction file naming"
```

---

### Task 7: Add taskName to Task Events

**Files:**
- Modify: `src/events/bus.ts` — add `taskName` to 6 event types (not TokenUsage)
- Modify: `src/workflow/runner.ts` — pass `instanceName` in all task event publish calls

- [ ] **Step 1: Add taskName to event type definitions**

In `src/events/bus.ts`, change each of the 6 task events by adding `readonly taskName: string`:

Line 13:
```typescript
  | { readonly _tag: "TaskStarted"; readonly runId: string; readonly taskId: string; readonly taskName: string }
```

Line 14:
```typescript
  | { readonly _tag: "TaskCompleted"; readonly runId: string; readonly taskId: string; readonly taskName: string }
```

Line 15:
```typescript
  | { readonly _tag: "TaskFailed"; readonly runId: string; readonly taskId: string; readonly taskName: string; readonly message: string }
```

Line 16:
```typescript
  | { readonly _tag: "TaskTimedOut"; readonly runId: string; readonly taskId: string; readonly taskName: string }
```

Line 17:
```typescript
  | { readonly _tag: "TaskRetrying"; readonly runId: string; readonly taskId: string; readonly taskName: string }
```

Line 18:
```typescript
  | { readonly _tag: "TaskPaused"; readonly runId: string; readonly taskId: string; readonly taskName: string }
```

- [ ] **Step 2: Pass taskName in runner.ts event publishes**

In `src/workflow/runner.ts`, add `taskName: instanceName` to each task event publish call:

Line 137:
```typescript
        yield* _(bus.publish({ _tag: "TaskStarted", runId, taskId, taskName: instanceName }))
```

Line 196:
```typescript
                    yield* _(bus.publish({ _tag: "TaskRetrying", runId, taskId, taskName: instanceName }))
```

Line 205:
```typescript
          yield* _(bus.publish({ _tag: "TaskTimedOut", runId, taskId, taskName: instanceName }))
```

Line 219:
```typescript
        yield* _(bus.publish({ _tag: "TaskCompleted", runId, taskId, taskName: instanceName }))
```

Line 272:
```typescript
          yield* _(bus.publish({ _tag: "TaskPaused", runId, taskId: task.name, taskName: task.name }))
```

- [ ] **Step 3: Verify build compiles**

```bash
bun run build
```
Expected: No errors. The type checker enforces all publish calls include `taskName`.

- [ ] **Step 4: Run existing tests to verify no regressions**

```bash
bun --bun vitest run tests/workflow/runner.test.ts tests/cli/subscribers.test.ts tests/events/bus.test.ts
```
Expected: All tests pass. Subscriber tests may need updating — see Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/events/bus.ts src/workflow/runner.ts
git commit -m "feat: add taskName field to all task events"
```

---

### Task 8: Use taskName in CliRenderer, Remove String Parsing

**Files:**
- Modify: `src/cli/subscribers.ts` — use `event.taskName`, remove `extractSlug`/`shortId`
- Test: `tests/cli/subscribers.test.ts` — update to include `taskName` in events

- [ ] **Step 1: Update CliRenderer to use event.taskName**

In `src/cli/subscribers.ts`, replace every occurrence of `extractSlug(event.taskId, event.runId)` with `event.taskName` and `shortId(event.taskId)` with `event.taskId.split("-").pop() ?? event.taskId`.

Delete the `extractSlug` function (lines 4-11) and `shortId` function (lines 13-15).

The affected cases:

Line 48-49:
```typescript
        const slug = extractSlug(event.taskId, event.runId)
        return Console.log(`  Task ${slug} (${shortId(event.taskId)}) started`)
```
Becomes:
```typescript
        return Console.log(`  Task ${event.taskName} (${event.taskId.split("-").pop()}) started`)
```

Line 66-67:
```typescript
        const slug = extractSlug(event.taskId, event.runId)
        const id = shortId(event.taskId)
```
Becomes:
```typescript
        const slug = event.taskName
        const id = event.taskId.split("-").pop() ?? event.taskId
```

Line 79-80:
```typescript
        const slug = extractSlug(event.taskId, event.runId)
        return Console.log(`  \u2717 ${slug} (${shortId(event.taskId)}) failed: ${event.message}`)
```
Becomes:
```typescript
        return Console.log(`  \u2717 ${event.taskName} (${event.taskId.split("-").pop()}) failed: ${event.message}`)
```

Line 84-85:
```typescript
        const slug = extractSlug(event.taskId, event.runId)
        return Console.log(`  \u23F1 ${slug} (${shortId(event.taskId)}) timed out`)
```
Becomes:
```typescript
        return Console.log(`  \u23F1 ${event.taskName} (${event.taskId.split("-").pop()}) timed out`)
```

Line 89-90:
```typescript
        const slug = extractSlug(event.taskId, event.runId)
        return Console.log(`  \u21BB ${slug} (${shortId(event.taskId)}) retrying`)
```
Becomes:
```typescript
        return Console.log(`  \u21BB ${event.taskName} (${event.taskId.split("-").pop()}) retrying`)
```

Line 94-95:
```typescript
        const slug = extractSlug(event.taskId, event.runId)
        return Console.log(`  \u23F8 ${slug} (${shortId(event.taskId)}) paused`)
```
Becomes:
```typescript
        return Console.log(`  \u23F8 ${event.taskName} (${event.taskId.split("-").pop()}) paused`)
```

- [ ] **Step 2: Update subscriber test to include taskName**

In `tests/cli/subscribers.test.ts`, change the task event publishes (lines 58-60) from:

```typescript
        yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "s1" }))
        yield* _(bus.publish({ _tag: "TaskCompleted", runId: "r1", taskId: "s1" }))
        yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: "r1" }))
```

To:

```typescript
        yield* _(bus.publish({ _tag: "TaskStarted", runId: "r1", taskId: "s1", taskName: "plan" }))
        yield* _(bus.publish({ _tag: "TaskCompleted", runId: "r1", taskId: "s1", taskName: "plan" }))
        yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: "r1" }))
```

Also update the assertion on line 73 to check for the actual task name:

```typescript
    expect(logs.some((l) => l.includes("plan"))).toBe(true)
```

- [ ] **Step 3: Run tests**

```bash
bun --bun vitest run tests/cli/subscribers.test.ts
```
Expected: PASS.

- [ ] **Step 4: Run full test suite**

```bash
bun run test
```
Expected: All 155 tests pass (or whatever the current count is).

- [ ] **Step 5: Commit**

```bash
git add src/cli/subscribers.ts tests/cli/subscribers.test.ts
git commit -m "fix: use event.taskName instead of parsing taskId strings"
```

---

### Task 9: Git Diff Tool

**Files:**
- Modify: `src/executors/pi/extensions/workflow-extension.ts`
- Test: `tests/executors/pi/workflow-extension.test.ts`

- [ ] **Step 1: Write failing tests**

Add these test cases before the closing `})` in `tests/executors/pi/workflow-extension.test.ts`:

```typescript
  it("registers the git_diff tool on pi", () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const registeredNames = registerTool.mock.calls.map((c: any) => c[0].name)
    expect(registeredNames).toContain("git_diff")
  })

  it("git_diff tool returns unstaged diff output", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls.find((c: any) => c[0].name === "git_diff")[0]
    const result = await toolDef.execute("call-1", { staged: false }, undefined, undefined, {} as any)

    expect(result.content[0].type).toBe("text")
    expect(typeof (result.content[0] as { type: "text"; text: string }).text).toBe("string")
  })

  it("git_diff tool returns staged diff when staged=true", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createWorkflowExtension("run-1", "task-1")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls.find((c: any) => c[0].name === "git_diff")[0]
    const result = await toolDef.execute("call-1", { staged: true }, undefined, undefined, {} as any)

    expect(result.content[0].type).toBe("text")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/executors/pi/workflow-extension.test.ts -t "git_diff"
```
Expected: FAIL — `git_diff` tool not registered.

- [ ] **Step 3: Implement git_diff tool in workflow extension**

In `src/executors/pi/extensions/workflow-extension.ts`, add a second tool registration inside `createWorkflowExtension`. After the `write_task_output` registration (after line 42), add:

```typescript
    pi.registerTool(defineTool({
      name: "git_diff",
      label: "Git Diff",
      description: "Show git diff for the working directory. Set staged=true to see staged changes (git diff --cached). Defaults to unstaged changes.",
      parameters: Type.Object({
        staged: Type.Optional(Type.Boolean({ description: "Show staged changes instead of unstaged (default: false)" }))
      }),
      promptSnippet: "- git_diff: shows current git diff (staged or unstaged)",
      execute: async (_toolCallId, { staged }, _signal, _onUpdate, _ctx) => {
        try {
          const args = staged ? ["diff", "--cached"] : ["diff"]
          const proc = Bun.spawnSync(["git", ...args], {
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "pipe"
          })
          const output = new TextDecoder().decode(proc.stdout)
          const errorOutput = new TextDecoder().decode(proc.stderr)

          if (proc.exitCode !== 0 && errorOutput) {
            return {
              content: [{ type: "text" as const, text: `git diff failed: ${errorOutput.trim()}` }],
              details: {}
            }
          }

          return {
            content: [{ type: "text" as const, text: output || "No changes." }],
            details: {}
          }
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: `git diff error: ${String(e)}` }],
            details: {}
          }
        }
      }
    }))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --bun vitest run tests/executors/pi/workflow-extension.test.ts -t "git_diff"
```
Expected: All 3 new tests PASS.

- [ ] **Step 5: Run full workflow extension test suite**

```bash
bun --bun vitest run tests/executors/pi/workflow-extension.test.ts
```
Expected: All tests pass (12 existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/executors/pi/extensions/workflow-extension.ts tests/executors/pi/workflow-extension.test.ts
git commit -m "feat: add git_diff tool to workflow extension"
```
