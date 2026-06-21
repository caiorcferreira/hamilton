# LSP Autocheck

## Purpose

Automatically runs LSP diagnostics on files after every `edit` or `write` tool call. Diagnostics are surfaced to the agent as part of the tool's output content, providing immediate feedback without blocking execution.

## Mechanism

Uses the Pi extension `pi.on("tool_result")` hook. After a file edit or write completes, the extension:

1. Extracts the edited file path from the tool input.
2. Matches a configured LSP server adapter by file extension.
3. Runs single-file diagnostics via `@narumitw/pi-lsp`.
4. Prepends any diagnostics to the tool's output content.

The agent sees LSP feedback inline with the normal edit output and can decide whether to address the issues.

## Design Decisions

### `tool_result` hook over `tool_call`

Pi's `ToolCallEventResult.reason` field is only consumed when `block: true`. Returning `{ reason: "diagnostics" }` without `block: true` silently discards the reason. Using the `tool_result` hook instead allows augmenting the tool output content with diagnostics after the edit already ran.

### Single-file scope

Only the edited file is checked. Running full-workspace diagnostics on every edit would be too slow and produce noise from unrelated files. Agents can call `lsp_diagnostics` explicitly for broader scans.

### No blocking

Diagnostics are informational, not gating. The edit proceeds regardless. This avoids disrupting agent workflow and keeps the extension lightweight.

## Settings

Controlled via `~/.hamilton/settings.yaml` under the `lsp` extension entry:

```yaml
extensions:
  - name: lsp
    enabled: true
    parameters:
      autoCheck: true
```

- `autoCheck` defaults to `true` when absent
- Setting `autoCheck: false` disables autocheck without disabling `lsp_diagnostics`/`lsp_fix`
- Setting `lsp.enabled: false` disables everything

## Extension Pipeline

In `pi-executor.ts`, the autocheck extension is pushed into `extensionFactories` after `buildExtensions()`:

```ts
const lspEntry = extSettings.extensions?.find(e => e.name === "lsp")
if (lspEntry?.parameters?.autoCheck !== false) {
  extensionFactories.push(createLspAutocheckExtension() as ExtensionFactory)
}
```

The factory reads LSP adapters at creation time. If no adapters are configured, it returns a no-op.
