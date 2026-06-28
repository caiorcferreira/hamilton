# Remove guidelineFiles, Add memoryContext to PromptBuilt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the vestigial `guidelineFiles` field from `PromptBuilt` event and the prompt pipeline, replacing it with the actual `memoryContext` string that was injected into the system prompt.

**Architecture:** A data plumbing change — `guidelineFiles` was always `[]` in the memory-based path. We remove the dead field from types, interfaces, and event publishing, then add `memoryContext` (the full rendered memory text) to the `PromptBuilt` event so observers can see what memories influenced a task.

**Tech Stack:** TypeScript, bun, Effect-TS, vitest

---

## File Map

| File | Role | Action |
|---|---|---|
| `src/events/bus.ts:27` | `PromptBuilt` event type | Replace `guidelineFiles` with `memoryContext` |
| `src/prompts/types.ts:3-8` | `ResolvablePrompt` interface | Remove `guidelineFiles` |
| `src/prompts/builder.ts:18-23,64-68,112-117` | `AgentPrompts`, `buildAgentsPrompts` | Remove `guidelineFiles`, simplify param |
| `src/executors/pi/pi-executor.ts:116,126-133` | `executeWithPi` config destructure + event publish | Remove `guidelineFiles`, publish `memoryContext` |
| `src/workflow/task-executor.ts:129` | `executeWithPi` call | Remove `guidelineFiles` from config |
| `src/observability/subscribers.ts:43-44` | `formatForFile` case | Replace `guideline_files` with `memory_context` |
| `tests/prompts/builder.test.ts:96-105,137` | `buildAgentsPrompts` tests | Remove 2 `guidelineFiles` tests, update call |
| `tests/observability/subscribers.test.ts:35-38` | `formatForFile` test case | Replace `guidelineFiles` with `memoryContext` |
| `tests/workflow/runner.test.ts:24` | PI executor mock | Replace `guidelineFiles` with `memoryContext` |
| `tests/workflow/runner-regression.test.ts:24,113,174-175` | PI executor mock + assertions | Replace `guidelineFiles` with `memoryContext` |
| `tests/workflow/runner-recursion.test.ts:23` | PI executor mock | Replace `guidelineFiles` with `memoryContext` |
| `tests/workflow/task-executor.test.ts:27,196,231,292` | PI executor mock (4 overrides) | Replace `guidelineFiles: []` with `memoryContext: ""` |

---

### Task 1: Update `PromptBuilt` event type

**Files:** Modify `src/events/bus.ts:27`

- [ ] **Replace `guidelineFiles` with `memoryContext` in `PromptBuilt` event type**

```typescript
  | { readonly _tag: "PromptBuilt"; readonly runId: string; readonly taskId: string; readonly systemPrompt: string; readonly taskPrompt: string; readonly memoryContext: string }
```

---

### Task 2: Update `ResolvablePrompt` interface

**Files:** Modify `src/prompts/types.ts:6`

- [ ] **Remove `guidelineFiles` from `ResolvablePrompt`**

```typescript
import type { Template } from "./template.js"

export interface ResolvablePrompt {
  systemTemplate: Template
  taskTemplate: Template
  memoryContext: string
}
```

---

### Task 3: Update `AgentPrompts` and `buildAgentsPrompts`

**Files:** Modify `src/prompts/builder.ts:18-23,64-68,112-117`

- [ ] **Remove `guidelineFiles` from `AgentPrompts` interface**

Lines 21 should be removed from:
```typescript
export interface AgentPrompts {
  systemTemplate: Template
  taskTemplate: Template
  guidelineFiles: Array<{ name: string; content: string }>
  memoryContext: string
}
```
to:
```typescript
export interface AgentPrompts {
  systemTemplate: Template
  taskTemplate: Template
  memoryContext: string
}
```

- [ ] **Simplify `buildAgentsPrompts` signature and body**

Change signature:
```typescript
export function buildAgentsPrompts(
  params: PromptParams,
  memoryContext: string = "",
  options: TemplateOptions = { strict: false }
): AgentPrompts {
```

Replace the return statement (lines 112-117):
```typescript
  return {
    systemTemplate,
    taskTemplate,
    guidelineFiles: typeof guidelineFiles === "string" ? [] : guidelineFiles,
    memoryContext: typeof guidelineFiles === "string" ? guidelineFiles : ""
  }
```
with:
```typescript
  return {
    systemTemplate,
    taskTemplate,
    memoryContext
  }
```

