# Documentation Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebalance Hamilton's documentation from Reference-heavy (50%) to full Diátaxis coverage by writing 10 new documents, organizing docs/ by quadrant, extracting contributor content, and deleting advanced.md over 3 phases.

**Architecture:** Diátaxis-aligned documentation with tutorials in `docs/tutorials/`, how-to guides in `docs/how-to/`, explanation and reference flat at `docs/` root. Each doc has a single purpose. Cross-links form a clear entry-to-mastery reading path.

**Tech Stack:** Markdown, git, bash. No code changes. Verification via grep/link audits and `bun run build`.

---

## File Structure

```
docs/
  getting-started.md              [MODIFY]  Update Next Steps links, add Philosophy + LSP links
  philosophy.md                   [NOOP]    Now discoverable via Getting Started link
  workflow-yaml.md                [NOOP]    Stays
  cli-reference.md                [NOOP]    Stays
  settings.md                     [MODIFY]  Add LSP autocheck link in LSP section
  agents.md                       [MODIFY]  Remove "Documentation Conventions" section, fix advanced.md refs
  use-cases.md                    [MOVE]    → how-to/use-cases.md [MODIFY] expand do workflow
  advanced.md                     [DELETE]  Content distributed into new files

  how-to/
    use-cases.md                  [MOVE+MODIFY]
    custom-workflows.md           [CREATE]  Extracted from advanced.md
    operations.md                 [CREATE]  Extracted from advanced.md
    troubleshooting.md            [CREATE]  Phase 2 new content
    debugging-runs.md             [CREATE]  Phase 2 new content
    ci-cd-integration.md          [CREATE]  Phase 3 new content

  tutorials/
    custom-workflow.md            [CREATE]  Phase 3 new content
    custom-guidelines.md          [CREATE]  Phase 3 new content

  telemetry.md                    [CREATE]  Extracted from advanced.md
  mcp.md                          [CREATE]  Extracted from advanced.md
  how-workflows-run.md            [CREATE]  Phase 2 new content
  variants.md                     [CREATE]  Phase 2 new content
  model-aliases.md                [CREATE]  Phase 3 new content (extracted from advanced.md §Model Aliases)
  template-expansion.md           [CREATE]  Phase 3 new content

  features/
    lsp-autocheck.md              [NOOP]    Now discoverable via cross-links

CONTRIBUTING.md                   [CREATE]  Extracted from agents.md §Documentation Conventions
README.md                         [MODIFY]  Update references to reflect new structure
```

---

## Phase 1: Structural Cleanup & Quick Wins

### Task 1: Create directory structure and move use-cases.md

**Files:**
- Create: `docs/how-to/` (dir)
- Create: `docs/tutorials/` (dir)
- Move: `docs/use-cases.md` → `docs/how-to/use-cases.md`

- [ ] **Step 1: Create directories**

```bash
mkdir -p docs/how-to docs/tutorials
```

- [ ] **Step 2: Move use-cases.md**

```bash
git mv docs/use-cases.md docs/how-to/use-cases.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/how-to/ docs/tutorials/
git commit -m "docs: create how-to and tutorials directories, move use-cases"
```

### Task 2: Extract advanced.md into standalone files

**Files:**
- Create: `docs/how-to/custom-workflows.md`
- Create: `docs/telemetry.md`
- Create: `docs/mcp.md`
- Create: `docs/how-to/operations.md`
- Delete: `docs/advanced.md`

- [ ] **Step 1: Create docs/how-to/custom-workflows.md**

Write with content extracted from `docs/advanced.md` lines 5-152 (sections: Authoring Custom Workflows, Script Task Workflows, Installing Custom Workflows, Validation Tips):

```markdown
# Authoring Custom Workflows

Create your own multi-agent workflows beyond the bundled set.

## Directory Structure

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

## Workflow Boilerplate

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

## Defining Output Schemas

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

## Script Task Workflows

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

## Installing Custom Workflows

Manually copy to `~/.hamilton/workflows/<slug>/` or use:

```bash
hamilton workflow install my-workflow
```

For development, work directly in `~/.hamilton/workflows/`. Hamilton reads
workflow YAMLs from disk on every run -- no compilation step needed.

## Validation Tips

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
```

- [ ] **Step 2: Create docs/telemetry.md**

Write with content extracted from `docs/advanced.md` lines 285-328 (Telemetry System section):

```markdown
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
```

- [ ] **Step 3: Create docs/mcp.md**

Write with content extracted from `docs/advanced.md` lines 331-347 (MCP Server section):

```markdown
# MCP Server

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
```

- [ ] **Step 4: Create docs/how-to/operations.md**

Write with content extracted from `docs/advanced.md` lines 445-608 (Working Directory Conventions, State Machine Reference, Performance Characteristics, Operations sections, plus the Debugging a Run subsection will move to `debugging-runs.md` in Phase 2):

```markdown
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
```

- [ ] **Step 5: Delete advanced.md**

```bash
git rm docs/advanced.md
```

- [ ] **Step 6: Commit**

```bash
git add docs/how-to/custom-workflows.md docs/telemetry.md docs/mcp.md docs/how-to/operations.md
git commit -m "docs: split advanced.md into standalone docs and delete it"
```

### Task 3: Extract contributor docs from agents.md into CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`
- Modify: `docs/agents.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

```markdown
# Contributing to Hamilton

## Documentation Conventions

When making changes to Hamilton's own codebase, keep the documentation in `docs/`
synchronized. Every code change that affects user-facing behavior, APIs, configuration,
or CLI commands must include corresponding documentation updates.

