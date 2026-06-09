# Settings (`~/.hamilton/settings.yaml`)

Global configuration for the Hamilton engine. Created by `hamilton init` and read at
execution time by the Pi executor.

## Location

```
~/.hamilton/settings.yaml
```

## Format

```yaml
extensions:
  - name: rtk
    enabled: true
  - name: lsp
    enabled: true
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `extensions` | `ExtensionEntry[]` | No | Array of extension entries. Defaults to `[]` if missing. |

### ExtensionEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Extension identifier. Valid values: `rtk`, `lsp`. Unknown names are silently skipped. |
| `enabled` | `boolean` | No | Whether the extension is active. Disabled extensions are skipped. |

## Available extensions

### `rtk`

Activates the Retrieval Tool Kit extension. Intercepts `bash` tool calls and runs them
through `rtk rewrite` before execution, rewriting shell commands for correctness.

Requires the `rtk` binary (`>= 0.23.0`). Checked by `hamilton doctor`.

### `lsp`

Activates the Language Server Protocol extension (`@spences10/pi-lsp`) which provides
IDE-style diagnostics (diagnostics, hover, go-to-definition, references) to the agent
during execution.

## Bootstrap

`hamilton init` writes the default settings file if it doesn't exist:

```yaml
extensions:
  - name: rtk
    enabled: true
  - name: lsp
    enabled: true
```

If the file already exists, `hamilton init` preserves it — it never overwrites
existing settings.

## Error handling

The system is lenient: if `settings.yaml` is missing, malformed, or contains
unrecognized entries, it silently falls back to defaults (no extensions active) rather
than failing.
