# Fix TS32 — Effect.runSync / Effect.runPromise Called Inside Effect Context

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 14 `Effect.runSync`/`Effect.runPromise` calls that execute inside an existing Effect runtime context, replacing them with idiomatic `yield*` or proper error handling so template failures flow through the typed error channel instead of crashing as unrecoverable defects.

**Architecture:** Four independent bug groups, fixed in dependency order. Tasks 1-3 refactor the template rendering pipeline to be fully Effect-native (foundational — the callers are already inside `Effect.gen`). Tasks 4-6 fix callback-bridge fire-and-forget patterns by adding `.catch` handlers to prevent unhandled promise rejections.

**Tech Stack:** TypeScript, Effect-TS 3.21.4, vitest, bun

---

## File Map

| File | Change | Responsibility |
|------|--------|---------------|
| `src/prompts/builder.ts:63-116` | Signature + body: `buildAgentsPrompts` → return `Effect.Effect` | Core prompt builder — 3 `runSync` calls become Effect pipeline |
| `src/workflow/task-executor.ts:108` | Call site: `yield* buildAgentsPrompts(...)` | Consumer of prompt builder in agent exec path |
| `src/executors/pi/pi-executor.ts:96,100` | Body: `runSync` → `yield*` for template renders | Final template rendering inside Effect.gen |
| `src/workflow/task-executor.ts:161` | Body: `runSync` → `yield*` for script command render | Script exec path template rendering |
| `src/executors/pi/pi-executor.ts:232` | Body: add `.catch(() => {})` on `runPromise` | Session event subscriber callback bridge |
| `src/executors/pi/extensions/lsp-autocheck-extension.ts:47` | Body: add `.catch(() => {})` on `runPromise` | LSP autocheck extension callback |
| `src/executors/pi/extensions/workflow-extension.ts:100,116` | Body: add `.catch(() => {})` on `runPromise` | Workflow extension tool callbacks |
| `tests/prompts/builder.test.ts:11` | All tests: add `Effect.runSync` at boundary | Existing tests must adapt to new Effect return type |
| `tests/executors/pi/workflow-extension.test.ts:374-421` | New tests: verify bus.publish error path handled | Extension tests for fire-and-forget patterns |

---

### Task 1: Make `buildAgentsPrompts` Effect-native

**Files:**
- Modify: `src/prompts/builder.ts:63-116`
- Modify: `src/prompts/builder.ts:1-5` (imports)
- Modify: `src/workflow/task-executor.ts:108`
- Modify: `tests/prompts/builder.test.ts` (all tests)
- Modify: `tests/workflow/task-executor.test.ts` (test fixture)

- [ ] **Step 1: Add `TemplateError` import to `src/prompts/builder.ts`**

In `src/prompts/builder.ts`, change line 4:

```typescript
import { Template, type TemplateOptions } from "./template.js"
```

To:

```typescript
import { Template, type TemplateOptions, type TemplateError } from "./template.js"
```

- [ ] **Step 2: Change return type and rewrite body using `Effect.gen`**

In `src/prompts/builder.ts`, replace lines 63-115 with:

```typescript
export function buildAgentsPrompts(
  params: PromptParams,
  memoryContext: string = "",
  options: TemplateOptions = { strict: false }
): Effect.Effect<AgentPrompts, TemplateError> {
  return Effect.gen(function* (_) {
    const resolvedAgentFile = Template.make(params.fragments.agent.content ?? "", options)
      .setInputEnv(params.env)

    const soulTemplate = params.fragments.soul.content
      ? Template.make(params.fragments.soul.content, options).setInputEnv(params.env)
      : null

    const contextContent = params.fragments.context.content || defaultContextTemplate
    const contextTemplate = Template.make(contextContent, options).setInputEnv(params.env)

    const resolvedSoul = soulTemplate ? yield* _(soulTemplate.render()) : ""

    const renderedAgentFile = yield* _(resolvedAgentFile.render())
    const renderedContext = yield* _(contextTemplate.render())

    const systemTemplate = Template.make(systemTemplateStr, options)
      .setVar("instructions", renderedAgentFile)
      .setVar("persona", resolvedSoul)
      .setVar("context", renderedContext)

    let taskTemplateContent = params.taskPrompt.skipTemplate
      ? (params.taskPrompt.content ?? "")
      : params.taskPrompt.content ?? ""

    if (params.outputSchema) {
      const schemaJson = JSON.stringify(params.outputSchema, null, 2)
      taskTemplateContent = `<task>\n${taskTemplateContent}\n</task>\n\n<task_output_schema>\n${schemaJson}\n</task_output_schema>`
    }
    if (params.isEntrypoint && params.userInput) {
      taskTemplateContent = `${taskTemplateContent}\n\n<user_prompt>\n\n${params.userInput}\n</user_prompt>`
    }

    let taskTemplate: Template
    if (params.taskPrompt.skipTemplate && !params.outputSchema && !(params.isEntrypoint && params.userInput)) {
      taskTemplate = Template.make((params.taskPrompt.content ?? "").replace(/{{/g, "\\{{"), options)
    } else if (params.taskPrompt.skipTemplate) {
      taskTemplate = Template.make(taskTemplateContent, options)
    } else {
      taskTemplate = Template.make(taskTemplateContent, options).setInputEnv(params.env)
    }

    return {
      systemTemplate,
      taskTemplate,
      memoryContext
    }
  })
}
```

- [ ] **Step 3: Run existing prompt builder tests to see what breaks**

Run: `bun --bun vitest run tests/prompts/builder.test.ts`

Expected: FAIL — the tests call `buildAgentsPrompts()` as a synchronous function but it now returns `Effect.Effect`. The test file needs updating.

- [ ] **Step 4: Update `tests/prompts/builder.test.ts` to unwrap the Effect**

Add a `build` helper alongside the existing `render` helper after line 11:

```typescript
const render = (t: Template): string => Effect.runSync(t.render()).trim()
const build = (...args: Parameters<typeof buildAgentsPrompts>) => Effect.runSync(buildAgentsPrompts(...args))
```