### Mapping Code to Docs

| Code change area | Doc to update |
|------------------|---------------|
| New/changed CLI command, flag, or argument | `docs/cli-reference.md` |
| New/changed YAML fields, task types, or validation rules | `docs/workflow-yaml.md` |
| New/changed settings.yaml keys | `docs/settings.md` |
| New/changed agent manifest fields or persona conventions | `docs/agents.md` |
| New/changed agent INSTRUCTIONS.md or SOUL.md in `bundle/agents/` | `docs/agents.md` (Bundled Agents Reference) |
| New/changed workflow in `bundle/workflows/` | `docs/workflows-catalog.md` |
| New workflow YAML, variant, or task type | `docs/workflows-catalog.md` |
| New features or capabilities that change how users work | `docs/how-to/use-cases.md` or `docs/how-to/custom-workflows.md` |
| Changes to execution model, state machine, or engine behavior | `docs/philosophy.md` or `docs/how-to/operations.md` |

### Rules

1. **Documentation is not optional.** A code change is incomplete until the relevant docs are updated.
2. **Match the real behavior.** Documentation must reflect the actual code, not aspirations.
3. **Use the existing format.** Tables, code blocks, and section structures in each doc file are consistent -- follow them.
4. **Update the README.** If a change affects the quick-start flow, available workflows, commands table, or architecture section, update `README.md`.
5. **Inline examples are live.** YAML examples in docs should be valid workflow specs that the current engine can load. If the YAML format changes, update every example.
6. **No stale content.** When deprecating or removing a feature, remove its documentation in the same changeset. Do not leave `(deprecated)` notes -- cut cleanly.
```

- [ ] **Step 2: Remove Documentation Conventions section from docs/agents.md**

Remove lines 437-464 (everything from `## Documentation Conventions for Hamilton Development` to end of file).

Target the edit:
- Old content starts with `## Documentation Conventions for Hamilton Development` and ends at line 464 (`6. **No stale content.** ... cut cleanly.`)
- Replace with nothing (the file should end at the Agent Execution Flow section)

```bash
# Manual edit: remove lines 437 through end of file
```

Use this edit:

```diff
 In `docs/agents.md`, delete everything from line 437 to end of file.
 The file should end with line 435 (the "8. **Task completes**..." line of Agent Execution Flow).
```

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md docs/agents.md
git commit -m "docs: extract contributor docs from agents.md into CONTRIBUTING.md"
```

### Task 4: Add Philosophy link to Getting Started

**Files:**
- Modify: `docs/getting-started.md`

- [ ] **Step 1: Add Philosophy link to Next Steps section**

In `docs/getting-started.md`, the "Next Steps" section is at lines 258-265. Add a Philosophy link as the first item:

Old:
```markdown
## Next Steps

- [Workflow YAML Reference](./workflow-yaml.md) -- understand the workflow spec format
- [CLI Reference](./cli-reference.md) -- every command and flag
- [Agent System](./agents.md) -- how agents work and how to create them
- [Workflows Catalog](./workflows-catalog.md) -- all built-in workflows
- [Common Use Cases](./use-cases.md) -- practical patterns for software development
- [Settings Reference](./settings.md) -- global configuration
```

New:
```markdown
## Next Steps

- [Philosophy](./philosophy.md) -- design rationale and principles behind Hamilton
- [Workflow YAML Reference](./workflow-yaml.md) -- understand the workflow spec format
- [CLI Reference](./cli-reference.md) -- every command and flag
- [Agent System](./agents.md) -- how agents work and how to create them
- [Workflows Catalog](./workflows-catalog.md) -- all built-in workflows
- [Common Use Cases](./how-to/use-cases.md) -- practical patterns for software development
- [Settings Reference](./settings.md) -- global configuration
```

- [ ] **Step 2: Update use-cases link in Next Steps**

The `./use-cases.md` link must change to `./how-to/use-cases.md` since the file moved in Task 1. The link is already updated in the block above.

- [ ] **Step 3: Verify cross-references**

```bash
grep -r 'use-cases.md' docs/ --include='*.md'
grep -r 'advanced.md' docs/ --include='*.md'
```

All references to `use-cases.md` should use the `how-to/` path. No references to `advanced.md` should remain.

- [ ] **Step 4: Commit**

```bash
git add docs/getting-started.md
git commit -m "docs: add Philosophy link to Getting Started Next Steps"
```

### Task 5: Add LSP autocheck discoverability links

**Files:**
- Modify: `docs/getting-started.md`
- Modify: `docs/settings.md`

- [ ] **Step 1: Add LSP link to Getting Started LSP table**

In `docs/getting-started.md` lines 11-20, after the LSP server table, add a link to the dedicated LSP autocheck page.

After line 20 (closing `|` of the table), insert:

```markdown

