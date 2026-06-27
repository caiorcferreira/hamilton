# Telemetry

Records detailed metrics for every LLM interaction during workflow runs.

## Data Collected

| Table | Records |
|-------|---------|
| `turns` | Per-turn timing, token counts, model info |
| `tool_calls` | Tool name, arguments, timing, result |
| `provider_requests` | Raw API request/response metadata |

## Storage Modes

- **File store**: JSONL files per run in `~/.hamilton/runs/<id>/`
- **DB store**: SQLite tables in `~/.hamilton/hamilton.db`

## Management

```bash
hamilton telemetry status

hamilton telemetry disable file

hamilton telemetry disable db

hamilton telemetry enable
```

## Configuration

```yaml
# ~/.hamilton/settings.yaml
telemetry:
  disableStores: []     # empty = all enabled
```

Telemetry is enabled by default. Disable in CI or sensitive environments.
