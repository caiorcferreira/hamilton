# Settings (`~/.hamilton/settings.yaml`)

> ⚠️ **Autonomous mode (experimental).** This documents Hamilton's workflow engine, which is under active rework and can change without notice. See [The three modes](./modes.md). For the working path today, use [Assisted mode](./skills.md).

Global configuration for the Hamilton engine. Created by `hamilton setup` and read at execution
time by the Pi executor, extension pipeline, and script task runner.

## Location

```
~/.hamilton/settings.yaml
```

Resolved from `$HOME/.hamilton/settings.yaml`. Override `$HOME` for isolated environments.

## Complete Reference

```yaml
# Extension pipeline configuration
extensions:
  - name: rtk
    enabled: true
  - name: lsp
    enabled: true

# LSP server configuration
lsp:
  servers:
    typescript:
      command: ["typescript-language-server", "--stdio"]
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
    python:
      command: ["pylsp"]
      extensions: [".py", ".pyi"]
    golang:
      command: ["gopls", "serve"]
      extensions: [".go"]
    biome:
      command: ["biome", "lsp-proxy"]
      extensions: [".astro", ".css", ".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".html", ".vue", ".mjs", ".mts", ".cjs", ".cts"]
    ruff:
      command: ["ruff", "server"]
      extensions: [".py", ".pyi"]
    yaml:
      command: ["yaml-language-server", "--stdio"]
      extensions: [".yaml", ".yml"]

# Model alias resolution
models:
  aliases:
    sonnet: anthropic.claude-sonnet-4
    flash: google.gemini-flash-2

# Telemetry configuration
telemetry:
  disableStores: []

# Script task configuration
script:
  maxOutputBytes: 65536
```

## Sections

### `extensions`

Configures which Pi SDK extensions are loaded during agent execution.

```yaml
extensions:
  - name: rtk
    enabled: true
  - name: lsp
    enabled: true
    parameters:
      autoCheck: true
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Extension identifier. Valid: `rtk`, `lsp`. |
| `enabled` | `boolean` | No | Whether the extension is active. Default: `false` if absent. |
| `parameters` | `object` | No | Extension-specific options. |

#### Available Extensions

**`rtk`** -- Rewriting Tool Kit

Intercepts `bash` tool calls and rewrites shell commands for correctness before execution.
Requires the `rtk` binary (`>= 0.23.0`). Checked by `hamilton doctor`.

**`lsp`** -- Language Server Protocol

Provides IDE-style diagnostics (diagnostics, hover, go-to-definition, references) to the agent.
Uses `@spences10/pi-lsp` with `@narumitw/pi-lsp` adapters.

* `parameters.autoCheck` (boolean, default `true`): Run single-file diagnostics after every
  `edit`/`write` tool call. Set to `false` to disable autocheck while keeping explicit
  `lsp_diagnostics`/`lsp_fix` tools available.
* The LSP autocheck only validates the edited file (not the full workspace) to avoid noise
  and latency.
* Diagnostics are informational (not blocking). The edit proceeds regardless.
* See [LSP Autocheck](./features/lsp-autocheck.md) for implementation details and design decisions.

### `lsp.servers`

Defines which LSP servers are available and what file extensions they handle.

```yaml
lsp:
  servers:
    typescript:
      command: ["typescript-language-server", "--stdio"]
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
```

| Field | Type | Description |
|-------|------|-------------|
| `command` | `string[]` | The LSP server binary and arguments. |
| `extensions` | `string[]` | File extensions this server handles. |

Hamilton ships with pre-configured servers for TypeScript, Python, Go, YAML, Biome, and Ruff.
To add a custom server, add an entry under `lsp.servers` with its command and extensions.

### `models.aliases`

Maps short alias names to full model IDs. Aliases are used in agent manifests (`spec.settings.model`)
and resolve recursively.

```yaml
models:
  aliases:
    sonnet: anthropic.claude-sonnet-4
    flash: google.gemini-flash-2
    big: anthropic.claude-opus-4
```

Usage in an agent manifest:

```yaml
spec:
  settings:
    model: sonnet
