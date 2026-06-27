# Operations

Managing Hamilton at the system level: state machine, working directories, database, performance,
backup, and cleanup.

## Working Directory Conventions

### Project Files

Hamilton creates and reads project-local files:

```
<repo>/.hamilton/
  changes/
    <change-id>/workflow.metadata.json  # Per-change metadata
    <change-id>/progress.md             # Append-only agent progress log
    <change-id>/plan.md                 # Implementation plan
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

## State Machine Reference

### Run States

```
idle --> running --> completed
  |         |
  |         +--> paused --> running
  |         |
  |         +--> failed
  |
  +--> (initial state)
```

### Task States

```
pending --> running --> completed
  |           |
  |           +--> failed
  |
  +--> (initial state)
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

## Backup

```bash
cp ~/.hamilton/hamilton.db ~/backups/hamilton-$(date +%Y%m%d).db

cp ~/.hamilton/settings.yaml ~/backups/
```

## Cleanup

```bash
find ~/.hamilton/runs/ -maxdepth 1 -mtime +30 -exec rm -rf {} \;

bun run purge    # removes ~/.hamilton/ and ~/.local/bin/hamilton
```

## Reinitialize

```bash
rm -rf ~/.hamilton
hamilton init --force
```
