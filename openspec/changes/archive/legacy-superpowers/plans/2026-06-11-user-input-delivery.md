# User Input Delivery Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee user input reaches the entrypoint agent regardless of prompt template content, by wrapping the entrypoint task prompt and renaming the context key from `task` to `user_input`.

**Architecture:** Two changes: (1) rename the initial context key in the CLI from `task` to `user_input`, (2) in the runner, after `buildAgentPrompt` renders the entrypoint task's prompt, append a `# User input` section containing `runningContext.user_input`. The builder stays pure; wrapping is a runner concern. Entrypoint detection via `task.name === spec.spec.run.entrypoint` is variant-safe.

**Tech Stack:** TypeScript, bun, Effect-TS, vitest

---

## File Map

| File | Role | Change |
|---|---|---|
| `src/cli/commands/run.ts` | CLI entry point | Rename context key `task` → `user_input` |
| `src/workflow/runner.ts` | DAG executor | Wrap entrypoint prompt |
| `tests/workflow/runner-regression.test.ts` | Runner integration tests | Add wrapping assertion, update `{ task: ... }` → `{ user_input: ... }` |
| `bundle/workflows/feature-dev/workflow.yml` | Bundled workflow | Remove `{{task}}` from all prompts |
| `bundle/workflows/do/workflow.yml` | Bundled workflow | Remove `{{task}}` from entrypoint prompt |
| `bundle/workflows/bug-fix/workflow.yml` | Bundled workflow | Remove `{{task}}` from all prompts |
| `bundle/workflows/quarantine-broken-tests/workflow.yml` | Bundled workflow | Remove `{{task}}` from all prompts |
| `bundle/workflows/security-audit/workflow.yml` | Bundled workflow | Remove `{{task}}` from all prompts |
| `bundle/workflows/scaffold/workflow.yml` | Bundled workflow | Remove `{{task}}` from entrypoint prompt |
| `tests/fixtures/feature-dev.yml` | Test fixture | Remove `{{task}}` from entrypoint prompt |

---

### Task 1: Rename context key in CLI

**Files:**
- Modify: `src/cli/commands/run.ts:68`

- [ ] **Step 1: Change `task` to `user_input` in `executeRun`**

In `src/cli/commands/run.ts`, find the `runWorkflow` call:

```typescript
runWorkflow(spec, { task: params.prompt }, ...)
```

Change to:

```typescript
runWorkflow(spec, { user_input: params.prompt }, ...)
```

- [ ] **Step 2: Build to verify no type errors**

Run: `bun run build`
Expected: exit 0, no errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/run.ts
git commit -m "feat: rename initial context key task -> user_input"
```

---

### Task 2: Add entrypoint wrapping test

**Files:**
- Modify: `tests/workflow/runner-regression.test.ts:72-103`

- [ ] **Step 1: Add a test that verifies entrypoint task prompt is wrapped**

Add this test inside the existing `describe("runWorkflow regression tests", ...)` block, after the existing PromptBuilt test. The test creates a workflow where the entrypoint task prompt has NO `{{user_input}}` reference, then asserts the `taskPrompt` in the `PromptBuilt` event contains `# User input`:

```typescript
it("wraps entrypoint task prompt with user input section", async () => {
  const events: Event[] = []

  const result = await Effect.runPromiseExit(
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
        return yield* _(runWorkflow(testSpec, { user_input: "build a login page" }, {
          workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
        }))
      })
    ).pipe(Effect.provide(EventBusLive))
  )

  expect(Exit.isSuccess(result)).toBe(true)

  const promptBuilt = events.find((e) => e._tag === "PromptBuilt")
  expect(promptBuilt).toBeDefined()
  if (promptBuilt && promptBuilt._tag === "PromptBuilt") {
    expect(promptBuilt.taskPrompt).toContain("# User input")
    expect(promptBuilt.taskPrompt).toContain("build a login page")
  }
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun --bun vitest run tests/workflow/runner-regression.test.ts`
Expected: the new test FAILS — entrypoint prompt does not contain `# User input`

- [ ] **Step 3: Commit**

```bash
git add tests/workflow/runner-regression.test.ts
git commit -m "test: add failing test for entrypoint prompt wrapping"
```

---

### Task 3: Add entrypoint wrapping logic in runner

**Files:**
- Modify: `src/workflow/runner.ts:135-160`

- [ ] **Step 1: Wrap entrypoint prompt after `buildAgentPrompt`**

In `src/workflow/runner.ts`, after `buildAgentPrompt` returns and before the `PromptBuilt` event, insert wrapping logic. Replace lines 135-150 (from `const prompt = buildAgentPrompt` through the `PromptBuilt` event) with:

```typescript
        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          prompt: task.agent!.prompt,
          context: taskContext,
          agentConfig: agent
        }, guidelineFiles)

        const finalPrompt = task.name === spec.spec.run.entrypoint
          ? { ...prompt, taskPrompt: `${prompt.taskPrompt}\n\n# User input\n\n${runningContext.user_input}` }
          : prompt

        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId,
          taskId,
          systemPrompt: finalPrompt.systemPrompt,
          taskPrompt: finalPrompt.taskPrompt,
          guidelineFiles: guidelineFiles.map(g => g.name)
        }))
