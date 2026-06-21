# Roadmap Issues 3–7 Fixes

Issues from ROADMAP.md "Next Up" section, items 3 through 7:

- **Issue 3:** Add output schema to all workflows based on the output defined in markdown prompts
- **Issue 4:** Fix run command printing nothing. No run id, status, nothing until the workflow ended
- **Issue 5:** Make write_step_output accept a JSON object, not only a JSON string
- **Issue 6:** Task prompt template is not being rendered
- **Issue 7:** Fix status command: it shows the tasks in wrong order (develop as first), should show the task list as last item, with tasks separated by new line, subtasks indented

Scope is strictly issues 3–7. Issues 1 (token usage output) and 2 (retry feedback) are out of scope, even though they share code with issues 4 and 6 respectively.

---

## 1. Template Rendering (Issue 6)

### Problem

`resolveTemplate` (`src/workflow/context.ts:17-23`) only matches `{{word}}` with regex `/\{\{(\w+)\}\}/g` and looks up `context[word]` for a top-level key. But the running context is nested (`tasks.plan.outputs.repo`, `tasks.setup.branch`, etc.), and no workflow YAML defines `context.fields` to flatten values. Most placeholders silently remain as literal `{{...}}` text.

Additionally, `buildAutoContext` drops `vars` (forEach loop variables like `current_story`) when no `context.fields` are defined, returning only `allOutputs`.

### Changes

**`src/workflow/context.ts`:**

- `resolveTemplate`: Change regex from `/\{\{(\w+)\}\}/g` to `/\{\{([\w.]+)\}\}/g`. Delegate resolution to `resolveDottedPath(context, key)`. If resolved value is undefined, preserve the placeholder as-is (existing behavior for missing keys). If resolved value is a string, return it directly; otherwise `JSON.stringify` it.

- `buildAutoContext`: When no `context.fields` is defined, merge `vars` into `allOutputs` instead of returning `allOutputs` alone. This ensures forEach loop variables (like `current_story`) are accessible via `vars.current_story` in templates.

**`src/workflow/runner.ts`:**

- Add `run_id` to the initial `runningContext` map so `{{run_id}}` resolves in prompts. The run ID is available at the start of `runWorkflow`.

**All workflow YAMLs (`workflows/**/workflow.yml`):**

Update every `{{key}}` placeholder to use dotted paths:

| Before | After |
|--------|-------|
| `{{task}}` | `{{task}}` (top-level initial context, no change) |
| `{{repo}}` | `{{tasks.setup.repo}}` |
| `{{branch}}` | `{{tasks.setup.branch}}` |
| `{{build_cmd}}` | `{{tasks.setup.build_cmd}}` |
| `{{test_cmd}}` | `{{tasks.setup.test_cmd}}` |
| `{{current_story}}` | `{{vars.current_story}}` |
| `{{current_story_id}}` | `{{vars.current_story.id}}` |
| `{{current_story_title}}` | `{{vars.current_story.title}}` |
| `{{stories_json}}` | `{{tasks.plan.outputs.stories_json}}` |
| `{{completed_stories}}` | `{{tasks.implement-stories/0.outputs.changes}}` (approximate — exact path depends on upstream task names) |
| `{{changes}}` | `{{tasks.implement-stories/0.outputs.changes}}` (etc.) |
| `{{run_id}}` | `{{run_id}}` |

Placeholders for unimplemented features (`{{retry_feedback}}`, `{{verify_feedback}}`, `{{timeout_retry}}`, `{{progress}}`, `{{stories_remaining}}`, `{{has_frontend_changes}}`) are updated to valid dotted paths but will remain unresolvable until issues 1–2 (out of scope) are implemented. They render as literal `{{...}}` text — existing behavior.

### Files affected

- `src/workflow/context.ts` — resolveTemplate regex, buildAutoContext vars merging
- `src/workflow/runner.ts` — add run_id to initial runningContext
- `workflows/*/workflow.yml` — all 20 files, prompt content updates

---

## 2. Run Command Output (Issue 4)

### Problem

`CliRenderer` exists in `src/cli/subscribers.ts` and handles lifecycle events (WorkflowStarted, StepStarted/Completed/Failed/TimedOut/Retrying/Paused, WorkflowCompleted) with formatted console output. But it is never imported or wired into `executeRun()` in `cli/commands/run.ts` or `executeResume()` in `cli/commands/resume.ts`.

### Changes

**`src/cli/commands/run.ts`:**

- Import `CliRenderer` from `../subscribers.js`
- Add `CliRenderer` subscriber to the `Effect.provide` layer stack alongside `FileLogger` and `EventBusLive`

**`src/cli/commands/resume.ts`:**

- Same change — import and wire `CliRenderer`

No changes to `CliRenderer` itself. Token/timing event handling (issue 1, out of scope) is deferred; the renderer ignores unknown event types.

### Files affected

- `src/cli/commands/run.ts` — import + layer wiring
- `src/cli/commands/resume.ts` — import + layer wiring

---

## 3. Output Schemas (Issue 3)

### Problem

The code infrastructure for output schema validation is fully built (`types.ts`, `schemas.ts`, `runner.ts`, `pi-executor.ts`, `write-step-output-tool.ts` with ajv), but zero workflow YAMLs define `output.schema` on their task agents.

### Changes

Add `output.schema` to every task agent in every workflow YAML. Schemas are defined by agent role based on the documented output format in each agent's AGENTS.md "Output Format" section.

**Schema rules:**
- `required` always includes only `[status]` — extra fields pass through
- `additionalProperties: true` (JSON Schema default) so agents can include fields beyond the schema
- Agents with multiple status values use `enum: ["done", "retry"]` etc.

**Agent role schemas:**