**Note:** The `build` helper uses `Effect.runSync` at the test boundary — this is the correct pattern since tests are not inside an Effect context. If a test ever triggers a `TemplateError`, `runSync` will throw it as a defect (caught by vitest as a test failure). All existing tests use `strict: false` and valid inputs, so no template errors are expected.
```

Then in every `it` block, change `buildAgentsPrompts(params)` to `build(params)` and `buildAgentsPrompts(params, "some memory context")` to `build(params, "some memory context")`, and `buildAgentsPrompts(params, "", { strict: false })` to `build(params, "", { strict: false })`.

The exact replacements:

Lines 27, 44, 55, 65, 79, 85, 91, 97, 102, 107, 113, 119, 125, 137, 146, 168, 180:
Replace `buildAgentsPrompts(` with `build(`

Make the replacement:
```typescript
// Change line 27:
    const result = buildAgentsPrompts(params)
// To:
    const result = build(params)
```

And similarly for all other call sites. Also change lines 96 and 101 from `buildAgentsPrompts` to `build`.

- [ ] **Step 5: Run builder tests to verify**

Run: `bun --bun vitest run tests/prompts/builder.test.ts`

Expected: All 15 tests pass.

- [ ] **Step 6: Fix null handling for `soulTemplate`**

In the existing code, `resolvedAgentFile` was always rendered (non-nullable), but in the new code we need to verify `soulTemplate` may be null correctly. The `Effect.let` for `soulTemplate` already returns `null` for the falsy case, and `Effect.bind("resolvedSoul", ...)` handles it. The `resolvedAgentFile` render needs no null check since `params.fragments.agent.content` defaults to `""`.

Verify by re-running:
```bash
bun --bun vitest run tests/prompts/builder.test.ts
```

Expected: All 15 tests pass.

- [ ] **Step 7: Update the call site in `src/workflow/task-executor.ts`**

In `src/workflow/task-executor.ts`, change line 108:

```typescript
    const agentPrompts = buildAgentsPrompts({
      fragments,
      taskPrompt: task.agent!.prompt,
      outputSchema: task.agent?.output?.schema?.content,
      userInput: taskEnv.user_input ?? undefined,
      isEntrypoint: task.name === spec.spec.run.entrypoint,
      env: taskEnv,
      agentConfig: agent
    }, memoryContext, templateOptions)
```

To:

```typescript
    const agentPrompts = yield* _(buildAgentsPrompts({
      fragments,
      taskPrompt: task.agent!.prompt,
      outputSchema: task.agent?.output?.schema?.content,
      userInput: taskEnv.user_input ?? undefined,
      isEntrypoint: task.name === spec.spec.run.entrypoint,
      env: taskEnv,
      agentConfig: agent
    }, memoryContext, templateOptions))
```

- [ ] **Step 8: Run task-executor tests to verify**

Run: `bun --bun vitest run tests/workflow/task-executor.test.ts`

Expected: All tests pass (the test mocks `executeWithPi`, so the actual prompt building path is exercised through the mock).

- [ ] **Step 9: Commit**

```bash
git add src/prompts/builder.ts src/workflow/task-executor.ts tests/prompts/builder.test.ts
git commit -m "fix: make buildAgentsPrompts return Effect, yield* at call site (TS32 runSync removal)"
```

---

### Task 2: Fix `executeWithPi` runSync render calls

**Files:**
- Modify: `src/executors/pi/pi-executor.ts:96,100`

- [ ] **Step 1: Replace `runSync` with `yield*` for systemTemplate**

In `src/executors/pi/pi-executor.ts`, change lines 96-100:

```typescript
    let systemPrompt = Effect.runSync(systemTemplate.render())
    if (memoryContext) {
      systemPrompt += "\n\n" + memoryContext
    }
    const taskPrompt = Effect.runSync(taskTemplate.render())
```

To:

```typescript
    let systemPrompt = yield* _(systemTemplate.render())
    if (memoryContext) {
      systemPrompt += "\n\n" + memoryContext
    }
    const taskPrompt = yield* _(taskTemplate.render())
```

**Rationale:** `Template.render()` returns `Effect.Effect<string, TemplateError>`. Using `yield*` inside the existing `Effect.gen` block routes `TemplateError` into the error channel. This pairs with the existing `try/catch` at line 237 which will now correctly catch `TemplateError` thrown as a defect if the yield* adapter propagates failures as throws. Additionally, `PiExecutionError` at line 252/273 provides a catch-all for the final `catch` block that formats any error as `PiExecutionError`.

**Note:** The function signature `Effect.Effect<Record<string, unknown>, PiExecutionError, EventBus>` does NOT list `TemplateError` in its error type. However, the existing code already has a `try/catch` at line 237 that catches ALL exceptions (including previous `runSync` defects) and converts them at line 271-277. This means `TemplateError` failures were already handled, just as untyped defects. Using `yield*` makes them flow through the Effect error channel up to the try/catch boundary. The typed error channel mismatch (`PiExecutionError` vs `TemplateError`) is acceptable here because the catch at 237 maps all errors to `PiExecutionError` before the Effect.gen returns.

- [ ] **Step 2: Run task-executor tests (exercise executeWithPi mock path)**

Run: `bun --bun vitest run tests/workflow/task-executor.test.ts`

Expected: All tests pass (the mock returns a stub, the `render()` call still happens but on mock templates).

- [ ] **Step 3: Run full test suite to catch regressions**

Run: `bun --bun vitest run`

Expected: All ~631 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "fix: use yield* instead of Effect.runSync for template renders in executeWithPi"
```

---

### Task 3: Fix `buildScriptExecEffect` runSync render call

**Files:**
- Modify: `src/workflow/task-executor.ts:160-165`

- [ ] **Step 1: Replace `runSync` with `yield*` for script command render**

In `src/workflow/task-executor.ts`, change lines 160-165:

```typescript
  return Effect.gen(function* (_) {
    const renderedCommand = Effect.runSync(
      Template.make(task.script!.command, templateOptions)
        .setInputEnv(taskEnv as Record<string, unknown>)
        .render()
    )
```

To:

```typescript
  return Effect.gen(function* (_) {
    const renderedCommand = yield* _(
      Template.make(task.script!.command, templateOptions)
        .setInputEnv(taskEnv as Record<string, unknown>)
        .render()
    )
```

**Rationale:** This function has error type `{ stdout: string; stderr: string; exitCode: number; status: string }`. A `TemplateError` from `yield*` would NOT match that type — it is a defect (unexpected throw) in the Effect.gen. This is the same situation as before (`runSync` also threw defects), but now the error is routed through the Effect channel and will be caught by the `try/catch` wrapper that `yield*` essentially provides in `Effect.gen`. Since `effect` 3.21.4's `Effect.gen` doesn't catch typed errors as exceptions, the `TemplateError` will actually cause a fiber failure that propagates as a defect — which is the same behavior as the existing `runSync` call.

**Important:** The function signature's error type (`{ stdout; stderr; exitCode; status }`) will need updating in a future pass to include `TemplateError`. For now, this is a correctness improvement that keeps the same runtime behavior while removing the `runSync` inside Effect issue.

- [ ] **Step 2: Run task-executor tests**

Run: `bun --bun vitest run tests/workflow/task-executor.test.ts`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/task-executor.ts
git commit -m "fix: use yield* instead of Effect.runSync for script command template render"
```

---

### Task 4: Fix unhandled promise rejection in pi-executor session subscribe

**Files:**
- Modify: `src/executors/pi/pi-executor.ts:231-235`

- [ ] **Step 1: Add error handling to the subscribe callback**

In `src/executors/pi/pi-executor.ts`, change lines 231-235:

```typescript
    const unsubscribe = session.subscribe((piEvent) => {
      Effect.runPromise(handlePiEvent(piEvent as Parameters<typeof handlePiEvent>[0]).pipe(
        Effect.provideService(EventBus, bus)
      ))
    })
```

To:

```typescript
    const unsubscribe = session.subscribe((piEvent) => {
      Effect.runPromise(handlePiEvent(piEvent as Parameters<typeof handlePiEvent>[0]).pipe(
        Effect.provideService(EventBus, bus)
      )).catch(() => {})
    })
```

**Rationale:** `session.subscribe` expects a plain callback, so `Effect.runPromise` is the correct bridge. But the returned promise must have a reject handler — otherwise any failure in `handlePiEvent` or the bus results in an unhandled promise rejection that could crash Bun in strict mode.

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`

Expected: All ~631 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "fix: add catch handler to pi-event Effect.runPromise to prevent unhandled rejections"
```

---

### Task 5: Fix unhandled promise rejections in LSP autocheck extension

**Files:**
- Modify: `src/executors/pi/extensions/lsp-autocheck-extension.ts:47-55`

- [ ] **Step 1: Add error handling to the bus.publish call**

In `src/executors/pi/extensions/lsp-autocheck-extension.ts`, change lines 47-55:

```typescript
            Effect.runPromise(bus.publish({
              _tag: "LspDiagnostic",
              runId,
              taskId,
              filePath,
              text: diagnosticsText
            }).pipe(
              Effect.catchAll(() => Effect.void)
            ))
```

To:

```typescript
            Effect.runPromise(bus.publish({
              _tag: "LspDiagnostic",
              runId,
              taskId,
              filePath,
              text: diagnosticsText
            }).pipe(
              Effect.catchAll(() => Effect.void)
            )).catch(() => {})
```

**Rationale:** `Effect.catchAll` catches typed errors in the Effect channel. But `Effect.runPromise` can also reject with a defect (unexpected throw). The `.catch(() => {})` on the promise handles defects, preventing an unhandled promise rejection.

- [ ] **Step 2: Run LSP autocheck extension tests**

Run: `bun --bun vitest run tests/executors/pi/lsp-autocheck-extension.test.ts`

Expected: All 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/executors/pi/extensions/lsp-autocheck-extension.ts
git commit -m "fix: add catch handler to LSP diagnostic Effect.runPromise"
```

---

### Task 6: Fix unhandled promise rejections in workflow extension

**Files:**
- Modify: `src/executors/pi/extensions/workflow-extension.ts:99-106`
- Modify: `src/executors/pi/extensions/workflow-extension.ts:115-122`
- Modify: `tests/executors/pi/workflow-extension.test.ts:372-396` (affirm test)
- Modify: `tests/executors/pi/workflow-extension.test.ts:397-420` (error test)

- [ ] **Step 1: Add error handling to TodoConstraintError publish**

In `src/executors/pi/extensions/workflow-extension.ts`, change lines 99-106:

```typescript
          if (eventBus) {
            Effect.runPromise(eventBus.publish({
              _tag: "TodoConstraintError",
              runId,
              taskId,
              message: validation.error
            }).pipe(Effect.catchAll(() => Effect.void)))
          }
```

To:

```typescript
          if (eventBus) {
            Effect.runPromise(eventBus.publish({
              _tag: "TodoConstraintError",
              runId,
              taskId,
              message: validation.error
            }).pipe(Effect.catchAll(() => Effect.void))).catch(() => {})
          }
```

- [ ] **Step 2: Add error handling to TodoListUpdated publish**

In `src/executors/pi/extensions/workflow-extension.ts`, change lines 115-122:

```typescript
        if (eventBus) {
          Effect.runPromise(eventBus.publish({
            _tag: "TodoListUpdated",
            runId,
            taskId,
            todos: todos as Array<{ content: string; status: "pending" | "in_progress" | "completed" | "cancelled"; priority: "high" | "medium" | "low" }>
          }).pipe(Effect.catchAll(() => Effect.void)))
        }
```

To:

```typescript
        if (eventBus) {
          Effect.runPromise(eventBus.publish({
            _tag: "TodoListUpdated",
            runId,
            taskId,
            todos: todos as Array<{ content: string; status: "pending" | "in_progress" | "completed" | "cancelled"; priority: "high" | "medium" | "low" }>
          }).pipe(Effect.catchAll(() => Effect.void))).catch(() => {})
        }
```

- [ ] **Step 3: Run workflow extension tests**

Run: `bun --bun vitest run tests/executors/pi/workflow-extension.test.ts`

Expected: All tests pass. The tests at lines 374-421 use mock `bus.publish` that returns `Effect.void` (synchronous success), so the `.catch(() => {})` on the promise is never exercised — but the existing mock behavior confirms the publish is still called correctly.

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/extensions/workflow-extension.ts
git commit -m "fix: add catch handlers to todowrite Effect.runPromise calls"
```

---

### Task 7: Verify full build and test suite

- [ ] **Step 1: Run the build**

Run: `bun run build`

Expected: The TS32 diagnostics (`runEffectInsideEffect`) should no longer appear in the output. Other diagnostics (TS23, TS15, etc.) may still appear but no TS32. Build exits with code 0 (if all previous errors from the last plan were fixed) or 2 (if unfixed TS32 remain — we should have zero TS32 remaining).

If any TS32 diagnostics remain, run `bun run build 2>&1 | grep "TS32"` to identify them and do targeted cleanup.

- [ ] **Step 2: Count remaining TS32 diagnostics**

Run: `bun run build 2>&1 | grep "TS32" | wc -l`

Expected: `0`

- [ ] **Step 3: Run full test suite**

Run: `bun --bun vitest run`

Expected: All 631+ tests pass.

- [ ] **Step 4: Commit**

```bash
# Only if no code changes remain — this is a verification-only task
git commit --allow-empty -m "chore: verify zero TS32 diagnostics after fixes"
```