See [LSP Autocheck](./features/lsp-autocheck.md) for how Hamilton uses LSP to provide inline diagnostics to agents.
```

- [ ] **Step 2: Add LSP link to settings.md LSP section**

In `docs/settings.md`, the LSP extension description is at lines 90-100. After line 100 (`* Diagnostics are informational (not blocking). The edit proceeds regardless.`), insert:

```markdown
* See [LSP Autocheck](./features/lsp-autocheck.md) for implementation details and design decisions.
```

- [ ] **Step 3: Commit**

```bash
git add docs/getting-started.md docs/settings.md
git commit -m "docs: add LSP autocheck discoverability links to Getting Started and Settings"
```

### Task 6: Cross-link audit for Phase 1

**Files:**
- Modify: `docs/agents.md` (fix advanced.md references in mapping table)
- Modify: `README.md` (fix use-cases and advanced references)

- [ ] **Step 1: Fix agents.md mapping table**

In `docs/agents.md`, the "Agent Execution Flow" section (lines 426-435) ends the file now. Verify the final content is clean. The file should no longer contain "Documentation Conventions" text. Verify:

```bash
grep "Documentation Conventions" docs/agents.md && echo "FAIL: still present" || echo "OK"
```

- [ ] **Step 2: Fix README.md references**

Search README.md for stale references:

```bash
grep -n 'advanced.md\|use-cases.md' README.md
```

If any references found, update them:
- `docs/advanced.md` → remove reference or point to relevant new doc (`docs/how-to/custom-workflows.md`, `docs/telemetry.md`, etc.)
- `docs/use-cases.md` → `docs/how-to/use-cases.md`

- [ ] **Step 3: Global link audit**

```bash
# Check for any remaining references to deleted/moved files
grep -rn 'advanced\.md' docs/ README.md --include='*.md' || echo "No advanced.md references found"
grep -rn '\./use-cases\.md\|(/use-cases\.md)' docs/ README.md --include='*.md' || echo "No stale use-cases.md references found"
```

- [ ] **Step 4: Verify build is unaffected**

```bash
bun run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: Phase 1 cross-link audit — fix all stale references"
```

**Phase 1 complete.** docs/ has quadrant directories, advanced.md is gone, all existing docs are discoverable, no broken links.

---

## Phase 2: New Explanation & How-To Documents

### Task 7: Write docs/how-to/troubleshooting.md

**Files:**
- Create: `docs/how-to/troubleshooting.md`

- [ ] **Step 1: Write the file**

```markdown
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
```

- [ ] **Step 2: Verify file content**

```bash
wc -l docs/how-to/troubleshooting.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/how-to/troubleshooting.md
git commit -m "docs: add troubleshooting guide"
```

### Task 8: Write docs/how-workflows-run.md

**Files:**
- Create: `docs/how-workflows-run.md`

- [ ] **Step 1: Write the file**

```markdown
# How Workflows Run

What happens under the hood when you run `hamilton workflow run <slug> <prompt>`.

## The Lifecycle

Every workflow run goes through four phases:

```
load → resolve → execute → persist
```

### 1. Load

The engine reads the workflow YAML from `~/.hamilton/workflows/<slug>/workflow.yml`
(or the bundled location). It parses the YAML, validates it against the schema, and
builds an in-memory `WorkflowSpec`.

If the YAML is invalid (missing fields, wrong types, circular dependencies), loading
fails immediately with an error before any work starts.

### 2. Resolve

The engine resolves every `executorRef` in the workflow to an agent directory:

1. Check `~/.hamilton/workflows/<slug>/agents/<name>/` (workflow-local agents take priority)
2. Fall back to `~/.hamilton/agents/<name>/` (shared pool)
3. If neither exists, fail with `AgentNotFoundError`

This two-tier system means workflows can bring their own agents or reuse shared ones.
A workflow can even override a shared agent by providing a workflow-local version with
the same name.

### 3. Execute

Execution follows the DAG (Directed Acyclic Graph):

1. Tasks with no dependencies start immediately
2. When a task completes, downstream tasks become eligible
3. Tasks run sequentially within the engine (no parallelism)
4. Each task:
   - Builds a system prompt from agent persona files (INSTRUCTIONS.md, SOUL.md, CONTEXT.md)
   - Renders the task prompt through Handlebars with accumulated context
   - Injects matching guidelines based on the project's file types
   - Creates a Pi SDK session with the resolved model and enabled extensions
   - Calls the AI agent with the assembled prompts
   - Validates the agent's JSON output against the task's schema
   - Stores the output for downstream tasks

### 4. Persist

After each task, the engine writes state to `~/.hamilton/hamilton.db`:

- Task status (running → completed / failed)
- Token usage
- Output payloads to `~/.hamilton/runs/<id>/task-outputs/`

This enables pause/resume across processes. On resume, the engine reads the database,
skips completed tasks, and continues from the first pending task.

## Context Flow

Each task's output becomes available to downstream tasks through template variables.

Given a task named `triage` that outputs `{ "severity": "high", "root_cause": "..." }`:

```yaml
- name: fix
  dependencies: [triage]
  agent:
    executorRef: fixer
    prompt:
      content: |
        The bug is severity {{inputs.tasks.triage.outputs.severity}}.
        Root cause: {{inputs.tasks.triage.outputs.root_cause}}
```

