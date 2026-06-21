# Advanced Topics

Custom workflows, telemetry, MCP integration, guidelines system, and script tasks.

## Authoring Custom Workflows

### Directory Structure

Create a new workflow under `~/.hamilton/workflows/<slug>/`:

```
~/.hamilton/workflows/my-workflow/
  workflow.yml         # Workflow spec
  schemas/             # Output schemas (JSON)
    task-a.json
    task-b.json
  agents/              # Workflow-local agents (optional)
    custom-agent/
      agent.yml
      INSTRUCTIONS.md
      SOUL.md
  prompts/             # External prompt files (optional)
    my-prompt.md
```

### Workflow Boilerplate

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Workflow
metadata:
  name: my-workflow
  version: 1
  description: |
    What this workflow does, in detail.
spec:
  run:
    entrypoint: first-task
    timeout: 300s

  tasks:
    - name: first-task
      dependencies: []
      agent:
        executorRef: my-agent
        prompt:
          content: |
            Do the first thing: {{task}}
        output:
          schema:
            file: schemas/first-task.json
      on_failure:
        max_retries: 3
        escalate_to: human

    - name: second-task
      dependencies: [first-task]
      agent:
        executorRef: another-agent
        prompt:
          content: |
            Do the second thing.
            CONTEXT: {{inputs.tasks.first-task.outputs.some_field}}
```

### Defining Output Schemas

Create `schemas/<task-name>.json`:

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "result": { "type": "string" },
    "files_changed": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

Always include `status` as a required field. The engine uses `status` to determine
task completion. `retry` triggers a retry with the output as feedback.

### Script Task Workflows

For deterministic CI/CD-like pipelines without AI agents:

```yaml
tasks:
  - name: install
    dependencies: []
    script:
      command: npm ci
    output:
      schema:
        file: schemas/script-output.json
    on_failure:
      max_retries: 2

  - name: typecheck
    dependencies: [install]
    script:
      command: npm run typecheck
    output:
      schema:
        file: schemas/script-output.json

  - name: build
    dependencies: [typecheck]
    script:
      command: npm run build

  - name: test
    dependencies: [build]
    script:
      command: npm test
    on_failure:
      max_retries: 3
```

Script tasks use no tokens, making them suitable for build pipelines. Output is
captured from stdout/stderr up to `script.maxOutputBytes` (64KB default).

### Installing Custom Workflows

Manually copy to `~/.hamilton/workflows/<slug>/` or use:

```bash
hamilton workflow install my-workflow
```

For development, work directly in `~/.hamilton/workflows/`. Hamilton reads
workflow YAMLs from disk on every run -- no compilation step needed.

### Validation Tips

Common mistakes when authoring workflows:

1. **Missing output schemas**: Tasks without schemas can't validate agent output.
   Always define at least `{ "required": ["status"] }`.
2. **Wrong executorRef**: Must match `metadata.name` in `agent.yml`.
3. **Circular dependencies**: `A depends on B, B depends on A` is caught at load
   time with `"circular dependency detected"`.
4. **Template variable typos**: `{{inputs.tasks.triage.outputs.severty}}` (missing 'i')
   won't resolve. Test with `--foreground` to see unresolved variables in the prompt.
5. **Non-array forEach ref**: `valueFrom.ref` must resolve to an array. Non-array
   values cause a runtime error.

---

## Model Aliases

Map short names to full model IDs for use in workflow YAMLs.

### Configuration

```yaml
# ~/.hamilton/settings.yaml
models:
  aliases:
    fast: google.gemini-flash-2
    balanced: anthropic.claude-sonnet-4
    powerful: anthropic.claude-opus-4
```

### Usage in Agent Manifests

```yaml
# agent.yml
spec:
  settings:
    model: balanced    # resolves to anthropic.claude-sonnet-4
```

### Model Selection Strategy

- Use `fast` for setup tasks (branch creation, build discovery) -- quick, low-token tasks
- Use `balanced` for implementation tasks (bug fixing, feature development)
- Use `powerful` for analysis tasks (planning, security auditing, verification)
- Use `default` to delegate to the Pi SDK default (glm-5.1 or from settings.json)

### Circular Reference Detection

```yaml
models:
  aliases:
    a: b
    b: a          # ERROR: CircularModelAliasError detected at load time
```

---

## Guidelines System

Guidelines inject language-specific coding rules and conventions into agent context.

### How It Works

1. At workflow start, the engine scans the project directory for files
2. Matches file extensions against guideline manifests in `~/.hamilton/guidelines/`
3. Matching guideline files are loaded and injected into the agent's `<instructions>`
   section of the system prompt
4. Guideline files appear as `<guideline-name>/<file-name>` in the prompt

### Guideline Manifest

```yaml
# ~/.hamilton/guidelines/golang/guideline.yml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Guideline
metadata:
  name: golang
spec:
  instructions:
    - matching: ["**/*.go", "go.mod"]
      files:
        - code_style.md
        - patterns.md
        - setup.md
        - testing.md
        - e2e_testing.md
