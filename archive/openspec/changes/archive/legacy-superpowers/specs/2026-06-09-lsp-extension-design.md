# LSP Extension + Extension Registry + Doctor LSP Checks

Date: 2026-06-09

## Overview

Add Language Server Protocol (LSP) support to Hamilton's Pi executor via `@spences10/pi-lsp`. Refactor the extension loading mechanism from a single hardcoded RTK extension into a pluggable registry driven by `~/.hamilton/settings.yaml`. Expand the `doctor` command to verify LSP server binaries are installed.

## Settings File

### `~/.hamilton/settings.yaml`

New YAML file created on `hamilton init` (or first run if missing).

```yaml
extensions:
  - name: rtk
    enabled: true
  - name: lsp
    enabled: true
```

Each entry has `name` (string) and `enabled` (boolean). Unknown names are silently ignored. If the file is missing or contains invalid YAML, all built-in extensions default to enabled.

### Path function

`src/paths.ts`:

```ts
export function settingsPath(): string {
  return Path.join(hamiltonHome(), "settings.yaml")
}
```

### Init integration

`hamilton init` writes default `settings.yaml` if it doesn't exist (idempotent, like existing Pi config creation).

## Extension Registry

### `src/executors/pi/extensions.ts` (NEW)

```ts
export interface ExtensionEntry {
  name: string
  enabled: boolean
}

export interface ExtensionSettings {
  extensions?: ExtensionEntry[]
}

export function readExtensionSettings(): ExtensionSettings

export function buildExtensions(
  settings: ExtensionSettings
): Array<() => void | (() => Promise<void>)>
```

`readExtensionSettings()` reads and parses `~/.hamilton/settings.yaml`. Returns `{}` if file missing or invalid.

`buildExtensions()` iterates `settings.extensions`, matches each entry by name:
- `"rtk"` → `createRtkExtension()` (if enabled)
- `"lsp"` → `createLspExtension()` (if enabled)

Returns the array of factory functions for `DefaultResourceLoader.extensionFactories`.

### Refactored from env vars

The `RTK_DISABLED` environment variable is removed. All extension toggling moves to `settings.yaml`.

## LSP Extension

### `src/executors/pi/lsp-extension.ts` (NEW)

```ts
import { create_lsp_extension } from "@spences10/pi-lsp"

export function createLspExtension() {
  return create_lsp_extension()
}
```

Thin wrapper that re-exports the default factory. Added as a Hamilton dependency: `@spences10/pi-lsp`.

### Dependencies

`package.json` gets `"@spences10/pi-lsp": "0.0.34"` (pinned).

### Pi executor integration

`pi-executor.ts` line 108-122 changes from:

```ts
const rtkExtension = createRtkExtension({ disabled: process.env.RTK_DISABLED === "1" })

const loader = new DefaultResourceLoader({
  // ...
  extensionFactories: [
    rtkExtension,
    ...(config.extensions ?? []) as Array<(pi: unknown) => void>
  ],
```

to:

```ts
const settings = readExtensionSettings()
const extensionFactories = buildExtensions(settings)

const loader = new DefaultResourceLoader({
  // ...
  extensionFactories,
```

## RTK Extension Changes

`src/executors/pi/rtk-extension.ts`:

- Remove `process.env.RTK_DISABLED` check from `createRtkExtension()`
- `disabled` option in `RtkExtensionOptions` remains for programmatic control
- `settings.yaml` is now the single source of truth

## Doctor Command

### New checks added to the `checks` array

```ts
const checkLspTs: Effect.Effect<CheckResult>
const checkLspPython: Effect.Effect<CheckResult>
const checkLspGo: Effect.Effect<CheckResult>
const checkLspJava: Effect.Effect<CheckResult>
```

Each checks `which <binary>` and reports:

| Server | Binary | Install hint |
|--------|--------|-------------|
| TypeScript | `typescript-language-server` | `npm install -g typescript-language-server` |
| Python | `pylsp` | `pip install python-lsp-server` |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Java | `jdtls` | `brew install jdtls` |

The `checks` array becomes:

```ts
const checks: Array<Effect.Effect<CheckResult>> = [
  checkRtk,
  checkLspTs,
  checkLspPython,
  checkLspGo,
  checkLspJava,
]
```

## Testing

| Test | Approach |
|------|---------|
| `readExtensionSettings` | Temp settings.yaml, verify parsing, missing file defaults |
| `buildExtensions` | Test with various settings lists, verify correct factories returned |
| `createLspExtension` | Verify it returns a function (factory contract) |
| `settingsPath` | Path test in paths.test.ts |
| Doctor LSP checks | Mock `ChildProcess.execSync` for which, test pass/fail/detail messaging |
| Init settings.yaml | Extend existing init tests to verify settings.yaml creation |
| Defaults on missing file | pi-executor integration: with no settings.yaml, both rtk and lsp enabled |
| Extension disabled | With lsp.enabled: false, LSP extension not in factories array |