Template variables use `{{inputs.tasks.<task-name>.outputs.<field>}}` syntax.
The engine uses [Handlebars](https://handlebarsjs.com/) for template rendering.

## State Machine

The engine is a finite state machine backed by SQLite:

```
idle → running → completed
         ↓
       paused → running
         ↓
       failed
```

- **idle**: Initial state, no run active
- **running**: Tasks are executing
- **paused**: Engine stopped after current task, waiting for resume
- **completed**: All tasks finished, summary written
- **failed**: A task exceeded `max_retries` without success

Transitions are validated at the database level. You can't complete a task that's
already completed, or pause a run that's already failed.

## What "Done" Means

A run is `completed` when every task reaches `done` status OR when a task with
`escalate_to: human` fails and the user decides to stop.

A run is `failed` when a task exhausts its retries and the `on_failure` policy is
`escalate_to: abort` or the user cancels.
```

- [ ] **Step 2: Commit**

```bash
git add docs/how-workflows-run.md
git commit -m "docs: add how-workflows-run explanation"
```

### Task 9: Write docs/variants.md

**Files:**
- Create: `docs/variants.md`

- [ ] **Step 1: Write the file**

```markdown
# Variants

Variants modify a base workflow's behavior by changing tasks, model assignments, or
output destinations. A variant is a suffix appended to the workflow slug.

## How Variants Work

When you run a workflow with a variant, the engine loads the base workflow YAML and
applies the variant's overrides. Variants can:

- **Add tasks** — `-github-pr` appends a PR creation task
- **Remove tasks** — `-no-fix` skips implementation, useful for triage-only runs
- **Change model** — `-fast` assigns faster/cheaper models to all tasks
- **Enable modes** — `-foreground` runs in foreground mode with live output

The engine loads `workflow.yml` for the base workflow, then applies variant
patches from the variant definition.

## Available Variants

All workflows support a common set of CLI/mode variants:

| Suffix | Effect |
|--------|--------|
| `-foreground` | Run in foreground mode with live streaming output |
| `-foreground-stream-json` | Foreground mode with JSON-formatted event stream |

Workflow-specific variants:

| Workflow | Variant | What it does |
|----------|---------|--------------|
| `bug-fix` | `-github-pr` | Appends a PR creation task using the `pr` agent |
| `bug-fix` | `-no-fix` | Triage and investigate only, skip `fix` and `verify` tasks |
| `feature-dev` | `-github-pr` | Appends a PR creation task |
| `security-audit` | `-github-pr` | Appends a PR with the audit report |
| `quarantine-broken-tests` | `-github-pr` | Appends a PR with the quarantine changes |
| `scaffold` | `-github-pr` | Appends a PR with the scaffolded project |

## Using Variants

```bash
hamilton workflow run bug-fix-github-pr "Fix the login crash on empty email"
```

The variant suffix is appended directly to the workflow slug. The engine splits
on the first `-`, loads the base workflow, and applies the variant.

## Composition

Variants are additive. You can't combine multiple variants (e.g., `-github-pr-no-fix`
is not supported). Choose one variant per run.

For mode variants like `-foreground`, combine with the base workflow name:

```bash
hamilton workflow run bug-fix-foreground "Fix the crash"
```

## When to Use Each Variant

- **`-github-pr`**: When you want Hamilton to open a PR with the results. Use for
  workflows where the output should persist in version control.
- **`-no-fix`**: When you only want analysis, not implementation. Useful for
  understanding a bug before deciding whether to fix it.
- **`-foreground`**: During development or debugging. See live agent output as it
  happens instead of waiting for the complete run.
```

- [ ] **Step 2: Commit**

```bash
git add docs/variants.md
git commit -m "docs: add variants explanation"
```

### Task 10: Write docs/how-to/debugging-runs.md

**Files:**
- Create: `docs/how-to/debugging-runs.md`

- [ ] **Step 1: Write the file**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/how-to/debugging-runs.md
git commit -m "docs: add debugging runs how-to guide"
```

### Task 11: Expand do workflow in use-cases.md

**Files:**
- Modify: `docs/how-to/use-cases.md`

- [ ] **Step 1: Add General-Purpose Tasks section**

Find the end of `docs/how-to/use-cases.md`. After the last existing section, append:

```markdown
## General-Purpose Tasks

Use the `do` workflow for one-off tasks where a single agent is sufficient.

### Basic Do

```bash
cd /path/to/repo
hamilton workflow run do "Add JSDoc comments to all exported functions in src/utils/"
```

**Pipeline**: setup → do

**What happens:**
1. Setup discovers build and test commands
2. The `do` agent understands the task, plans an approach, executes, verifies, and reports

**Output**: A JSON object with `status`, `result` (what was done), and `changes` (list of changed files).

### Do with Guidelines

The `do` agent automatically picks up project guidelines based on file types. To add custom conventions:

1. Create `~/.hamilton/guidelines/my-conventions/guideline.yml`
2. The `do` agent will follow your conventions alongside the task prompt

### When to Use Do vs. Bug-Fix

| Use `do` when... | Use `bug-fix` when... |
|------------------|-----------------------|
| The task doesn't need separate triage/analysis phases | You need structured root cause analysis |
| A single agent can complete the work | Multiple agents with different expertise are needed |
| You want to add/refactor code (not fix a specific bug) | You're fixing a reported defect |
| The outcome is additive (docs, features, refactors) | The outcome needs verification against acceptance criteria |
```

- [ ] **Step 2: Commit**

```bash
git add docs/how-to/use-cases.md
git commit -m "docs: expand do workflow examples in use-cases"
```

### Task 12: Cross-link new docs from Getting Started

**Files:**
- Modify: `docs/getting-started.md`

- [ ] **Step 1: Update Next Steps with Phase 2 docs**

Update the Next Steps section (already modified in Task 4) to include the new Phase 2 docs:

```markdown
## Next Steps

- [Philosophy](./philosophy.md) -- design rationale and principles behind Hamilton
- [How Workflows Run](./how-workflows-run.md) -- understand what just happened
- [Variants](./variants.md) -- what variants are and how to combine them
- [Workflow YAML Reference](./workflow-yaml.md) -- understand the workflow spec format
- [CLI Reference](./cli-reference.md) -- every command and flag
- [Agent System](./agents.md) -- how agents work and how to create them
- [Workflows Catalog](./workflows-catalog.md) -- all built-in workflows
- [Common Use Cases](./how-to/use-cases.md) -- practical patterns for software development
- [Troubleshooting](./how-to/troubleshooting.md) -- resolve common failures
- [Debugging Runs](./how-to/debugging-runs.md) -- inspect and diagnose runs
- [Settings Reference](./settings.md) -- global configuration
```

