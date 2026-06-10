# Model Aliases — Design Spec

## Problem

All 20+ workflow YAMLs use `model: default`, which resolves to a single hardcoded model (`glm-5.1`) via `parseModelString`. To switch models across workflows, users must edit every YAML individually — or use raw `provider/modelId` strings like `openai/deepseek-v4-pro-official`, which embeds the model name directly in every workflow.

## Solution

Model aliases: user-defined names in `~/.hamilton/settings.yaml` that map to actual model identifiers. Agents reference aliases in YAML. Changing the alias value in settings.yaml switches the model for all workflows referencing it.

## Config Format

**`~/.hamilton/settings.yaml`:**

```yaml
models:
  aliases:
    cheap: deepseek-v4-pro-official
    fast: deepseek-v4-pro-official
    thinking: deepseek-v4-pro-official
```

Workflow YAMLs use aliases or raw model strings as before:

```yaml
agents:
  - name: planner
    settings:
      model: cheap
  - name: developer
    settings:
      model: thinking
```

The `"default"` alias is automatically injected from pi's `settings.json` (`defaultModel` field) — it does not need to be defined in settings.yaml.

## Types

```typescript
// src/agent/config.ts
export interface ModelAliasRegistry {
  [alias: string]: string
}
```

No new types in `src/types.ts` — `AgentSettings.model` remains `string | undefined`.

## Functions

All new functions live in `src/agent/config.ts`:

### `loadModelAliases(defaultModel: string): ModelAliasRegistry`

1. Reads `settingsPath()` (resolves to `~/.hamilton/settings.yaml`, defined in `src/paths.ts`)
2. If the file exists and has `models.aliases`, builds a registry from those entries
3. Always injects `{ default: defaultModel }` into the registry (from pi's `settings.json`)
4. If the file is missing, invalid YAML, or has no `models.aliases`, returns `{ default: defaultModel }`

### `resolveModelAlias(model: string, aliases: ModelAliasRegistry): string`

1. If `model` is `undefined`, uses `"default"`
2. Looks up `model` in `aliases` — if found, returns the mapped value
3. If not found, returns `model` as-is (passthrough for raw `provider/modelId` strings)
4. Detects circular aliases (alias → same alias) and throws `CircularModelAliasError`

## Pipeline

All hooks are in the runner, between `resolveAgentDefaults` and `executeWithPi`:

```
Pi settings.json ({ defaultModel: "glm-5.1" })
    │
    ▼
resolveAgentDefaults(agent.settings)
    │  returns { model: "glm-5.1", systemPrompt, skills }
    │
    ▼
loadModelAliases(resolved.model)
    │  reads settings.yaml → models.aliases
    │  injects { default: "glm-5.1" }
    │
    ▼
resolveModelAlias(agent.settings.model, aliases)
    │  "cheap" → "deepseek-v4-pro-official"
    │  undefined → "default" → "glm-5.1"
    │
    ▼
parseModelString(resolved)
    │  splits on "/" → [provider, modelId]
    │
    ▼
executeWithPi({ model: resolved, ... })
```

**Call site** in `src/workflow/runner.ts`, function `executeSingleTask`, after `resolveAgentDefaults`:

```typescript
const resolved = resolveAgentDefaults(agent.settings)
const aliases = loadModelAliases(resolved.model)
const model = resolveModelAlias(agent.settings.model ?? "default", aliases)

executeWithPi({
  model,
  // ... existing fields
})
```

## Error Handling

| Scenario | Behavior |
|---|---|
| No settings.yaml | `loadModelAliases` returns `{ default: defaultModel }` |
| settings.yaml has no `models.aliases` | Returns `{ default: defaultModel }` |
| Alias resolves to itself (A → A) | `resolveModelAlias` throws `CircularModelAliasError` |
| Unknown alias string | Passed through as-is to `parseModelString` |
| `agent.settings.model` is undefined | `resolveModelAlias` uses `"default"` |

## Files

| File | Action | Purpose |
|---|---|---|
| `src/agent/config.ts` | Modify | Add `ModelAliasRegistry`, `loadModelAliases()`, `resolveModelAlias()` |
| `src/workflow/runner.ts` | Modify | Call `loadModelAliases` + `resolveModelAlias` in `executeSingleTask` |
| `tests/agent/config.test.ts` | Modify | Test alias functions |

## Implementation Order

1. Add `ModelAliasRegistry` type, `loadModelAliases()`, `resolveModelAlias()` to `src/agent/config.ts`
2. Add tests to `tests/agent/config.test.ts`
3. Wire into `src/workflow/runner.ts` `executeSingleTask`
4. Verify: `bun run build`, `bun --bun vitest run`
