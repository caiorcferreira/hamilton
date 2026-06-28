# Curator Model Resolution Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the curator's hardcoded `"default"` model string so it resolves to the actual default model from settings.

**Architecture:** Extract `readDefaults` and `parseModelString` from `pi-executor.ts` into a shared `src/agent/model-resolution.ts` module. Use these in `curator.ts` to resolve `"default"` before calling the LLM. Also pass the EventBus to `createLLMClient` in the runner so curator token usage is tracked.

**Tech Stack:** TypeScript, Effect-TS, Pi SDK, vitest

---

## Task 1: Extract model resolution to shared module

**Files:**
- Create: `src/agent/model-resolution.ts`
- Modify: `src/executors/pi/pi-executor.ts:56-79`

- [ ] **Step 1: Create `src/agent/model-resolution.ts`**

```typescript
import * as Fs from "node:fs"
import * as Path from "node:path"

export function readDefaults(agentDir: string): { defaultProvider: string; defaultModel: string } {
  try {
    const settingsPath = Path.join(agentDir, "settings.json")
    const raw = Fs.readFileSync(settingsPath, "utf-8")
    const settings = JSON.parse(raw)
    return {
      defaultProvider: settings.defaultProvider ?? "openai",
      defaultModel: settings.defaultModel ?? "glm-5.1"
    }
  } catch {
    return { defaultProvider: "openai", defaultModel: "glm-5.1" }
  }
}

export function parseModelString(
  model: string | undefined,
  defaults: { defaultProvider: string; defaultModel: string }
): [string, string] {
  if (model) {
    const parts = model.split("/")
    if (parts.length === 2) return [parts[0]!, parts[1]!]
  }
  return [defaults.defaultProvider, defaults.defaultModel]
}
```

- [ ] **Step 2: Update `src/executors/pi/pi-executor.ts` to import from new module**

Remove lines 56-79 (the `readDefaults` and `parseModelString` function definitions). Add import at the top (after the existing `import * as Path from "node:path"` on line 19):

```typescript
import { readDefaults, parseModelString } from "../../agent/model-resolution.js"
```

Delete the two function bodies:

```typescript
function readDefaults(agentDir: string): { defaultProvider: string; defaultModel: string } {
  try {
    const settingsPath = Path.join(agentDir, "settings.json")
    const raw = Fs.readFileSync(settingsPath, "utf-8")
    const settings = JSON.parse(raw)
    return {
      defaultProvider: settings.defaultProvider ?? "openai",
      defaultModel: settings.defaultModel ?? "glm-5.1"
    }
  } catch {
    return { defaultProvider: "openai", defaultModel: "glm-5.1" }
  }
}

function parseModelString(
  model: string | undefined,
  defaults: { defaultProvider: string; defaultModel: string }
): [string, string] {
  if (model) {
    const parts = model.split("/")
    if (parts.length === 2) return [parts[0]!, parts[1]!]
  }
  return [defaults.defaultProvider, defaults.defaultModel]
}
```

The rest of `pi-executor.ts` is unchanged since the function signatures and behavior are identical.

- [ ] **Step 3: Run build to verify no import errors**

Run: `bun run build`
Expected: No errors. The pi-executor imports compile correctly.

- [ ] **Step 4: Commit**

```bash
git add src/agent/model-resolution.ts src/executors/pi/pi-executor.ts
git commit -m "refactor: extract model resolution to shared module"
```

---

## Task 2: Use model resolution in curator

**Files:**
- Modify: `src/curator/curator.ts:1,27-33`

- [ ] **Step 1: Add imports to `src/curator/curator.ts`**

Add after line 1 (`import type { LLMClient } from "./llm-client.js"`):

```typescript
import { readDefaults, parseModelString } from "../agent/model-resolution.js"
import { piAgentDir } from "../executors/pi/paths.js"
```

- [ ] **Step 2: Replace hardcoded `"default"/"default"` with resolved model**

Replace lines 29-33:

```typescript
      try {
        const response = await llmClient.complete("default", "default", [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ] as any)
```

With:

```typescript
      try {
        const defaults = readDefaults(piAgentDir())
        const [provider, modelId] = parseModelString("default", defaults)
        const response = await llmClient.complete(provider, modelId, [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ] as any)
```

- [ ] **Step 3: Update curator test to reflect model resolution dependency**

In `tests/curator/curator.test.ts`, the existing tests use mock `LLMClient` instances so they don't actually call `complete`. They verify the structure resilience — the mock throws or returns synthetic data. No test changes needed since the curator interface (`createCurator(llmClient)`) doesn't change.

The existing test at line 31-49 (`"suggestMemoryFilters returns parsed results on success"`) passes a mock client whose `complete` receives whatever provider/modelId the curator passes. Since the test uses a mock, the actual values don't matter — it will still return the seeded response. The test behavior is unchanged.

- [ ] **Step 4: Run build**

Run: `bun run build`
Expected: No errors.

- [ ] **Step 5: Run curator tests**

Run: `bun --bun vitest run tests/curator/curator.test.ts tests/curator/llm-client.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/curator/curator.ts
git commit -m "fix: resolve default model in curator via parseModelString"
```

---

## Task 3: Pass EventBus to curator LLM client

**Files:**
- Modify: `src/workflow/runner.ts:230`

- [ ] **Step 1: Pass bus to `createLLMClient` in runner**

Line 230 currently reads:

```typescript
            const llmClient = createLLMClient()
```

Change it to:

```typescript
            const llmClient = createLLMClient({ bus: yield* _(EventBus) })
```

Note: `EventBus` is already imported at line 14. The `bus` variable is available from line 68 (`const bus = yield* _(EventBus)`) in the outer scope. But inside the `body` Effect (line 142), we don't have direct access to `bus` — we need to yield `EventBus` from the service environment. The `yield* _(EventBus)` pattern is the correct way to get it inside an `Effect.gen`.

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `bun --bun vitest run`
Expected: All 631 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "fix: pass EventBus to curator LLM client for token tracking"
```