- [ ] **Step 2: Commit**

```bash
git add docs/getting-started.md
git commit -m "docs: add Phase 2 docs to Getting Started Next Steps"
```

**Phase 2 complete.** Four new documents written. do workflow expanded. The "what went wrong" path exists (troubleshooting + debugging). All new pages linked from Getting Started.

---

## Phase 3: Tutorials & Advanced How-To

### Task 13: Write docs/tutorials/custom-workflow.md

**Files:**
- Create: `docs/tutorials/custom-workflow.md`

- [ ] **Step 1: Write the file**

```markdown
# Creating Your First Custom Workflow

Build a custom Hamilton workflow from scratch. By the end, you'll have a working
multi-agent pipeline that you can run and iterate on.

## Step 1: Define the Problem

This tutorial builds a "docs-review" workflow that checks documentation files for
clarity, completeness, and consistency.

The workflow has three tasks:
1. Scan the docs/ directory and list all files
2. Review each file for writing quality
3. Generate a summary report with actionable feedback

## Step 2: Design Agent Roles

| Agent | Role | Shared or Workflow-Local |
|-------|------|--------------------------|
| `scanner` | Scans the docs/ directory, lists files, identifies which need review | Workflow-local |
| `reviewer` | Reviews each file for clarity, completeness, consistency | Workflow-local |
| `summarizer` | Compiles findings into a structured report | Workflow-local |

All agents are workflow-local since they're specific to this workflow.

## Step 3: Create Agent Personas

Create the workflow directory:

```bash
mkdir -p ~/.hamilton/workflows/docs-review/agents/{scanner,reviewer,summarizer}
mkdir -p ~/.hamilton/workflows/docs-review/schemas
```

### scanner/agent.yml

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: scanner
spec:
  settings:
    model: default
```

### scanner/INSTRUCTIONS.md

```markdown
# Scanner

## Situation
You are the **scanner** in a documentation review workflow. You have access to the
project's docs/ directory and need to identify which files need review.

## Task
List all documentation files and classify which need review and why.

## Action
1. List all files in the docs/ directory
2. For each file, note: filename, word count (approximate), last modified date
3. Classify: needs review (true/false), priority (high/medium/low)
4. Flag files that are missing, empty, or appear stale

## Progress
Append findings to progress.md with file counts and status.

## Result
{"status": "done", "files": [{"path": "...", "needs_review": true, "priority": "high", "reason": "..."}]}
```

### scanner/SOUL.md

```markdown
# Soul

You are thorough and systematic. You don't skip files just because they're long.
You give each file a fair assessment.

You are impartial: a file's priority depends on its content and role, not its
author or age.
```

### reviewer/agent.yml

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: reviewer
spec:
  settings:
    model: balanced
```

### reviewer/INSTRUCTIONS.md

```markdown
# Reviewer

## Situation
You are the **reviewer** in a documentation review workflow. You receive a list
of files from the scanner and review each one for writing quality.

## Task
Review documentation files for clarity, completeness, and consistency. Provide
actionable feedback for each file.

## Action
1. Read each file in the list
2. Assess: clarity (is the prose understandable?), completeness (are topics covered?),
   consistency (does it follow conventions?)
3. For each issue found, provide: file, line/section, problem, suggestion
4. Rate overall quality: excellent / good / needs_improvement / poor

## Progress
Update progress.md with review status per file.

## Result
{"status": "done", "reviews": [{"file": "...", "rating": "good", "issues": [{"section": "...", "problem": "...", "suggestion": "..."}]}]}
```

### reviewer/SOUL.md

```markdown
# Soul

You are constructive, not critical. You find problems to help improve the
documentation, not to criticize the author. Every issue comes with a clear
suggestion for improvement.
```

### summarizer/agent.yml

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: summarizer
spec:
  settings:
    model: default
```

### summarizer/INSTRUCTIONS.md

```markdown
# Summarizer

## Situation
You are the **summarizer** in a documentation review workflow. You receive
review results and compile them into a structured summary.

## Task
Compile all review findings into a clear, actionable summary report.

## Action
1. Read all reviews
2. Identify common themes and patterns across files
3. Prioritize issues: critical > high > medium > low
4. Produce a markdown summary with: overall assessment, prioritized issues,
   recommended actions, and an estimated effort for each

## Progress
Append summary status to progress.md.

## Result
{"status": "done", "summary": "## Documentation Review Summary\n\n..."}
```

### summarizer/SOUL.md

```markdown
# Soul

You are concise and organized. Your summaries are skimmable but complete.
You highlight what matters most and don't bury the lead.
```

## Step 4: Write the Workflow YAML

Create `~/.hamilton/workflows/docs-review/workflow.yml`:

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Workflow
metadata:
  name: docs-review
  version: 1
  description: |
    Reviews documentation files for clarity, completeness, and consistency.
    Produces a summary report with actionable feedback.
