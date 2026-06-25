# Pi SDK: OpenAI Completions maxTokens Fallback

**Patched file:** `node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js`  
**Pi SDK version:** 0.78.1  
**Pi SDK issue:** https://github.com/earendil-works/pi/issues/5595

## Problem

The OpenAI completions provider (`buildParams`) only sets `max_tokens` / `max_completion_tokens` in the API request when `options.maxTokens` is explicitly set. It never falls back to `model.maxTokens`.

The Pi agent loop (`createLoopConfig` in `pi-agent-core`) includes the full model object but never extracts `model.maxTokens` as a standalone `options.maxTokens` key. This means the OpenAI completions request is sent with **no max_tokens field**, causing the GenPlat API gateway to apply its default of **2048 output tokens**.

The Anthropic provider already handles this correctly with `options?.maxTokens ?? model.maxTokens`.

## Fix

Line 406 of `openai-completions.js` — use `?? model.maxTokens` as fallback:

```js
// Before
if (options?.maxTokens) {
    params.max_tokens = options.maxTokens;

// After
if (options?.maxTokens ?? model.maxTokens) {
    params.max_tokens = options.maxTokens ?? model.maxTokens;
```

## Revert

Remove this patch after upgrading to a Pi SDK version that includes the fix from issue #5595.
