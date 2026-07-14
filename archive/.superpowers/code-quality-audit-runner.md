# Code Quality Audit: `src/workflow/runner.ts`

## Severity Legend
- 🔴 Critical &mdash; structural defect, must fix
- 🟠 Major &mdash; significant violation, high priority
- 🟡 Minor &mdash; cleanup opportunity

---

## 1. 🔴 Inline Type Import Inside Function Body (line 99)

```typescript
const allRules: import("../guidelines/types.js").CompiledRule[] = []
```

Dynamic `import()` inside a type annotation embedded in a function body. Not idiomatic TypeScript. The type should be statically imported at the module level alongside all other imports.

**Principle violated:** Clean Code &mdash; imports belong at the module level.

**Fix:** Add `import type { CompiledRule } from "../guidelines/types.js"` to the top of the file.

---

## 2. 🔴 God Function &mdash; Single Responsibility Principle (lines 55&ndash;534)

`runWorkflow` is a single `Effect.gen` spanning **480 lines** performing at least **12 distinct responsibilities**:

| Responsibility | Location |
|---|---|
| Run directory creation &amp; input writing | lines 78&ndash;85 |
| Event bus wiring for engine log writes | lines 90&ndash;92 |
| Guideline loading &amp; rule extraction | lines 94&ndash;113 |
| Skill registry loading | line 115 |
| Max recursion depth resolution | lines 125&ndash;128 |
| Agent task execution with retry/timeout | lines 134&ndash;219 |
| Script task execution with retry | lines 221&ndash;293 |
| Single task dispatch (agent vs script) | lines 295&ndash;311 |
| Workflow orchestration: iteration, when-eval, recursion, templates | lines 313&ndash;512 |
| Token usage tracking via subscriber | lines 313&ndash;320 |
| Result summary writing | lines 502&ndash;506 |
| Error handler with duplicate result writing | lines 517&ndash;529 |

**Principles violated:** Single Responsibility, Interface Segregation.

**Fix:** Decompose into separate modules: an orchestrator, task executors, a guideline extractor, a result writer, and a subscriber for engine log persistence.

---

## 3. 🔴 5+ Indentation Levels &mdash; Deep Nesting (lines 326&ndash;463)

The orchestration `for` loop reaches **8 levels** of nesting:

```
for (task of sortedTasks)           // level 1
  if (task.template)                 // level 2
    for (let i = 0; ...)             // level 3
      if (templateTask.tasks.length) // level 4
        for (subTask of sub)         // level 5
          if (subTask.template)      // level 6
            if (nestedTemplate.tasks.length) // level 7
              for (nestedSubTask...) // level 8
```

**Principle violated:** Clean Code &mdash; "no code should ever have more than 3 indentation levels."

**Fix:** Extract nested blocks into named functions. Use early returns/continues. Apply recursive template expansion instead of manual level-unrolling.

---

## 4. 🔴 Duplicated Recursion-Depth Logic (lines 330&ndash;343, 387&ndash;400)

The exact same 14-line block for max-recursion-depth checking appears **twice**, identical except for variable names:

```typescript
const maxDepth = resolveMaxRecursionDepth()
if (maxDepth !== null) {
  const compoundId = ctx.compoundTaskIds.get(task.name)
  if (compoundId) {
    const depthRow = ctx.db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId) as { depth: number } | null
    if (depthRow && depthRow.depth >= maxDepth) {
      yield* _(ctx.transitionTask(task.name, "fail"))
      const errorMsg = `max recursion depth (${maxDepth}) exceeded`
      yield* _(ctx.fail(errorMsg))
      workflowStatus = "failed"
      break
    }
  }
}
```

**Principle violated:** DRY.

**Fix:** Extract into `checkRecursionDepth(ctx, taskName, maxDepth)` and call from both locations.

---

## 5. 🔴 Duplicated When-Evaluation Logic (lines 345&ndash;357, 403&ndash;415)

The same 12-line CEL `evaluateWhen` + try/catch block appears **twice**:

```typescript
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
```

**Principle violated:** DRY.

**Fix:** Extract into `evaluateWhenOrFail(ctx, task, workflowEnv)` returning an Effect that handles both the skip and fail paths.

---

## 6. 🔴 Direct Database Queries in Orchestration Code (lines 334, 392)

```typescript
const depthRow = ctx.db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId)
```

Raw SQL with `ctx.db.prepare` leaks database implementation details into the workflow orchestrator. `WorkflowRuntime` already provides abstractions (`shouldExecuteTask`, `transitionTask`, etc.) &mdash; depth queries should follow the same pattern.

**Principle violated:** Dependency Inversion (SOLID), Layered Architecture &mdash; orchestration layer should not know about SQL.

**Fix:** Add a `getTaskDepth(taskName: string)` method to `WorkflowRuntime` that encapsulates the query.

---

## 7. 🔴 Half-Baked Event-Driven Architecture (lines 90&ndash;92, 508&ndash;510, 521&ndash;523)

The codebase already has an `EventBus` with subscribers (e.g. `DbWriter` at `src/db/subscribers.ts`), yet `appendEngineLog` is called **directly** as a side effect instead of through an event subscriber:

```typescript
if (fileEnabled) {
  yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.metadata.name }))
}
```

Events like `WorkflowStarted` and `WorkflowCompleted` are fired via the bus but also redundantly written to the engine log directly. An `EngineLogSubscriber` should listen to these events and handle persistence automatically.

**Principle violated:** Observer pattern, Open/Closed (SOLID). If a subscriber already does this, the direct call is dead code. If it doesn&rsquo;t, it should.

**Fix:** Remove all direct `appendEngineLog` calls. Create an `EngineLogSubscriber` that subscribes to `WorkflowStarted`, `WorkflowCompleted`, etc., and writes the log file from the subscriber.

---

## 8. 🔴 Manual Non-Recursive Template Nesting (lines 419&ndash;454)

Template expansion supports `template -> subtask -> nested template` with **manual, explicit code** for each nesting level:

```
if (subTask.template) {
  // handle nested template...
  if (nestedTemplate.tasks && nestedTemplate.tasks.length > 0) {
    // yet another for loop inside
  }
}
```

Currently only 2 levels of template nesting are supported before the code structure breaks down. This should be a **single recursive function** that handles arbitrary nesting depth.

**Principle violated:** Open/Closed (SOLID) &mdash; adding a 3rd nesting level requires rewriting the entire block.

**Fix:** Implement a recursive `expandTemplate(ctx, templateTask, parentName, env, depth)` function that walks the template tree naturally.

---

## 9. 🔴 No Canonical Task-Name Builder (lines 372, 383, 435)

Task instance names are constructed inline with raw string interpolation in **3 separate locations**:

```typescript
const instanceName = `${task.name}/${i}`                        // line 372
const subInstanceName = `${instanceName}-${subTask.name}`        // line 383
const nestedInstanceName = `${subInstanceName}-${nestedSubTask.name}` // line 435
```

No single function like `buildInstanceName(parent, child, iteration?)` exists. The naming convention is fragile and impossible to change consistently.

**Principle violated:** DRY, Single Source of Truth.

**Fix:** Create `buildTaskInstanceName(parent: string, child: string, index?: number): string` in `engine.ts` and use it exclusively.

---

## 10. 🟠 `fileEnabled` Repeated Checks &mdash; Tight Coupling (7 occurrences)

The same `if (fileEnabled)` guard appears **7 times** in the function. The worst offender is lines 508&ndash;509 where it appears twice back-to-back:

```typescript
if (fileEnabled) {
  yield* _(writeSummary(runId, summary))
}
yield* _(bus.publish({ _tag: "WorkflowCompleted", runId }))
if (fileEnabled) {
  yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))
}
```

If both `writeSummary` and `appendEngineLog` were subscribers, this entire block reduces to a single event publish.