spec:
  run:
    entrypoint: scanner
    timeout: 300s

  tasks:
    - name: scanner
      dependencies: []
      agent:
        executorRef: scanner
        prompt:
          content: |
            Scan the docs/ directory in the project and list all files.
            For each file, determine if it needs review and assign a priority.
        output:
          schema:
            file: schemas/scanner.json
      on_failure:
        max_retries: 1
        escalate_to: human

    - name: reviewer
      dependencies: [scanner]
      agent:
        executorRef: reviewer
        prompt:
          content: |
            Review each file for clarity, completeness, and consistency.

            Files to review:
            {{inputs.tasks.scanner.outputs.files}}

            Provide actionable feedback for each issue found.
        output:
          schema:
            file: schemas/reviewer.json
      on_failure:
        max_retries: 2
        escalate_to: human

    - name: summarizer
      dependencies: [reviewer]
      agent:
        executorRef: summarizer
        prompt:
          content: |
            Compile the following reviews into a summary report:

            {{inputs.tasks.reviewer.outputs.reviews}}

            Produce a markdown summary organized by priority.
        output:
          schema:
            file: schemas/summarizer.json
      on_failure:
        max_retries: 2
        escalate_to: human
```

## Step 5: Create Output Schemas

### schemas/scanner.json

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "needs_review", "priority"],
        "properties": {
          "path": { "type": "string" },
          "needs_review": { "type": "boolean" },
          "priority": { "type": "string", "enum": ["high", "medium", "low"] },
          "reason": { "type": "string" }
        }
      }
    }
  }
}
```

### schemas/reviewer.json

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "reviews": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "rating"],
        "properties": {
          "file": { "type": "string" },
          "rating": { "type": "string", "enum": ["excellent", "good", "needs_improvement", "poor"] },
          "issues": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "section": { "type": "string" },
                "problem": { "type": "string" },
                "suggestion": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

### schemas/summarizer.json

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "summary": { "type": "string" }
  }
}
```

## Step 6: Install

```bash
hamilton workflow install docs-review
```

Verify it appears in the list:

```bash
hamilton workflow list | grep docs-review
```

## Step 7: Run

```bash
cd /path/to/project/with/docs
hamilton workflow run docs-review "Review all documentation files"
```

Monitor progress:

```bash
hamilton workflow logs docs-review-<run-id> -f
```

## Step 8: Add a Variant

Create a `-quick` variant that uses the `fast` model for the scanner and summarizer:

```yaml
# ~/.hamilton/workflows/docs-review/variants/quick.yml
tasks:
  scanner:
    agent:
      model: fast
  summarizer:
    agent:
      model: fast
```

The reviewer still uses `balanced` for quality.

Run with the variant:

```bash
hamilton workflow run docs-review-quick "Review all documentation files"
```

## Step 9: Iterate

After running, inspect the results:

```bash
cat ~/.hamilton/runs/<run-id>/summary.json | jq .
cat ~/.hamilton/runs/<run-id>/task-outputs/<task-id>.json | jq .
```

Common iteration paths:

1. **Agent produces vague output** — tighten the INSTRUCTIONS.md with more specific output format
2. **Task takes too long** — assign a faster model via agent.yml
3. **Schema validation fails** — adjust the JSON schema to match actual agent output
4. **Need another phase** — add a new task with `dependencies: [summarizer]`
5. **Want to reuse an agent** — move it to `~/.hamilton/agents/` for shared use
```

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/custom-workflow.md
git commit -m "docs: add custom workflow tutorial"
```

### Task 14: Write docs/tutorials/custom-guidelines.md

**Files:**
- Create: `docs/tutorials/custom-guidelines.md`

- [ ] **Step 1: Write the file**

```markdown
# Creating Custom Guidelines

Guidelines inject project-specific coding rules and conventions into agent context.
The engine loads guidelines based on your project's file types, so agents always
follow your team's standards without manual prompt engineering.

## What Guidelines Are

Guidelines are markdown files that describe coding conventions for specific
languages or frameworks. When a workflow runs, the engine scans your project's
files, matches them against guideline glob patterns, and injects the matching
guidelines into every agent's system prompt.

Guidelines live in `~/.hamilton/guidelines/<name>/`:

```
~/.hamilton/guidelines/<name>/
  guideline.yml       # Manifest: name, matching patterns, file list
  convention-1.md     # Guideline content
  convention-2.md
```

## Step 1: Create a Guideline

Create the directory and manifest:

```bash
mkdir -p ~/.hamilton/guidelines/react-ts
```

Create `~/.hamilton/guidelines/react-ts/guideline.yml`:

```yaml
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

| Field | Description |
|-------|-------------|
| `matching` | Glob patterns. If any project file matches, the guideline loads. |
| `files` | Relative paths to markdown files in the guideline directory. |

Create `~/.hamilton/guidelines/react-ts/component_patterns.md`:

```markdown
## Component Conventions

- Use functional components with TypeScript interfaces
- Props interfaces must be named `<ComponentName>Props`
- Export as default unless the component is from a barrel export
- Use React.FC only when children are needed
- Keep components under 200 lines; extract sub-components for longer files

## File Organization

- One component per file
- Co-locate styles in <ComponentName>.module.css
- Co-locate tests in <ComponentName>.test.tsx
```

Create `~/.hamilton/guidelines/react-ts/hooks_guide.md`:

```markdown
## Hook Conventions

- Custom hooks start with `use` prefix
- Return an object from hooks, not an array
- Handle loading, error, and success states explicitly
- Use useCallback/useMemo only when profiler shows benefit
- Extract complex hooks into separate files
```

Create `~/.hamilton/guidelines/react-ts/testing_conventions.md`:

```markdown
## Testing Conventions

