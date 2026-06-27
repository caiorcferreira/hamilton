# Debugging Runs

How to inspect and diagnose failed, stuck, or unexpected workflow runs.

## Finding Your Run

List all runs to find the run ID:

```bash
hamilton workflow runs
hamilton workflow runs --status failed
hamilton workflow runs --status running
hamilton workflow runs --limit 5
```

## Reading the Run Summary

```bash
cat ~/.hamilton/runs/<run-id>/summary.json | jq .
```

The summary includes:
- `status`: `completed`, `failed`, `running`, or `paused`
- `taskResults`: per-task status and output fields
- `totalTokensIn`, `totalTokensOut`: token consumption
- `elapsedSeconds`: duration

## Reading Engine Events

```bash
cat ~/.hamilton/runs/<run-id>/events.jsonl | jq .
```

Each line is a JSON event. Key event types:

| Event | Meaning |
|-------|---------|
| `run_started` | Workflow execution began |
| `task_started` | A task began executing |
| `task_output` | Agent produced output (includes the output payload) |
| `task_completed` | Task finished successfully |
| `task_failed` | Task failed after retries exhausted |
| `run_completed` | All tasks completed |
| `run_failed` | Run failed irrecoverably |
| `run_paused` | Pause signal received, stopped after current task |

## Inspecting Task Outputs

```bash
cat ~/.hamilton/runs/<run-id>/task-outputs/<task-id>.json | jq .
```

Each file contains the agent's JSON output. If the task failed, check if the output
is valid JSON and has a `status` field.

## Reading Detailed Logs

```bash
cat ~/.hamilton/runs/<run-id>/logs/<task-id>.jsonl | jq .
```

Per-task structured logs show every turn of the agent's execution, including tool
calls, tool results, and model responses.

## Querying the Database Directly

```bash
sqlite3 ~/.hamilton/hamilton.db "SELECT * FROM runs WHERE id='<run-id>';"

sqlite3 ~/.hamilton/hamilton.db "SELECT task_name, status, error_message FROM tasks WHERE run_id='<run-id>';"

sqlite3 ~/.hamilton/hamilton.db "SELECT * FROM token_events WHERE run_id='<run-id>';"
```

## Live Monitoring

```bash
hamilton workflow logs <run-id> -f
```

Streams logs in real time during an active run.

```bash
hamilton workflow run bug-fix-foreground "prompt"
```

Runs in foreground mode, showing live agent output as it happens.

## Interpreting Agent Failure Feedback

When an agent returns `{ "status": "retry" }`, the task retries with the output
as feedback. Check the last task output to see what went wrong:

```bash
cat ~/.hamilton/runs/<run-id>/task-outputs/<task-id>.json | jq .
```

Look for a `feedback` or `error` field explaining why the agent wants a retry.

When an agent returns `{ "status": "failed" }`, the task escalates to the `on_failure`
policy (retry or abort based on `max_retries` and `escalate_to`).

## Resuming a Paused or Killed Run

```bash
hamilton workflow resume <run-id>
```

The engine reads state from SQLite, skips completed tasks, and continues with the
next pending task. Context from completed tasks is fully restored.