```

Then on line 160, change `prompt` to `finalPrompt` in the `executeWithPi` call:

```typescript
        const output = yield* _(
          executeWithPi({
            prompt: finalPrompt,
```

- [ ] **Step 2: Build to verify no type errors**

Run: `bun run build`
Expected: exit 0

- [ ] **Step 3: Run tests to verify wrapping passes**

Run: `bun --bun vitest run tests/workflow/runner-regression.test.ts`
Expected: all tests PASS, including the new wrapping test

- [ ] **Step 4: Run full test suite to check for regressions**

Run: `bun --bun vitest run`
Expected: 155 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "feat: wrap entrypoint task prompt with user input section"
```

---

### Task 4: Update test context key references

**Files:**
- Modify: `tests/workflow/runner-regression.test.ts:86, 110, 158, 183`

- [ ] **Step 1: Change all `{ task: "test" }` to `{ user_input: "test" }` in regression tests**

There are four occurrences in `tests/workflow/runner-regression.test.ts`:

- Line 86: `runWorkflow(testSpec, { task: "test" }, {` → `runWorkflow(testSpec, { user_input: "test" }, {`
- Line 110: `runWorkflow(testSpec, { task: "test" }, {` → `runWorkflow(testSpec, { user_input: "test" }, {`
- Line 158: `runWorkflow(testSpec, { task: "test" }, {` → `runWorkflow(testSpec, { user_input: "test" }, {`
- Line 183: `runWorkflow(testSpec, { task: "test" }, {` → `runWorkflow(testSpec, { user_input: "test" }, {`

- [ ] **Step 2: Run regression tests**

Run: `bun --bun vitest run tests/workflow/runner-regression.test.ts`
Expected: all tests PASS

- [ ] **Step 3: Check for any other `{ task:` references in tests that pass initial context**

Run: `grep -n '{ task:' tests/ -r`
Expected: no remaining `{ task:` in initial context calls

- [ ] **Step 4: Commit**

```bash
git add tests/workflow/runner-regression.test.ts
git commit -m "test: update context key task -> user_input in regression tests"
```

---

### Task 5: Remove `{{task}}` from `bundle/workflows/feature-dev/workflow.yml`

**Files:**
- Modify: `bundle/workflows/feature-dev/workflow.yml`

- [ ] **Step 1: Remove `{{task}}` from all prompts**

Remove the `TASK:` / `{{task}}` sections from five places:

**Entrypoint `plan` (lines 34-35):** Remove `TASK:\n{{task}}\n` — these 2 lines. The prompt starts with "Decompose the following task..." which still makes sense contextually.

```yaml
          content: |
            Decompose the following task into ordered user stories for autonomous execution.

            RETRY FEEDBACK (only present if your previous attempt was rejected — read carefully and fix specifically what it complains about):
```

**Downstream `setup` (lines 74-75):** Remove `TASK:\n{{task}}\n` — these 2 lines.

```yaml
            Prepare the development environment for this feature.

            REPO: {{tasks.plan.outputs.repo}}
```

**Downstream `implement-story` (lines 119-120):** Remove `TASK (overall):\n{{task}}\n` — these 2 lines.

```yaml
            Implement the following user story. You are working on ONE story in a fresh session.

            REPO: {{tasks.plan.outputs.repo}}
```

**Downstream `verify-story` (lines 181-182):** Remove `TASK (overall):\n{{task}}\n` — these 2 lines.

```yaml
            Verify the developer's work on this story.

            REPO: {{tasks.plan.outputs.repo}}
```

**Downstream `test` (lines 245-246):** Remove `TASK:\n{{task}}\n` — these 2 lines.

```yaml
            Integration and E2E testing of the implementation.

            REPO: {{tasks.plan.outputs.repo}}
```

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/feature-dev/workflow.yml
git commit -m "feat: remove {{task}} from feature-dev workflow prompts"
```

---

### Task 6: Remove `{{task}}` from `bundle/workflows/do/workflow.yml`

**Files:**
- Modify: `bundle/workflows/do/workflow.yml`

- [ ] **Step 1: Remove `{{task}}` from entrypoint `execute` prompt**

The entrypoint is `execute` (line 12). Lines 24-25 are:

```yaml
             TASK:
             {{task}}
```

Remove these 2 lines. The prompt becomes:

```yaml
           content: |
             Execute the following task end-to-end.

             Instructions:
```

- [ ] **Step 2: Verify removal is clean**

Run: `grep '{{task}}' bundle/workflows/do/workflow.yml`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/do/workflow.yml
git commit -m "feat: remove {{task}} from do workflow prompt"
```

---

### Task 7: Remove `{{task}}` from `bundle/workflows/bug-fix/workflow.yml`

**Files:**
- Modify: `bundle/workflows/bug-fix/workflow.yml`

- [ ] **Step 1: Remove `{{task}}` from all prompts (4 locations)**

Entrypoint `triage` (lines 29-30): Remove `BUG REPORT:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Triage the following bug report. Explore the codebase, reproduce the issue, and classify severity.

             Instructions:
```

Downstream `investigate` (lines 62-63): Remove `BUG REPORT:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Investigate the root cause of this bug.

             REPO: {{tasks.triage.outputs.repo}}
```

Downstream `fix` (lines 126-127): Remove `BUG REPORT:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Implement the bug fix.

             REPO: {{tasks.triage.outputs.repo}}
```

Downstream `verify` (lines 171-172): Remove `BUG REPORT:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Verify the bug fix is correct and complete.

             REPO: {{tasks.triage.outputs.repo}}
```

- [ ] **Step 2: Verify removal is clean**

Run: `grep '{{task}}' bundle/workflows/bug-fix/workflow.yml`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/bug-fix/workflow.yml
git commit -m "feat: remove {{task}} from bug-fix workflow prompts"
```

---

### Task 8: Remove `{{task}}` from `bundle/workflows/quarantine-broken-tests/workflow.yml`

**Files:**
- Modify: `bundle/workflows/quarantine-broken-tests/workflow.yml`

- [ ] **Step 1: Remove `{{task}}` from all prompts (3 locations)**

Entrypoint `setup` (lines 38-39): Remove `TASK:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Prepare the environment for test quarantine.

             REPO: {{tasks.setup.outputs.repo}}
```

Downstream `quarantine` (lines 76-77): Remove `TASK:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Find and disable failing tests until the test suite passes.

             REPO: {{tasks.setup.outputs.repo}}
```

Downstream `verify` (lines 121-122): Remove `TASK:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Verify the quarantiner's work — confirm all tests pass and only test files were modified.

             REPO: {{tasks.setup.outputs.repo}}
```

- [ ] **Step 2: Verify removal is clean**

Run: `grep '{{task}}' bundle/workflows/quarantine-broken-tests/workflow.yml`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/quarantine-broken-tests/workflow.yml
git commit -m "feat: remove {{task}} from quarantine-broken-tests workflow prompts"
```

---

### Task 9: Remove `{{task}}` from `bundle/workflows/security-audit/workflow.yml`

**Files:**
- Modify: `bundle/workflows/security-audit/workflow.yml`

- [ ] **Step 1: Remove `{{task}}` from all prompts (4 locations)**

Entrypoint `scan` (lines 33-34): Remove `TASK:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Perform a comprehensive security audit of the codebase.

             Instructions:
```

Downstream `prioritize` (lines 77-78): Remove `TASK:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Prioritize and group the security findings into a fix plan.

             REPO: {{tasks.scan.outputs.repo}}
```

Downstream `fix-story` (lines 157-158): Remove `TASK (overall):\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Implement a security fix. You are working on ONE fix in a fresh session.

             REPO: {{tasks.scan.outputs.repo}}
```

Downstream `test` (lines 271-272): Remove `TASK:\n{{task}}\n` — 2 lines. The prompt becomes:

```yaml
             Final integration testing after all security fixes.

             REPO: {{tasks.scan.outputs.repo}}
```

- [ ] **Step 2: Verify removal is clean**

Run: `grep '{{task}}' bundle/workflows/security-audit/workflow.yml`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/security-audit/workflow.yml
git commit -m "feat: remove {{task}} from security-audit workflow prompts"
```

---

### Task 10: Remove `{{task}}` from `bundle/workflows/scaffold/workflow.yml`

**Files:**
- Modify: `bundle/workflows/scaffold/workflow.yml`

- [ ] **Step 1: Remove `{{task}}` from entrypoint `scaffold` prompt**

Lines 24-25 are:

```yaml
             TASK:
             {{task}}
```

Remove these 2 lines. The prompt becomes:

```yaml
           content: |
             Scaffold a new project based on the following requirements.

             Instructions:
```

- [ ] **Step 2: Verify removal is clean**

Run: `grep '{{task}}' bundle/workflows/scaffold/workflow.yml`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/scaffold/workflow.yml
git commit -m "feat: remove {{task}} from scaffold workflow prompt"
```

---

### Task 11: Remove `{{task}}` from `tests/fixtures/feature-dev.yml`

**Files:**
- Modify: `tests/fixtures/feature-dev.yml`

- [ ] **Step 1: Remove `{{task}}` from entrypoint `plan` prompt**

Lines 21-22 currently:
```yaml
             TASK:
             {{task}}
```
Remove these 2 lines. The prompt becomes:
```yaml
             Decompose the task.
```

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/feature-dev.yml
git commit -m "feat: remove {{task}} from test fixture"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun --bun vitest run`
Expected: 155 tests pass

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: exit 0

- [ ] **Step 3: Verify no `{{task}}` remains in source YAMLs**

Run: `grep -r '{{task}}' bundle/ tests/fixtures/`
Expected: no output

- [ ] **Step 4: Verify no `{ task:` remains as initial context in source**

Run: `grep -rn '{ task:' src/`
Expected: no output (this should only appear in `run.ts` which we already changed)