- Use @testing-library/react for component tests
- Test behavior, not implementation
- Use data-testid only as last resort; prefer role/label queries
- Mock network calls at the fetch/axios level, not the component level
- Each component test covers: rendering, user interaction, error states
```

## Step 2: Register in Settings

Guidelines are auto-discovered from `~/.hamilton/guidelines/`. No settings.yaml
registration is needed — the engine scans the guidelines directory on each run.

## Step 3: Test with a Do Run

```bash
cd /path/to/react-ts-project
hamilton workflow run do "Add a useDebounce hook with tests"
```

The `do` agent will see the react-ts guidelines and apply your conventions
to the generated code.

## Step 4: Iterate

Guideline files are loaded fresh on every run. Edit them and re-run — no
restart or reinstall needed.

Common iteration paths:

1. **Agent ignores a convention** — be more prescriptive: "You MUST..." instead of "Prefer..."
2. **Guidelines are too long** — agents have limited context. Keep each file focused and under 50 lines
3. **Need to exclude some projects** — use more specific glob patterns (e.g., `**/src/**/*.tsx` instead of `**/*.tsx`)
4. **Multiple guideline sets** — create separate guideline directories; the engine loads all matching sets

## Bundled Guidelines

| Guideline | Triggers On |
|-----------|-------------|
| `golang` | `**/*.go`, `go.mod` |

## Guideline Load Order

When multiple guidelines match, the engine loads all of them. Guidelines are
concatenated in alphabetical order by directory name. This is deterministic
but not configurable — design guidelines to be independent and non-overlapping.
```

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/custom-guidelines.md
git commit -m "docs: add custom guidelines tutorial"
```

### Task 15: Write docs/template-expansion.md

**Files:**
- Create: `docs/template-expansion.md`

- [ ] **Step 1: Write the file**

```markdown
# Template Expansion

How template variables and the forEach loop construct work in workflow YAML.

## Template Variables

