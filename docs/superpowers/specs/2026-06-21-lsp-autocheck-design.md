# LSP Autocheck Extension

Date: 2026-06-21

## Overview

Add a Hamilton-level Pi extension that automatically runs LSP diagnostics on files after every `edit` or `write` tool call. Diagnostics are shown to the agent as part of the tool output (non-blocking). Reuses the existing `@narumitw/pi-lsp` infrastructure for LSP process management and diagnostic collection.

## Architecture

**New file:** `src/executors/pi/extensions/lsp-autocheck-extension.ts`

Imports from pi-lsp internals (same approach as the existing `import lsp from "@narumitw/pi-lsp"` which resolves to `src/pi-lsp.ts` via the patch):
- `loadRuntime` from `@narumitw/pi-lsp/src/adapters.js` — gets LSP adapters and timeout
- `resolveRoot` from `@narumitw/pi-lsp/src/files.js` — resolves workspace root
- `runDiagnostics` from `@narumitw/pi-lsp/src/runner.js` — runs diagnostics against an adapter

**Factory signature:**
```ts
export function createLspAutocheckExtension(): (pi: ExtensionAPI) => void
```

Returns `() => {}` (no-op) if no LSP adapters are configured. Otherwise returns a function that calls `pi.on("tool_result", handler)`.

**Integration point:** `pi-executor.ts` pushes the autocheck extension into `extensionFactories` after `buildExtensions()`, alongside the existing guideline, workflow, and redact extensions. It reads the `lsp.parameters.autoCheck` setting from the same settings object.

## Settings

`~/.hamilton/settings.yaml` gains a sub-field under the `lsp` extension entry:

```yaml
extensions:
  - name: lsp
    enabled: true
    parameters:
      autoCheck: true
```

**Type change in `extensions.ts`:** `ExtensionEntry` gains `parameters?: Record<string, unknown>` — generic, each extension reads its own keys.

**Behavior:**
- `autoCheck` defaults to `true` when absent
- Setting `autoCheck: false` disables the autocheck extension without disabling the `lsp_diagnostics`/`lsp_fix` tools
- Setting `lsp.enabled: false` disables everything — both tools and autocheck

**`pi-executor.ts`** reads `autoCheck` from `entry.parameters?.autoCheck` for the `lsp` entry and conditionally pushes the autocheck factory.

## Extension Behavior

Uses `pi.on("tool_result")`, **not** `pi.on("tool_call")`. The Pi `ToolCallEventResult.reason` field is only consumed when `block: true` — returning `{ reason }` without `block: true` silently discards the reason. Using `tool_result` instead allows post-hoc augmentation of the tool's output content without blocking execution.

Handler logic:
1. Return `undefined` if `event.toolName` is not `"edit"` or `"write"`
2. Return `undefined` if `event.isError` is truthy (aborted/failed tool)
3. Extract `filePath` from `event.input`. Return `undefined` if missing.
4. Match an LSP adapter via `adapter.isSupportedFile(filePath)`. Return `undefined` if no adapter covers this file.
5. Call `runDiagnostics(adapter, { root: resolveRoot(), paths: [filePath], limit: 1 }, timeoutMs, signal, ctx, statusKey)`
6. If zero diagnostics, return `undefined` (silent).
7. Format diagnostics as text. Prepend `[{ type: "text", text: formattedDiagnostics }, ...event.content]` to the content array.
8. Return `{ content: augmentedContent }` — the edit already ran, the agent sees LSP feedback in the tool output.

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| No LSP adapter covers the edited file | Return `undefined`, silent pass-through |
| LSP server binary not installed | `runDiagnostics` throws; catch and return `undefined` |
| LSP server takes too long | `runDiagnostics` has internal timeout via `timeoutMs` from `loadRuntime()` |
| File deleted between edit and diagnostics check | `runDiagnostics` handles missing file; catch and return `undefined` |
| Multiple consecutive edits to same file | Each edit triggers its own `tool_result`, diagnostics re-run each time |
| Agent aborts mid-edit | `event.isError` is `true`; handler returns `undefined` |

## Integration in pi-executor.ts

After `buildExtensions(extSettings)`, check the `lsp` entry's `parameters.autoCheck`:

```ts
const lspEntry = extSettings.extensions?.find(e => e.name === "lsp")
if (lspEntry?.parameters?.autoCheck !== false) {
  extensionFactories.push(createLspAutocheckExtension() as ExtensionFactory)
}
```

Defaults to `true` (autoCheck absent → enabled). Settings read once at session creation.

## Testing

| Test | Approach |
|---|---|
| Edit on unsupported file | Handler returns `undefined` |
| Edit on supported file, clean | Handler returns `undefined` (no diagnostics) |
| Edit on supported file, with diagnostics | Content array has diagnostics text prepended |
| Write tool, with diagnostics | Same as edit |
| Non-edit/write tool ignored | Handler returns `undefined` |
| LSP adapter missing/invalid | Handler catches, returns `undefined` |
| `filePath` missing from input | Handler returns `undefined` |
| Aborted edit (`isError: true`) | Handler returns `undefined` |
| `autoCheck: false` | Extension factory returns no-op `() => {}` |

## Documentation

Companion doc at `docs/features/lsp-autocheck.md` captures design decisions, internal mechanism, settings, and the extension pipeline insertion point.
