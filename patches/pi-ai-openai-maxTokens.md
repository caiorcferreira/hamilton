# Pi SDK: OpenAI Completions maxTokens Fallback

**Patched files (2 copies):**  
1. `node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js`  
2. `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js`  

**Pi SDK version:** 0.78.1  
**Pi SDK issue:** https://github.com/earendil-works/pi/issues/5595

## Problem

The OpenAI completions provider (`buildParams`) only sets `max_tokens` / `max_completion_tokens` in the API request when `options.maxTokens` is explicitly set. It never falls back to `model.maxTokens`.

The Pi agent loop (`createLoopConfig` in `pi-agent-core`) includes the full model object but never extracts `model.maxTokens` as a standalone `options.maxTokens` key. This means the OpenAI completions request is sent with **no max_tokens field**, causing the GenPlat API gateway to apply its default of **2048 output tokens**.

The Anthropic provider already handles this correctly with `options?.maxTokens ?? model.maxTokens`.

**Important:** `pi-coding-agent` bundles its own nested copy of `pi-ai` in its own `node_modules`. This is the copy loaded at runtime, not the top-level one. Both copies must be patched.

## Fix (three parts)

### Part 1: node_modules patch (both copies)

Line 406 of `openai-completions.js` — use `?? model.maxTokens` as fallback:

```js
// Before
if (options?.maxTokens) {
    params.max_tokens = options.maxTokens;

// After
if (options?.maxTokens ?? model.maxTokens) {
    params.max_tokens = options.maxTokens ?? model.maxTokens;
```

Apply to BOTH:
- `node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js`
- `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js`

### Part 2: models.json compat override

The `detectCompat` function sets `maxTokensField` to `"max_completion_tokens"` for URLs that don't match known patterns (chutes.ai, moonshot, etc.). GenPlat only recognizes `max_tokens`, so the maxTokens fallback lands on the wrong field.

Add `"compat": { "maxTokensField": "max_tokens" }` to every custom model definition that targets GenPlat. Apply to BOTH files:

- `~/.hamilton/executors/pi/agent/models.json`
- `~/.pi/agent/models.json`

```json
{
  "id": "glm-5.1",
  ...
  "maxTokens": 128000,
  "compat": {
    "maxTokensField": "max_tokens"
  }
}
```

Without this, even with the node_modules patch, `model.maxTokens` (128000) gets set on `max_completion_tokens` instead of `max_tokens`, and GenPlat still defaults to 2048.

### Part 3: verify no stale copies

```bash
find node_modules -path "*/dist/providers/openai-completions.js" \
  -exec sh -c 'grep -L "options?.maxTokens ?? model.maxTokens" "$1"' _ {} \;
```

If this outputs any paths, those copies are still unpatched.

## Revert

Remove this patch after upgrading to a Pi SDK version that includes the fix from issue #5595. The models.json `compat` override may still be needed unless the upstream fix handles GenPlat detection.
