# Change Artifacts Directory & Curator Agent

**Date:** 2026-06-21
**Status:** approved

## Problem

Hamilton workflows (feature-dev, bug-fix, quarantine-broken-tests, scaffold) produce artifacts — plans, progress logs — but these are scattered. Plans exist only in task output JSON, and progress tracking in `~/.hamilton/runs/<run-id>/` is per-run, not per-change. There's no way to look at a directory and see "what changed, why, and what happened."

## Solution

Introduce `.hamilton/changes/<change-id>/` as the canonical storage for per-change artifacts within the project directory. Add a curator agent that determines the change-id from the user prompt before the workflow runs. Agents write their plan and progress directly into the change directory.

## Design

### 1. Directory structure

```
.hamilton/changes/
  next-id.txt                              # "042" (next available sequential ID)
  001-add-dark-mode/
    workflow.metadata.json
    plan.md
    progress.md
  002-fix-auth-bug/
    workflow.metadata.json
    plan.md
    progress.md
```

`next-id.txt` is a plain-text counter, read-incremented-write by the runner before the curator call. If missing, it's created with `001`.

### 2. Change ID format

`<padded-seq>-<kebab-title>` — e.g., `042-fix-login-timeout`. The sequential portion is zero-padded to 3 digits. The title portion comes from the curator agent.

### 3. Curator agent

The curator is a full internal agent invoked pre-workflow by the runner. It does not appear in any workflow YAML. It is not visible to workflow agents.

**Location:** `src/curator/` — persona and prompts are TypeScript constants (no disk files).

**System prompt** (constant):

```
You determine the change ID for a Hamilton workflow run.
Extract a concise, kebab-case title (max 5 words) from the user's request.
Return your answer via write_task_output.
```

**Input prompt** (template):

```
Given this user request, what is a good kebab-case title for this change? Return exactly the title portion (no sequential number).

Request: ${prompt}
```

**Output schema:**

```json
{ "change_id": "fix-login-timeout" }
```

The curator returns only the title portion. The runner prepends the padded sequential ID to form the full change-id.

**Execution:** `executeCurator(userPrompt)` — a fresh Pi agent session, single-turn. Uses `write_task_output` for structured output. Emits standard engine events.

**Fallback:** If the curator fails (timeout, API error, malformed output), change-id falls back to `untitled-<timestamp>` and the run proceeds.

### 4. `workflow.metadata.json`

Written once at run start, after the curator resolves the change-id and the workflow spec is loaded. Never modified.

```json
{
  "workflow_id": "feature-dev-aB3xY",
  "change_id": "042-fix-login-timeout",
  "tasks": ["plan", "implement", "verify"],
  "input_prompt": "Add dark mode toggle to settings",
  "hamilton_version": "0.1.0",
  "created_at": "2026-06-21T14:30:00.000Z",
  "variants": ["worktree", "github_pr"]
}
```

- `workflow_id` — full run ID including the nanoid (from `buildRunId()`)
- `tasks` — topologically-sorted task names from the DAG
- `hamilton_version` — from `package.json` version, resolved at build time
- `variants` — active variants for this run

### 5. `plan.md`

Written by the planner agent. The planner's `INSTRUCTIONS.md` is updated to instruct it to create `plan.md` in the change directory (passed via `WorkflowEnv.change_dir`) before returning its JSON task output. The runner does not touch this file — it's purely an agent responsibility.

### 6. `progress.md`

Append-only log. Every agent appends a timestamped entry after completing its work. The responsibility lives in each agent's `INSTRUCTIONS.md`:

```markdown
## Progress

After completing your work, append a section to `{{change_dir}}/progress.md` with what you did:

\`\`\`markdown
## {{timestamp}} — {{task_name}} ({{model}})

- Change A
- Change B

---
\`\`\`
```

The change directory path is injected into `WorkflowEnv` as `change_dir` and accessible via Handlebars templating.

### 7. Runner integration

The runner's flow becomes:

1. Generate run ID (`feature-dev-aB3xY`)
2. Load workflow spec (existing)
3. Read `next-id.txt`, increment, write back
4. Call curator executor → get title portion → assemble full change-id
5. Create `.hamilton/changes/<id>/` directory
6. Inject `change_dir` into `WorkflowEnv`
7. Write `workflow.metadata.json`
8. Execute workflow tasks (agents write `plan.md` and `progress.md` themselves)

### 8. Error handling

| Failure | Behavior |
|---------|----------|
| `next-id.txt` missing | Create with `001`, proceed |
| Curator timeout / API error | Fallback to `untitled-<timestamp>` |
| Curator returns malformed output | Fallback to `untitled-<timestamp>` |
| Change dir already exists | Append `-<N>` suffix, proceed |
| Agent fails to write plan/progress | Non-fatal warning, run continues |

### 9. What is not included

- Cleanup of old change directories — out of scope
- CLI commands to list or inspect changes — out of scope
- Linking multiple runs to the same change — one change = one run for now
- Progress validation (checking that agents actually wrote progress) — out of scope