Template variables use `{{...}}` syntax. The engine renders them via
[Handlebars](https://handlebarsjs.com/) before sending prompts to agents.

### Where Variables Come From

| Source | Syntax | Example |
|--------|--------|---------|
| Workflow input | `{{task}}` | `{{task}}` resolves to the prompt string passed on the CLI |
| Upstream task output | `{{inputs.tasks.<name>.outputs.<field>}}` | `{{inputs.tasks.triage.outputs.severity}}` |
| Workflow metadata | `{{inputs.run_id}}` | `{{inputs.run_id}}` resolves to the current run ID |

### Context Propagation

When a task named `scanner` produces:

```json
{"status": "done", "files": [{"path": "readme.md", "needs_review": true}]}
```

Downstream tasks can access:

```yaml
- name: reviewer
  dependencies: [scanner]
  agent:
    prompt:
      content: |
        Files to review: {{inputs.tasks.scanner.outputs.files}}
```

Only tasks declared in `dependencies` have their outputs available. This enforces
the DAG ordering and prevents accidental access to incomplete outputs.

## forEach Loops

The `forEach` construct iterates a task over a list, executing one instance per
element.

### Basic forEach

```yaml
- name: review-files
  dependencies: [scanner]
  forEach:
    valueFrom:
      ref: scanner
      path: outputs.files
    template:
      agent:
        executorRef: reviewer
        prompt:
          content: |
            Review this file: {{item.path}}
            Priority: {{item.priority}}
```

When `scanner.outputs.files` is a 5-element array, `review-files` executes 5 times —
once per file. The current item is available as `{{item}}`.

### Template Syntax Within forEach

Within a `forEach` template, the current iteration element is `{{item}}`. Upstream
outputs are still available via `{{inputs.tasks.<name>.outputs.<field>}}`.

The `{{item}}` variable is a single element from the referenced array. If the array
contains objects, access fields with dot notation: `{{item.path}}`.

### Context Propagation in Loops

Each forEach iteration produces its own output. The iteration index and output
are available to downstream tasks:

```
review-files
  ├── review-files[0] → { "status": "done", "file": "readme.md", "rating": "good" }
  ├── review-files[1] → { "status": "done", "file": "api.md", "rating": "needs_improvement" }
  └── ...
```

A downstream task can reference all iteration outputs:

```yaml
- name: summarizer
  dependencies: [review-files]
  agent:
    prompt:
      content: |
        Summary of reviews:
        {{inputs.tasks.review-files.outputs}}
```

The `outputs` field for a forEach task is an array of all iteration results.

## Common Pitfalls

### Wrong field path in forEach ref

```yaml
forEach:
  valueFrom:
    ref: scanner
    path: outputs.files  # correct: creates array of 5 items

forEach:
  valueFrom:
    ref: scanner
    path: outputs        # wrong: iterates over the entire output object
```

The `path` must resolve to an array. Non-array values cause a runtime error.

### Unresolved variables

```yaml
prompt:
  content: |
    Severity: {{inputs.tasks.triage.outputs.severty}}
```

A typo (`severty` instead of `severity`) means the variable won't resolve. Test with
`-foreground` mode to see unresolved variables in the rendered prompt.

### Missing dependency

```yaml
- name: reviewer
  dependencies: []          # ← missing 'scanner'
  agent:
    prompt:
      content: |
        {{inputs.tasks.scanner.outputs.files}}  # ← won't resolve
```

Variables from a task are only available if that task is in `dependencies`.

## Nested Template Resolution

Templates are resolved depth-first. If a template variable resolves to a string
that contains template syntax, the engine resolves it again:

```yaml
# Task A output: { "prompt": "Review: {{code}}" }

# Task B prompt:
Review output:
{{inputs.tasks.A.outputs.prompt}}
```

After first pass: `Review: {{code}}` — the engine resolves `{{code}}` from the
current task's context if available. This is rare but can happen with prompt
templates that reference variables from the same task's input.
```

- [ ] **Step 2: Commit**

```bash
git add docs/template-expansion.md
git commit -m "docs: add template expansion explanation"
```

### Task 16: Write docs/how-to/ci-cd-integration.md

**Files:**
- Create: `docs/how-to/ci-cd-integration.md`

- [ ] **Step 1: Write the file**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/how-to/ci-cd-integration.md
git commit -m "docs: add CI/CD integration guide"
```

### Task 17: Write docs/model-aliases.md (extracted from advanced.md §Model Aliases)

**Files:**
- Create: `docs/model-aliases.md`

- [ ] **Step 1: Write the file**

Content based on the Model Aliases section originally from `docs/advanced.md`:

```markdown
# Model Aliases

Map short names to full model IDs for use in agent manifests and workflow YAMLs.

## Configuration

```yaml
# ~/.hamilton/settings.yaml
models:
  aliases:
    fast: google.gemini-flash-2
    balanced: anthropic.claude-sonnet-4
    powerful: anthropic.claude-opus-4
```

## Usage in Agent Manifests

```yaml
# agent.yml
spec:
  settings:
    model: balanced    # resolves to anthropic.claude-sonnet-4
```

## Resolution Chain

1. Check `models.aliases` in settings.yaml for a matching key
2. Recursively resolve until a non-alias value is found
3. Return `"default"` or the raw value if no alias matches

## Model Selection Strategy

- Use `fast` for setup tasks (branch creation, build discovery) -- quick, low-token tasks
- Use `balanced` for implementation tasks (bug fixing, feature development)
- Use `powerful` for analysis tasks (planning, security auditing, verification)
- Use `default` to delegate to the Pi SDK default model

## Circular Reference Detection

```yaml
models:
  aliases:
    a: b
    b: a          # ERROR: CircularModelAliasError detected at load time
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/model-aliases.md
git commit -m "docs: add model aliases reference"
```

### Task 18: README refresh

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README references**

Scan README.md for stale paths and update them:

```bash
grep -n 'docs/' README.md
```

Update any references to match the new directory structure:
- `docs/use-cases.md` → `docs/how-to/use-cases.md` or `docs/how-to/`
- `docs/advanced.md` → `docs/how-to/custom-workflows.md` (or remove)

- [ ] **Step 2: Update README Architecture section**

In the README's `## Architecture` section (currently lines 32-50), all paths should still be valid since those reference `~/.hamilton/`, not `docs/`. Verify no changes needed.

- [ ] **Step 3: Update Getting Started Next Steps in README**

If the README duplicates Getting Started links, update them to match the new structure.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for new documentation structure"
```

### Task 19: Final cross-link audit and link all Phase 3 docs from Getting Started

**Files:**
- Modify: `docs/getting-started.md`

- [ ] **Step 1: Add Phase 3 docs to Getting Started Next Steps**

Update the Next Steps section to its final form:

```markdown
## Next Steps

- [Philosophy](./philosophy.md) -- design rationale and principles behind Hamilton
- [How Workflows Run](./how-workflows-run.md) -- understand what just happened
- [Variants](./variants.md) -- what variants are and how to combine them
- [Model Aliases](./model-aliases.md) -- map short names to model IDs
- [Template Expansion](./template-expansion.md) -- how template variables and forEach work
- [Workflow YAML Reference](./workflow-yaml.md) -- understand the workflow spec format
- [CLI Reference](./cli-reference.md) -- every command and flag
- [Agent System](./agents.md) -- how agents work and how to create them
- [Workflows Catalog](./workflows-catalog.md) -- all built-in workflows
- [Common Use Cases](./how-to/use-cases.md) -- practical patterns for software development
- [Troubleshooting](./how-to/troubleshooting.md) -- resolve common failures
- [Debugging Runs](./how-to/debugging-runs.md) -- inspect and diagnose runs
- [Custom Workflows](./how-to/custom-workflows.md) -- author your own workflows
- [Custom Guidelines](./tutorials/custom-guidelines.md) -- create project-specific coding rules
- [Creating Custom Workflows](./tutorials/custom-workflow.md) -- step-by-step tutorial
- [CI/CD Integration](./how-to/ci-cd-integration.md) -- run workflows in automation
- [Telemetry](./telemetry.md) -- metrics and monitoring
- [MCP Server](./mcp.md) -- Model Context Protocol integration
- [Operations](./how-to/operations.md) -- state machine, backup, performance
- [Settings Reference](./settings.md) -- global configuration
```

- [ ] **Step 2: Global link audit**

```bash
# Verify no broken internal links
find docs/ -name '*.md' -exec grep -Hno '\[.*\](\./[^)]*\.md)' {} \; | while read line; do
  link=$(echo "$line" | grep -o '(\./[^)]*\.md)' | tr -d '()')
  abs="docs/${link#./}"
  if [ ! -f "$abs" ]; then
    echo "BROKEN: $line"
  fi
done
```

- [ ] **Step 3: Final build verification**

```bash
bun run build
```

- [ ] **Step 4: Commit**

```bash
git add docs/getting-started.md
git commit -m "docs: finalize Getting Started Next Steps with all Phase 3 docs"
```

**Phase 3 complete.** Full Diátaxis coverage. Tutorial: 3 entries. How-to: 5 pages. Explanation: 5 pages. Reference: 7 pages. No broken links. Reading path from Getting Started to every document.
```

All phases complete.