| Role | Schema shape |
|------|-------------|
| planner | `status: enum[done]`, `repo: string`, `branch: string`, `stories_json: array` |
| setup | `status: enum[done]`, `original_branch: string`, `build_cmd: string`, `test_cmd: string`, `ci_notes: string`, `baseline: string` |
| developer | `status: enum[done]`, `repo: string`, `branch: string`, `commits: string`, `changes: string`, `tests: string` |
| verifier | `status: enum[done, retry]`, `verified: string` (done), `issues: array` (retry) |
| tester | `status: enum[done, retry]`, `results: string` (done), `failures: array` (retry) |
| fixer | `status: enum[done]`, `changes: string`, `tests: string` |
| merger | `status: enum[done, retry]`, `merged_branch: string`, `original_branch: string` (done), `reason: string` (retry) |
| investigator | `status: enum[done]`, `root_cause: string`, `affected_files: array`, `severity: string` |
| triager | `status: enum[done]`, `repo: string`, `branch: string`, `priority: string`, `assigned_to: string` |
| reviewer | `status: enum[done]`, `approved: boolean`, `comments: string` |
| scanner | `status: enum[done]`, `findings: array`, `summary: string` |
| prioritizer | `status: enum[done]`, `prioritized_findings: array` |
| scaffolder | `status: enum[done]`, `project_dir: string`, `stack: string`, `files_created: array` |
| doer | `status: enum[done]`, `result: string`, `changes: string` |
| quarantiner | `status: enum[done, failed]`, `quarantined_tests: array` (done), `reason: string` (failed) |

**YAML structure example:**
```yaml
agent:
  ref: agents.setup
  prompt:
    content: "..."
  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        original_branch:
          type: string
        build_cmd:
          type: string
        test_cmd:
          type: string
        ci_notes:
          type: string
        baseline:
          type: string
  on_failure:
    max_retries: 4
    escalate_to: human
```

### Files affected

- `workflows/*/workflow.yml` — all 20 files, ~50-60 task agent entries

---

## 4. write_step_output JSON Object (Issue 5)

### Problem

The tool's parameter is `Type.String`, requiring agents to call `write_step_output('{"status":"done", ...}')` with a stringified JSON. The Pi SDK supports structured object parameters natively.

### Changes

**`src/agent/write-step-output-tool.ts`:**

- Change parameter schema from:
  ```typescript
  input: Type.String({ description: "JSON string with your results..." })
  ```
  to:
  ```typescript
  input: Type.Object({
    status: Type.String({ description: "Completion state: 'done', 'retry', or 'failed'" })
  }, { additionalProperties: true })
  ```

- Remove `JSON.parse(input)` — input is already an object from the Pi SDK
- Remove "Invalid JSON" error path (no longer reachable)
- Keep "duplicate call", "missing status", and "schema validation failed" error paths
- Ajv output schema validation flow unchanged

**`src/agent/activity.ts`:**

- Harness instructions already say "call write_step_output with a JSON object" — no prompt changes needed

### Files affected

- `src/agent/write-step-output-tool.ts`

---

## 5. Status Command (Issue 7)

### Problem

- Tasks displayed in DB insertion order (effectively random due to nanoid suffixes in task IDs), not topological DAG order
- All tasks joined on a single line with two-space separator
- Task list section is not the last item in output
- No indentation for subtask instances (template-expanded tasks like `implement-stories/0`)

### Changes

**`src/cli/commands/status.ts`:**

- **Task ordering:** Load the workflow spec via `loadWorkflowSpec` and use `topologicalSort(collectReachableTasks(tasks))` to produce the correct DAG order. Sort the loaded tasks to match this order before displaying.

- **Display format:** Replace single-line join with newline-separated per-task lines. Format:
  ```
  Tasks:
    ✓  plan (planner)
    ✓  setup (setup)
    ⏳  implement-stories/0 (developer)
       implement-stories/1 (developer)
    ○  verify-stories/0 (verifier)
       verify-stories/1 (verifier)
    ○  test (tester)
  ```

  - `✓` = completed, `⏳` = running, `✗` = failed, `○` = pending
  - Task slug (nanoid suffix stripped by `parseTaskSlug`)
  - Agent name in parentheses
  - Template instances (contain `/` in slug) get 3-space extra indent

- **Reorder sections:** Move tasks section to after tokens and errors, making it the last content section:
  1. Run folder
  2. Workflow
  3. Status (elapsed)
  4. Run ID
  5. Current task (if running)
  6. Tokens
  7. Errors
  8. Tasks (last)

### Files affected

- `src/cli/commands/status.ts`

---

## Implementation Order

Each issue is independently testable. The recommended order follows dependency:

1. **Template rendering** — foundational; everything else depends on templates working
2. **Run command output** — unblocks seeing progress during testing of subsequent issues
3. **Output schemas** — YAML data addition; validated by the already-built ajv pipeline
4. **write_step_output JSON object** — tool parameter type change; needs template-using tests to verify
5. **Status command** — display formatting; independent, can be done last

---

## Testing

- **Template rendering:** Unit tests for `resolveTemplate` with dotted paths (`{{tasks.plan.repo}}`, `{{vars.current_story}}`, `{{run_id}}`). Unit test for `buildAutoContext` merging vars when no `context.fields` defined.
- **Run command output:** Verify `executeRun` streams events to console during execution (not just at end). Same for `executeResume`.
- **Output schemas:** Integration test — an agent that calls `write_step_output` with malformed output is rejected by ajv. An agent calling with valid output passes.
- **write_step_output:** Update existing tool unit tests to pass objects instead of strings. Verify duplicate call, status, and schema validation still work.
- **Status command:** Unit test `formatStatus` with known task list produces expected ordering, newline separation, and indentation.