---

### Task 4: Update `executeWithPi` config and event publish

**Files:** Modify `src/executors/pi/pi-executor.ts:116,126-133`

- [ ] **Destructure only `memoryContext` from config.prompt**

Line 116 changes from:
```typescript
    const { systemTemplate, taskTemplate, guidelineFiles, memoryContext } = config.prompt
```
to:
```typescript
    const { systemTemplate, taskTemplate, memoryContext } = config.prompt
```

- [ ] **Publish `memoryContext` in event instead of `guidelineFiles`**

Lines 126-133 change from:
```typescript
    yield* _(bus.publish({
      _tag: "PromptBuilt",
      runId: config.runId,
      taskId: config.taskId,
      systemPrompt,
      taskPrompt,
      guidelineFiles: guidelineFiles.map(g => g.name)
    }))
```
to:
```typescript
    yield* _(bus.publish({
      _tag: "PromptBuilt",
      runId: config.runId,
      taskId: config.taskId,
      systemPrompt,
      taskPrompt,
      memoryContext
    }))
```

---

### Task 5: Remove `guidelineFiles` from `executeWithPi` call in task executor

**Files:** Modify `src/workflow/task-executor.ts:129`

- [ ] **Drop `guidelineFiles` from the config object passed to `executeWithPi`**

Lines 126-131 change from:
```typescript
        prompt: {
          systemTemplate: agentPrompts.systemTemplate,
          taskTemplate: agentPrompts.taskTemplate,
          guidelineFiles: agentPrompts.guidelineFiles,
          memoryContext: agentPrompts.memoryContext
        },
```
to:
```typescript
        prompt: {
          systemTemplate: agentPrompts.systemTemplate,
          taskTemplate: agentPrompts.taskTemplate,
          memoryContext: agentPrompts.memoryContext
        },
```

- [ ] **Run build to verify no type errors**

```bash
bun run build
```
Expected: clean build, no type errors.

---

### Task 6: Update `formatForFile` subscriber

**Files:** Modify `src/observability/subscribers.ts:43-44`

- [ ] **Replace `guideline_files` with `memory_context` in `PromptBuilt` case**

Line 44 changes from:
```typescript
      return { event: "prompt_built", task_id: event.taskId, system_prompt: event.systemPrompt, task_prompt: event.taskPrompt, guideline_files: event.guidelineFiles }
```
to:
```typescript
      return { event: "prompt_built", task_id: event.taskId, system_prompt: event.systemPrompt, task_prompt: event.taskPrompt, memory_context: event.memoryContext }
```

- [ ] **Run build to verify**

```bash
bun run build
```
Expected: clean build.

---

### Task 7: Fix `builder.test.ts`

**Files:** Modify `tests/prompts/builder.test.ts:96-105,137`

- [ ] **Remove the two `guidelineFiles` tests (lines 96-105)**

Delete:
```typescript
  it("passes guidelineFiles through to AgentPrompts", () => {
    const instructions = [{ name: "typescript", content: "Use strict mode" }]
    const result = buildAgentsPrompts(baseParams, instructions)
    expect(result.guidelineFiles).toEqual(instructions)
  })

  it("defaults guidelineFiles to empty array", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.guidelineFiles).toEqual([])
  })
```

- [ ] **Add a test that `memoryContext` is passed through to `AgentPrompts`**

In their place, add:
```typescript
  it("passes memoryContext through to AgentPrompts", () => {
    const result = buildAgentsPrompts(baseParams, "some memory context")
    expect(result.memoryContext).toBe("some memory context")
  })

  it("defaults memoryContext to empty string", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.memoryContext).toBe("")
  })
```

- [ ] **Update the `TemplateOptions` test call (line 137)**

Change:
```typescript
    const result = buildAgentsPrompts(params, [], { strict: false })
```
to:
```typescript
    const result = buildAgentsPrompts(params, "", { strict: false })
```

- [ ] **Run builder tests**

```bash
bun --bun vitest run tests/prompts/builder.test.ts
```
Expected: all tests pass.

---

### Task 8: Fix `subscribers.test.ts`

**Files:** Modify `tests/observability/subscribers.test.ts:35-38`

- [ ] **Replace `guidelineFiles` with `memoryContext` in the `PromptBuilt` test case**

