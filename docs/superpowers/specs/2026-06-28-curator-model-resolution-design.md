# Curator Model Resolution Bug Fix

## Problem

The curator in `src/curator/curator.ts:30` calls `llmClient.complete("default", "default", [...])` with hardcoded `"default"` as provider and model ID. The user's `models.json` only contains `glm-5.1` and `deepseek-v4-pro-official` — `"default"` is not a valid model. The call fails silently (caught at `curator.ts:58`), empty filters are returned, and memory injection is skipped entirely.

Three layers of error swallowing hide the failure:
1. `curator.ts:58` — returns empty filters on any curator LLM failure
2. `store.ts:128` — returns `[]` on any qmd search failure (empty query throws)
3. `llm-client.ts:34-42` — token usage only emitted if `bus` is passed; runner doesn't pass it

## Solution

Reuse `parseModelString` and `readDefaults` to resolve `"default"` to the actual default model from `~/.hamilton/executors/pi/agent/settings.json`.

## Changes

### 1. Extract model resolution utilities to shared module

**New file `src/agent/model-resolution.ts`**:

Move `readDefaults` and `parseModelString` out of `src/executors/pi/pi-executor.ts`. Export both functions.

```typescript
export function readDefaults(agentDir: string): { defaultProvider: string; defaultModel: string }
export function parseModelString(model: string | undefined, defaults: { defaultProvider: string; defaultModel: string }): [string, string]
```

`pi-executor.ts` imports from `model-resolution.ts` instead — no behavioral change there.

### 2. Use model resolution in curator

**`src/curator/curator.ts`** — resolve `"default"` before calling the LLM:

```typescript
const defaults = readDefaults(piAgentDir())
const [provider, modelId] = parseModelString("default", defaults)
const response = await llmClient.complete(provider, modelId, [...])
```

### 3. Pass EventBus to curator LLM client

**`src/workflow/runner.ts:230`** — pass the EventBus so curator token usage is tracked:

```typescript
const llmClient = createLLMClient({ bus: yield* _(EventBus) })
```

## Files touched

| File | Change |
|------|--------|
| `src/agent/model-resolution.ts` | **New** — extracted `readDefaults`, `parseModelString` |
| `src/executors/pi/pi-executor.ts` | Import from `model-resolution.ts` instead of inline |
| `src/curator/curator.ts` | Use `readDefaults` + `parseModelString` instead of `"default"` |
| `src/workflow/runner.ts` | Pass `bus` to `createLLMClient` |