**Principle violated:** DRY, Separation of Concerns.

**Fix:** Move file-writing into event subscribers. The orchestrator should only publish events and let subscribers handle persistence.

---

## 11. 🟠 Side-Effect Mutation of `workflowStatus` (10 mutation sites)

`workflowStatus` is a mutable string variable (`let workflowStatus: string = "completed"`) mutated from at least **10 different locations** across multiple nesting levels. Reasoning about state transitions is nearly impossible.

Mutation sites: lines 206, 280, 339, 355, 398, 413 (likely more deeper in template expansion).

**Principle violated:** Clean Code &mdash; avoid mutating shared state.

**Fix:** Model workflow status as an `Effect`-managed `Ref<RunState>` or lift it into the `WorkflowRuntime` state machine, which already tracks `RunState`.

---

## 12. 🟠 Inline Guideline & Rule Extraction (lines 94&ndash;113)

`loadGuidelines` is called, but then 20 lines of nested loops manually iterate over guidelines to extract `guidelineFiles` and `allRules` arrays:

```typescript
const guidelineFiles: Array<{ name: string; content: string }> = []
const allRules: import("../guidelines/types.js").CompiledRule[] = []

for (const g of loadedGuidelines) {
  if (g.instructions) {
    for (const inst of g.instructions) {
      guidelineFiles.push(inst)
    }
  }
  if (g.rules) {
    for (const rule of g.rules) {
      allRules.push(rule)
    }
  }
}
```

**Principle violated:** SRP, Clean Code &mdash; data transformation does not belong in the orchestrator.

**Fix:** Extract into `extractGuidelineArtifacts(loadedGuidelines): { files, rules }`.

---

## 13. 🟡 `WorkflowResult` Return Type Mismatch (line 49 vs 512)

`runWorkflow` declares `Effect.Effect<WorkflowResult, Error, ...>` with `WorkflowResult.env: WorkflowEnv`, but the constructed result at line 512 casts a mutable local `workflowEnv` (carrying runtime properties like `tasks`, `currentIteration`) into a `WorkflowEnv`. The actual runtime shape differs from the declared contract.

**Principle violated:** Type Safety, Design by Contract.

**Fix:** Build a dedicated result object matching the `WorkflowResult` interface exactly, rather than spreading a mutable env bag.

---

## 14. 🟠 Duplicate Retry/Result/Emit Pattern in Task Executors (lines 134&ndash;293)

`executeAgentTask` and `executeScriptTask` share nearly identical retry logic, task result assignment, file writing, and event publishing. The only difference is the execution core (`executeWithPi` vs `ChildProcess.execSync`). Approximately 40 lines are copy-pasted with minor variations.

**Principle violated:** DRY, Template Method pattern.

**Fix:** Extract shared boilerplate (retry, result recording, event publishing, file writing) into a `withTaskLifecycle` helper. Each executor provides only its unique execution logic.

---

## Summary

| Principle | Violation Count |
|---|---|
| Single Responsibility (SRP) | 1 god function with 12+ responsibilities |
| DRY | 4 distinct copy-paste blocks (recursion depth, when-eval, task naming, retry logic) |
| Open/Closed | Template nesting hardcoded, not extensible |
| Dependency Inversion | DB queries leak into orchestration layer |
| Clean Code (nesting) | 8 indentation levels |
| Observer / Event-Driven | Half-baked subscribers, direct `appendEngineLog` calls |
| Layered Architecture | No separation between orchestration, persistence, and execution |
| Type Safety | `WorkflowResult` return type mismatch |

**Bottom line:** `runner.ts` is the canonical "god file" anti-pattern. ~480 lines with 12+ distinct concerns, 4 copy-paste code blocks, 8 levels of nesting, leaked SQL, and a broken event-driven pattern. The fix requires decomposing into at least 6&ndash;8 separate modules: an orchestrator, a recursion guard, a when-evaluator, a template expander, a task-name builder, guideline extractor, and file-write subscribers.