Lines 36-37 change from:
```typescript
      input: { _tag: "PromptBuilt", runId: "r1", taskId: "t1", systemPrompt: "sys", taskPrompt: "tsk", guidelineFiles: ["g1.md", "g2.md"] },
      expected: { event: "prompt_built", task_id: "t1", system_prompt: "sys", task_prompt: "tsk", guideline_files: ["g1.md", "g2.md"] },
```
to:
```typescript
      input: { _tag: "PromptBuilt", runId: "r1", taskId: "t1", systemPrompt: "sys", taskPrompt: "tsk", memoryContext: "injected memory" },
      expected: { event: "prompt_built", task_id: "t1", system_prompt: "sys", task_prompt: "tsk", memory_context: "injected memory" },
```

- [ ] **Run subscribers tests**

```bash
bun --bun vitest run tests/observability/subscribers.test.ts
```
Expected: all tests pass.

---

### Task 9: Fix `runner.test.ts` mock

**Files:** Modify `tests/workflow/runner.test.ts:24`

- [ ] **Replace `guidelineFiles` with `memoryContext` in PI executor mock**

Line 24 changes from:
```typescript
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
```
to:
```typescript
          memoryContext: config.prompt?.memoryContext ?? ""
```

- [ ] **Run runner tests**

```bash
bun --bun vitest run tests/workflow/runner.test.ts
```
Expected: all tests pass.

---

### Task 10: Fix `runner-regression.test.ts` mock and assertions

**Files:** Modify `tests/workflow/runner-regression.test.ts:24,113,174-175`

- [ ] **Replace `guidelineFiles` with `memoryContext` in PI executor mock**

Line 24 changes from:
```typescript
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
```
to:
```typescript
          memoryContext: config.prompt?.memoryContext ?? ""
```

- [ ] **Update assertion on line 113**

Change:
```typescript
      expect(Array.isArray(promptBuilt.guidelineFiles)).toBe(true)
```
to:
```typescript
      expect(typeof promptBuilt.memoryContext).toBe("string")
```

- [ ] **Update JSONL log assertions on lines 174-175**

Change:
```typescript
          expect(parsed).toHaveProperty("guideline_files")
          expect(Array.isArray(parsed.guideline_files)).toBe(true)
```
to:
```typescript
          expect(parsed).toHaveProperty("memory_context")
          expect(typeof parsed.memory_context).toBe("string")
```

- [ ] **Run regression tests**

```bash
bun --bun vitest run tests/workflow/runner-regression.test.ts
```
Expected: all tests pass.

---

### Task 11: Fix `runner-recursion.test.ts` mock

**Files:** Modify `tests/workflow/runner-recursion.test.ts:23`

- [ ] **Replace `guidelineFiles` with `memoryContext` in PI executor mock**

Line 23 changes from:
```typescript
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
```
to:
```typescript
          memoryContext: config.prompt?.memoryContext ?? ""
```

- [ ] **Run recursion tests**

```bash
bun --bun vitest run tests/workflow/runner-recursion.test.ts
```
Expected: all tests pass.

---

### Task 12: Fix `task-executor.test.ts` mocks

**Files:** Modify `tests/workflow/task-executor.test.ts:27,196,231,292`

- [ ] **Replace all 4 occurrences of `guidelineFiles: []` with `memoryContext: ""`**

Line 27:
```typescript
          memoryContext: ""
```

Line 196:
```typescript
          memoryContext: ""
```

Line 231:
```typescript
          memoryContext: ""
```

Line 292:
```typescript
          memoryContext: ""
```

- [ ] **Run task executor tests**

```bash
bun --bun vitest run tests/workflow/task-executor.test.ts
```
Expected: all tests pass.

---

### Task 13: Full test suite and final verification

- [ ] **Run full test suite**

```bash
bun --bun vitest run
```
Expected: 631 tests pass.

- [ ] **Run build one final time**

```bash
bun run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add src/events/bus.ts src/prompts/types.ts src/prompts/builder.ts src/executors/pi/pi-executor.ts src/workflow/task-executor.ts src/observability/subscribers.ts tests/prompts/builder.test.ts tests/observability/subscribers.test.ts tests/workflow/runner.test.ts tests/workflow/runner-regression.test.ts tests/workflow/runner-recursion.test.ts tests/workflow/task-executor.test.ts
git commit -m "refactor: remove guidelineFiles, add memoryContext to PromptBuilt event"
```
