# CI/CD Integration

Running Hamilton workflows in automated pipelines.

## Non-Interactive Mode

Hamilton detects non-interactive environments (CI) automatically and adjusts:
- No spinner or progress bars
- Plain text output only
- Exit codes reflect run status

## Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| `0` | Workflow completed successfully |
| `1` | Workflow failed (task exhausted retries) |
| `2` | Workflow load/parse error (invalid YAML, missing agent, etc.) |

CI pipelines should check exit codes:

```bash
hamilton workflow run do "Run the test suite and report results"
if [ $? -ne 0 ]; then
  echo "Hamilton workflow failed"
  exit 1
fi
```

## Capturing JSON Output for CI Tooling

```bash
hamilton workflow run do "Audit dependencies for vulnerabilities" > results.json
```

The JSON output includes the full task output from each task in the workflow.
Parse it in CI scripts:

```bash
STATUS=$(jq -r '.status' results.json)
if [ "$STATUS" != "done" ]; then
  echo "Workflow status: $STATUS"
  exit 1
fi
```

## Disabling Telemetry in CI

Add to `~/.hamilton/settings.yaml` or set before running:

```yaml
telemetry:
  disableStores: ["file", "db"]
```

```bash
export HAMILTON_TELEMETRY_DISABLE=true
hamilton workflow run do "Task"
```

## GitHub Actions Example

```yaml
name: Docs Review
on:
  pull_request:
    paths:
      - 'docs/**'

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: '1.2.x'

      - name: Install Hamilton
        run: |
          git clone https://github.com/your-org/hamilton.git
          cd hamilton
          bun install
          bun run build
          bun run install-local

      - name: Bootstrap Hamilton
        run: hamilton init

      - name: Install docs-review workflow
        run: |
          cp -r .github/workflows/docs-review-workflow ~/.hamilton/workflows/docs-review
          hamilton workflow install docs-review

      - name: Run docs review
        run: hamilton workflow run docs-review "Review all changed docs"
        continue-on-error: true

      - name: Post results as PR comment
        if: always()
        run: |
          RUN_ID=$(hamilton workflow runs --limit 1 --format json | jq -r '.[0].id')
          cat ~/.hamilton/runs/$RUN_ID/task-outputs/summarizer*.json | jq -r '.summary' > review.md
          gh pr comment ${{ github.event.pull_request.number }} --body-file review.md
        env:
          GH_TOKEN: ${{ github.token }}
```

## GitLab CI Example

```yaml
docs-review:
  image: oven/bun:1.2
  only:
    changes:
      - docs/**
  script:
    - git clone https://github.com/your-org/hamilton.git
    - cd hamilton && bun install && bun run build && bun run install-local
    - hamilton init
    - cp -r $CI_PROJECT_DIR/.gitlab/docs-review-workflow ~/.hamilton/workflows/docs-review
    - hamilton workflow run docs-review "Review docs changes in this MR"
  artifacts:
    paths:
      - ~/.hamilton/runs/*/task-outputs/
    when: always
```

## Common CI Failure Modes

### rtk not found

```bash
npm install -g @rtk-ai/rtk
```

Make `~/.local/bin` available in CI:

```yaml
- name: Add local bin to PATH
  run: echo "$HOME/.local/bin" >> $GITHUB_PATH
```

### Timeout too short

Default workflow timeout is 300s. For large repos or slow models, increase it:

```yaml
spec:
  run:
    timeout: 600s
```

### Agent hits rate limits

Use faster/cheaper models in CI to avoid hitting provider rate limits:

```yaml
# agent.yml
spec:
  settings:
    model: fast
```

Configure the `fast` alias in settings.yaml:

```yaml
models:
  aliases:
    fast: google.gemini-flash-2
```
