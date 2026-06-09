# CLI Output and Status Fixes — Design Doc

## Issues Addressed

1. Output token usage and time spent after each step and at end of workflow
2. Fix run command printing nothing at start (subscriber race condition)
3. Status command not showing current task indicator
4. Status command task order wrong for template/forEach tasks
5. Add total time and token usage to workflow summary

---

## Section 1: Fix subscriber race condition (Issue 2)

**Root cause**: `Effect.forkScoped` in `createSubscriber` forks the stream consumer fiber, but the Effect runtime doesn't guarantee fiber scheduling before the parent continues. The runner publishes `WorkflowStarted` and the first `StepStarted` while subscriber fibers are still being set up. Events get buffered in the PubSub queue, then consumed later in a batch — which is why you see `plan` completed before any started output.

**Fix** (`src/events/bus.ts`): Replace `Effect.forkScoped(...Stream.runDrain)` with an explicit `Effect.fork` + `Scope.addFinalizer(Fiber.interrupt)` + `Effect.yieldNow()`. This gives the runtime a yield point for the subscriber fiber to start draining before the parent proceeds.

**Fix** (`src/cli/subscribers.ts`): Format `StepStarted` events with clean task slug + nanoid identifier instead of full UUID. The stepId format is `<workflow-id>-<slug>-<nanoid>`, so a stepId like `feature-dev-1RW0n-setup-r5J-c` becomes `setup (r5J-c)`.

---

## Section 2: Per-step token/time output (Issue 1)

**Where**: Subscribe to `StepCompleted` + accumulate `TokenUsage` deltas in the `CliRenderer`. On `StepCompleted`, format and print per-step stats.

**Output format**:
```
  ✓ setup (r5J-c) completed (34s, 12.3k in / 1.2k out)
```

**Implementation**: The runner already tracks token deltas per-turn via `subscribePiEvents` in `src/observability/streaming.ts`. The `CliRenderer` accumulates these per stepId in a local map, and prints on `StepCompleted`.

---

## Section 3: Workflow-level summary (Issue 5)

**Output at workflow end**:
```
Workflow feature-dev-1RW0n completed (5m 23s, 156k tokens in / 42k out)
```

**`summary.json` additions**: Add `totalTokensIn`, `totalTokensOut`, `elapsedSeconds` to the summary object written in `src/workflow/runner.ts:227`. The runner accumulates totals from `TokenUsage` events during execution.

---

## Section 4: Status command fixes (Issues 3 & 4)

**Issue 4 (ordering)**: The topological sort uses `t.name` to build an `orderMap`, but template/forEach tasks produce compound names like `implement-stories/0`. The expanded order map fails to match these against the sorted tasks.

**Fix** (`src/cli/commands/status.ts`): In `formatStatus`, when building `expandedOrder`, extract the base name from compound slugs (part before `/`). Match against `sorted.find(t => t.name === baseName)`. Also handle nested templates (e.g., `implement-stories/0-implement-story` → strip trailing `-subtaskName` before matching).

**Issue 3 (running indicator)**: The `currentTask` column stores the full compound taskId. `formatStatus` needs to parse the slug from `status.currentTask` the same way `parseTaskSlug` handles task entries, then highlight it in the task list with a visual indicator.

**Visual format**:
```
Tasks:
  ✓  setup
  ⏳ plan          ← currently running
  ○  implement-stories/0
  ○  implement-stories/1
  ○  verify-stories/0
  ○  verify-stories/1
  ○  test
```

---

## Section 5: Data flow

```
runner.ts
  ├── publish events → EventBus (PubSub)
  │     ├── CliRenderer (forked fiber) → Console.log
  │     ├── FileLogger (forked fiber) → JSONL files
  │     └── DbWriter (eager, via ctx.db) → SQLite
  │
  ├── after task complete → ctx.transitionTask updates DB
  └── at workflow end → write summary.json with token/time totals
```

**Key change**: The `createSubscriber` function uses an explicit `Effect.fork` + `Effect.yieldNow()` to ensure subscriber fibers are scheduled before events start publishing.

---

## Acceptance criteria

1. `hamilton run` prints `Workflow started [slug-id]` immediately
2. `hamilton run` prints `Step <slug> (<nanoid>) started` for every task, including the entrypoint (`plan`)
3. `hamilton run` prints per-step token/time on completion: `✓ <slug> completed (<time>, <tokens>)`
4. `hamilton run` prints workflow-level total token/time at end
5. `summary.json` includes `totalTokensIn`, `totalTokensOut`, `elapsedSeconds`
6. `hamilton status <id>` shows tasks in correct topological order, including template/forEach tasks
7. `hamilton status <id>` shows a visual indicator (⏳) on the currently running task

---

## Post-implementation

Update `ROADMAP.md` — move all 5 issues + progress file from Next Up to Completed.