```

**Resolution order:**
1. Check `models.aliases` in settings.yaml
2. Recursively resolve alias chains
3. Return the raw string if no alias matches
4. The `default` alias maps to Pi's default model (`glm-5.1` or from `settings.json`)

**Circular references** (e.g., `a → b → a`) are detected and throw a `CircularModelAliasError`.

**Setting aliases on init:**

```bash
hamilton setup --model-alias sonnet=anthropic.claude-sonnet-4 --model-alias flash=google.gemini-flash-2
```

If no settings.yaml exists, `hamilton setup` prompts interactively for aliases.

### `telemetry`

Controls which telemetry stores are active.

```yaml
telemetry:
  disableStores: ["file"]     # disable file-based telemetry
```

| Field | Type | Description |
|-------|------|-------------|
| `disableStores` | `string[]` | Stores to disable. Valid: `"file"`, `"db"`. Empty array = all enabled. |

**File store**: Writes JSONL telemetry files per run.

**DB store**: Persists turn, tool call, and provider request records in SQLite tables
(`turns`, `tool_calls`, `provider_requests`).

Manage telemetry from the CLI:

```bash
hamilton telemetry status           # view current state
hamilton telemetry enable           # enable all stores
hamilton telemetry disable file     # disable file store
hamilton telemetry disable db       # disable DB store
```

### `script`

Configuration for script tasks (shell command execution).

```yaml
script:
  maxOutputBytes: 65536
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxOutputBytes` | `number` | `65536` | Maximum bytes of stdout/stderr captured from script tasks. |

Output beyond `maxOutputBytes` is truncated.

## Bootstrap

`hamilton setup` writes the default settings file:

```yaml
extensions:
  - name: rtk
    enabled: true
  - name: lsp
    enabled: true
lsp:
  servers:
    biome:
      command: ["biome", "lsp-proxy"]
      extensions: [".astro", ".css", ".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".html", ".vue", ".mjs", ".mts", ".cjs", ".cts"]
    ruff:
      command: ["ruff", "server"]
      extensions: [".py", ".pyi"]
    typescript:
      command: ["typescript-language-server", "--stdio"]
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
    python:
      command: ["pylsp"]
      extensions: [".py", ".pyi"]
    yaml:
      command: ["yaml-language-server", "--stdio"]
      extensions: [".yaml", ".yml"]
    go:
      command: ["gopls", "serve"]
      extensions: [".go"]
telemetry:
  disableStores: []
script:
  maxOutputBytes: 65536
```

If the file already exists, `hamilton setup` preserves it -- it never overwrites existing settings.
Model aliases passed via `--model-alias` are merged into existing settings.

## Error Handling

The settings system is lenient:

- **File missing**: Returns `{}` (empty object). Extensions default to disabled.
- **Invalid YAML**: Returns `{}`. The file is preserved -- fix the syntax manually.
- **Missing `extensions` key**: Returns the parsed object as-is. No extensions are loaded.
- **Unknown extension names**: Silently skipped. No error.
- **Missing `lsp.servers`**: LSP extension loads with no adapters (a no-op).
- **Missing `models.aliases`**: All model references resolve as raw strings.

This leniency means Hamilton never fails to start due to configuration issues. It
gracefully degrades to sensible defaults.

## Other Configuration Files

### Pi SDK Config (`~/.hamilton/executors/pi/agent/`)

| File | Purpose |
|------|---------|
| `settings.json` | Default provider and model (`defaultProvider`, `defaultModel`) |
| `models.json` | Provider-specific model configurations |
| `auth.json` | Authentication credentials for API providers |

These are created with sensible defaults by `hamilton setup`. Copy existing configs from
`~/.pi/agent/` with `hamilton setup --copy-pi-configs`.

### Change Directories (`./.hamilton/changes/`)

Change directories track per-change artifacts. Located at
`./.hamilton/changes/<change-id>/`. Each directory contains:

- `progress.md` — append-only log written by workflow agents
- `plan.md` — implementation plan written by the planner agent
- `workflow.metadata.json` — workflow execution metadata