```

| Field | Description |
|-------|-------------|
| `matching` | Glob patterns. If any file in the project matches, the guideline is loaded. |
| `files` | Relative paths to markdown files in the guideline directory. |

### Bundled Guidelines

| Guideline | Triggers On |
|-----------|-------------|
| `golang` | `**/*.go`, `go.mod` |

### Creating Custom Guidelines

1. Create `~/.hamilton/guidelines/<name>/guideline.yml`
2. Write instruction files (.md) in the same directory
3. Define matching globs and file references

Example for a React/TypeScript project:

```yaml
# ~/.hamilton/guidelines/react-ts/guideline.yml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Guideline
metadata:
  name: react-ts
spec:
  instructions:
    - matching: ["**/*.tsx", "**/*.ts"]
      files:
        - component_patterns.md
        - hooks_guide.md
        - testing_conventions.md
```

```markdown
# ~/.hamilton/guidelines/react-ts/component_patterns.md

## Component Conventions

- Use functional components with TypeScript interfaces
- Props interfaces must be named `<ComponentName>Props`
- Export as default unless the component is from a barrel export
- Use React.FC only when children are needed
...
```

Guidelines are loaded per-run, so agents always get project-specific conventions
without workflow authors needing to embed them in prompts.

### Rule-Based Tool Call Interception

Guidelines also support `rules` objects for regex-based tool call interception. When
an agent calls a tool, the engine checks rules and can modify or block the call based
on pattern matching. Currently used by the LSP autocheck extension.

---

## Telemetry System

Records detailed metrics for every LLM interaction.

### Data Collected

| Table | Records |
|-------|---------|
| `turns` | Per-turn timing, token counts, model info |
| `tool_calls` | Tool name, arguments, timing, result |
| `provider_requests` | Raw API request/response metadata |

### Storage Modes

- **File store**: JSONL files per run in `~/.hamilton/runs/<id>/`
- **DB store**: SQLite tables in `~/.hamilton/hamilton.db`

### Management

```bash
# View current state
hamilton telemetry status

# Disable file-based telemetry (keep DB)
hamilton telemetry disable file

# Disable all telemetry
hamilton telemetry disable file
hamilton telemetry disable db

# Re-enable
hamilton telemetry enable
```

### Configuration

```yaml
# ~/.hamilton/settings.yaml
telemetry:
  disableStores: []     # empty = all enabled
```

Telemetry is enabled by default. Disable in CI or sensitive environments.

---

## MCP Server

Hamilton can expose its capabilities via the Model Context Protocol.

```bash
hamilton mcp
```

This starts an MCP server that external tools and AI assistants can use to:
- List available workflows
- Run workflows
- Query run status
- Retrieve logs

The MCP server uses `@modelcontextprotocol/sdk` 1.12.0. It's designed for integration
with MCP-compatible tools like Claude Desktop and other AI assistants.

---

## LSP Autocheck

Automated diagnostics after every file edit.

### How It Works

1. Agent calls `edit` or `write` tool on a file
2. The LSP autocheck extension hooks into `tool_result`
3. Extracts the edited file path
4. Matches an LSP server by file extension
5. Runs single-file diagnostics
6. Prepends diagnostics to the tool output content

The agent sees diagnostics inline and can decide whether to fix issues.

### Configuration

```yaml
# ~/.hamilton/settings.yaml
extensions:
  - name: lsp
    enabled: true
    parameters:
      autoCheck: true        # default: true
```

### LSP Server Configuration

```yaml
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
```

Add custom servers under `lsp.servers`. The server must support stdio-based LSP.

### Design Decisions

- **Single-file scope**: Only the edited file is checked. Full workspace diagnostics would
  be too slow and noisy.
- **Non-blocking**: Diagnostics are informational. The edit proceeds regardless.
- **tool_result hook**: Diagnostics are appended to the tool output, not returned as a
  tool call rejection.

---

## Extension Pipeline

Hamilton's Pi SDK integration supports an extension pipeline:

```
RTK Extension (command rewriting)
  → LSP Extension (diagnostics, hover, go-to-def)
    → LSP Autocheck Extension (post-edit diagnostics)
      → Workflow Extension (write_task_output, schema validation)
```

Extensions are loaded from settings.yaml and activated at session start. The engine
builds `extensionFactories` from enabled extensions and passes them to the Pi SDK.

### Creating Custom Extensions

Extensions follow the Pi SDK `ExtensionFactory` pattern:

```typescript
import type { ExtensionFactory } from "@earendil-works/pi-agent-core"

export function createMyExtension(): ExtensionFactory {
  return (ctx) => {
    return {
      onToolCall: async (call) => {
        // Intercept tool calls
        return call
      },
      onTurnEnd: async (turn) => {
        // React to turn completion
      }
    }
  }
}
```

Register extensions by adding them to settings.yaml and mapping the name to the
factory function in the extension loading logic (`src/executors/pi/extensions/`).

---

## Working Directory Conventions

### Project Files

Hamilton creates and reads project-local files:

```
<repo>/.hamilton/
  changes/
    next-id.txt                          # Monotonic change counter
    001-my-change/workflow.metadata.json # Per-change metadata
  workflows/
    progress-2025-06-15.txt              # Dated progress log
```

### Run Files

Per-run outputs in `~/.hamilton/runs/<run-id>/`:

```
input.json           # Original prompt, cwd, timestamp
events.jsonl         # Engine events (started, completed, failed, paused)
summary.json         # Final summary (tokens, elapsed, status, task results)
logs/<task-id>.jsonl # Per-task structured logs
task-outputs/<task-id>.json  # Agent output payloads
```

### Database

Single SQLite database at `~/.hamilton/hamilton.db` with WAL journal mode. Tables:
`runs`, `tasks`, `token_events`, `workflow_state`, `durable_deferred`, `turns`,
`tool_calls`, `provider_requests`.

---

## Effect-TS Integration

Hamilton is built on Effect-TS 3.21.3. Key patterns:

- **Data.TaggedError** for all custom errors (not `class extends Error`)
- **Effect.gen** with `function* (_)` for generator-based effects
- **Effect.runPromiseExit** + `Exit.isSuccess` / `Exit.isFailure` for testing
- **Schema** from `@effect/schema` 0.75.5 for workflow YAML validation
- **PubSub** event bus for decoupled event subscriber architecture

### Event Bus Architecture

Events are published to a `PubSub` and consumed by subscribers:

| Subscriber | Purpose |
|------------|---------|
| `CliRenderer` | Live terminal output with Unicode indicators |
| `FileLogger` | Structured JSONL logs |
| `DbWriter` | SQLite persistence of token events |
| `TelemetrySubscriber` | Turn, tool call, and provider request recording |

Each subscriber forks a scoped fiber that drains the event stream. Subscribers
are independent -- failure in one doesn't affect others.

---

## State Machine Reference

### Run States

```
idle ──→ running ──→ completed
  │         │
  │         ├──→ paused ──→ running
  │         │
  │         └──→ failed
  │
  └──→ (initial state)
```

### Task States

```
pending ──→ running ──→ completed
  │           │
  │           └──→ failed
  │
  └──→ (initial state)
```

State transitions are validated at the SQLite level. Invalid transitions
(completing an already-completed task, pausing a failed run) are rejected.

### Durable Deferred

The `durable_deferred` table provides cross-process signaling:

```sql
INSERT INTO durable_deferred (id, run_id, state)
VALUES ('pause-<runId>', '<runId>', 'paused')
```

The running engine polls `shouldPause()` before each task. If a deferred signal
exists, the engine finishes the current task and stops.

---

## Performance Characteristics

| Aspect | Detail |
|--------|--------|
| **Workflow load time** | < 100ms (YAML parse + DAG build + agent resolution) |
| **State transitions** | Sub-millisecond SQLite writes |
| **Token tracking** | Per-event granularity via event bus |
| **Memory usage** | ~50MB baseline (bun + Effect-TS), ~100-200MB per agent session |
| **Disk usage per run** | ~10-100KB (logs + outputs), depending on task count and output size |
| **Concurrent runs** | Supported via separate child processes (foreground runs are single-threaded per process) |
| **Resume latency** | < 50ms (SQLite read + DAG rebuild) |

---

## Operations

### Backup

```bash
# Backup the database
cp ~/.hamilton/hamilton.db ~/backups/hamilton-$(date +%Y%m%d).db

# Backup settings
cp ~/.hamilton/settings.yaml ~/backups/
```

### Cleanup

```bash
# Remove old run data (older than 30 days)
find ~/.hamilton/runs/ -maxdepth 1 -mtime +30 -exec rm -rf {} \;

# Purge everything
bun run purge    # removes ~/.hamilton/ and ~/.local/bin/hamilton
```

### Reinitialize

```bash
# Remove and re-create
rm -rf ~/.hamilton
hamilton init --force
```

### Debugging a Run

```bash
# 1. Check the run summary
cat ~/.hamilton/runs/<id>/summary.json | jq .

# 2. Read engine events
cat ~/.hamilton/runs/<id>/events.jsonl | jq .

# 3. Read a task's output
cat ~/.hamilton/runs/<id>/task-outputs/<task-id>.json | jq .

# 4. Read detailed logs
cat ~/.hamilton/runs/<id>/logs/<task-id>.jsonl | jq .

# 5. Query the database directly
sqlite3 ~/.hamilton/hamilton.db "SELECT * FROM runs WHERE id='<run-id>';"
sqlite3 ~/.hamilton/hamilton.db "SELECT task_name, status, error_message FROM tasks WHERE run_id='<run-id>';"
```

### Development

```bash
# Build after code changes
bun run build

# Run tests
bun run test

# Run a specific test file
bun --bun vitest run tests/workflow/loader.test.ts

# Install updated CLI
bun run install-local
```
