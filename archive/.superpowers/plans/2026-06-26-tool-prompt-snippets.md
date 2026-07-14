# Tool Prompt Snippets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject active tool descriptions into the system prompt dynamically via Pi SDK's native system prompt builder instead of Hamilton's hardcoded tool list.

**Architecture:** Two-line change: remove the hardcoded tool list from `defaultContextTemplate` in `builder.ts`, and swap `systemPromptOverride` for `appendSystemPrompt` in `pi-executor.ts`. Pi SDK builds its own base system prompt with dynamic tool snippets from all registered extensions, then appends Hamilton's platform/instructions/persona/context wrapper.

**Tech Stack:** TypeScript, Effect-TS, bun, Pi SDK

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/prompts/builder.ts:59-64` | Remove tool list from `defaultContextTemplate` | Context template assembly |
| `src/executors/pi/pi-executor.ts:154` | `systemPromptOverride` → `appendSystemPrompt` | Pi SDK session creation |

---

### Task 1: Remove hardcoded tool list from `defaultContextTemplate`

**Files:**
- Modify: `src/prompts/builder.ts:59-64`

- [ ] **Step 1: Replace the default context template**

Open `src/prompts/builder.ts`. Replace lines 59-64:

Before:
```typescript
const defaultContextTemplate = `## Context
- Current directory: {{inputs.parameters.cwd}}
- Available tools:
  - All built-in tools: read, bash, edit, write, grep, find, ls
  - write_task_output: saves your task results (call once when done, input must be a JSON object with 'status' field)
`
```

After:
```typescript
const defaultContextTemplate = `## Context
- Current directory: {{inputs.parameters.cwd}}
`
```

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/prompts/builder.ts
git commit -m "refactor: remove hardcoded tool list from default context template"
```

---

### Task 2: Swap `systemPromptOverride` for `appendSystemPrompt`

**Files:**
- Modify: `src/executors/pi/pi-executor.ts:154`

- [ ] **Step 1: Change the loader option**

Open `src/executors/pi/pi-executor.ts`. On line 154, replace:

```typescript
      systemPromptOverride: () => systemPrompt,
```

With:

```typescript
      appendSystemPrompt: () => systemPrompt,
```

The `systemPrompt` variable is already defined earlier in the function (the rendered Handlebars output from `systemTemplate.render()`). Pi SDK now builds its own base system prompt with tool snippets from all registered `ToolDefinition.promptSnippet` values, then appends Hamilton's content.

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun --bun vitest run`
Expected: same 3 pre-existing builder test failures, all other tests pass (521/524)

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "feat: use appendSystemPrompt for dynamic tool snippet injection"
```

---

## Verification Checklist

After both tasks complete:
1. `bun run build` passes
2. `bun --bun vitest run` — 521/524 pass (same 3 pre-existing builder failures)
3. `grep -n "Available tools" src/prompts/builder.ts` — zero matches
4. `grep -n "systemPromptOverride" src/executors/pi/pi-executor.ts` — zero matches
5. `grep -n "appendSystemPrompt" src/executors/pi/pi-executor.ts` — one match on line 154
