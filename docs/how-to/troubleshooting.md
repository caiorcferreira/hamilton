# Troubleshooting

Common failures and how to resolve them.

## Installation Failures

### `hamilton init` says "rtk not found"

```bash
npm install -g @rtk-ai/rtk
hamilton init
```

Verify: `rtk --version` should print `>= 0.23.0`.

### `hamilton: command not found`

```bash
echo $PATH | grep ~/.local/bin || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Re-run `bun run install-local` if the symlink is missing:

```bash
ls -la ~/.local/bin/hamilton
```

### Permission errors during `bun install`

```bash
rm -rf node_modules bun.lock
bun install
```

## Workflow Run Failures

### Workflow stuck in "running" state

The engine process may have been killed. Resume it:

```bash
hamilton workflow resume <run-id>
```

List all runs to find the run ID:

```bash
hamilton workflow runs --status running
```

### `AgentNotFoundError`

The workflow references an agent that doesn't exist in either the workflow-local or shared agent pools.

1. Check the agent name in the workflow YAML: `agent.executorRef`
2. Verify the agent directory exists at one of:
   - `~/.hamilton/workflows/<slug>/agents/<name>/`
   - `~/.hamilton/agents/<name>/`
3. Check `agent.yml` has `metadata.name` matching the directory name

### Workflow fails to load with `DuplicateAgentError`

Two workflows define an agent with the same name in their workflow-local directories.
Choose a unique name:

```yaml
# workflow A
agent:
  executorRef: fixer-a

# workflow B
agent:
  executorRef: fixer-b
```

### `Circular dependency detected`

The workflow YAML has a dependency cycle:

```yaml
tasks:
  - name: a
    dependencies: [b]
  - name: b
    dependencies: [a]   # ← creates a cycle
```

Fix by removing one dependency or restructuring the DAG.

## Agent Output Failures

### Agent produces empty or malformed JSON

1. Check the task output in the run directory:
   ```bash
   cat ~/.hamilton/runs/<id>/task-outputs/<task-id>.json | jq .
   ```
2. Verify the output schema in `schemas/<task>.json` matches the expected structure
3. If the task retried, check earlier attempts:
   ```bash
   cat ~/.hamilton/runs/<id>/logs/<task-id>.jsonl | jq .
   ```

### Schema validation failures

The agent's JSON output doesn't match the schema. Common causes:

1. Missing `status` field -- all schemas must require `status`
2. Wrong enum value -- `"done"`, `"failed"`, `"retry"` are the only valid statuses
3. Incorrect types -- arrays where objects are expected, vice versa

The engine retries with the validation error as feedback (up to `max_retries`).

### Agent times out

Increase the workflow timeout:

```yaml
spec:
  run:
    timeout: 600s    # default is 300s
```

For the `do` workflow, pass a shorter prompt or add constraints.

## Settings Validation Errors

### `Invalid settings.yaml`

Hamilton validates settings.yaml at startup. Schema violations produce specific errors:

1. Check the error message for the exact key and expected type
2. Validate your settings.yaml:
   ```bash
   python3 -c "import yaml; yaml.safe_load(open('$HOME/.hamilton/settings.yaml'))"
   ```
3. Compare against the [Settings Reference](../settings.md)

### Circular model alias

```yaml
models:
  aliases:
    a: b
    b: a          # ERROR: CircularModelAliasError
```

Resolve by making one alias point to a concrete model ID:

```yaml
models:
  aliases:
    a: b
    b: anthropic.claude-sonnet-4
```

## Where to Find Logs

| What | Where |
|------|-------|
| Engine events | `~/.hamilton/runs/<id>/events.jsonl` |
| Run summary | `~/.hamilton/runs/<id>/summary.json` |
| Task outputs | `~/.hamilton/runs/<id>/task-outputs/<id>.json` |
| Detailed task logs | `~/.hamilton/runs/<id>/logs/<id>.jsonl` |
| Database | `~/.hamilton/hamilton.db` |
