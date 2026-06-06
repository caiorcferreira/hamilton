# Hamilton Tool-Based Agent Output — Design

Date: 2026-06-06

## Summary

The current approach parses LLM text output as JSON via `parseAgentOutput`, but the LLM often produces structured text formats (STATUS/REPO/BRANCH/STORIES_JSON) that are not valid JSON, causing parse failures and retries. This design replaces text-parsing with a custom `write_step_output` tool. The agent calls the tool to save its result to a file, and the runner reads the file after the session ends. This eliminates parse errors, removes the need for `parseAgentOutput` and `extractTextContent`, and gives the agent control over its output format.

## Architecture

```
Before: LLM produces text → parseAgentOutput(text) → returns Record → runner writes file
After:  LLM calls write_step_output tool → tool validates & writes file → runner reads file
```

Three components change:
- **`write_step_output` tool** (new): a custom tool registered with the Pi SDK. Takes a JSON string, validates it has a `status` field, writes to `step-outputs/<step-id>.json`. Rejects duplicate calls (write-once).
- **`buildAgentPrompt`** (modified): adds a "Hamilton Workflow System" section explaining workflows, steps, and the contract: every step MUST call `write_step_output` to save its result. This section comes before identity/soul/context/agents.
- **`executeWithPi` / runner** (simplified): after `session.prompt()` completes, reads `step-outputs/<step-id>.json` instead of scraping assistant text. No more `parseAgentOutput`, `extractTextContent`, or retries on parse failures.

## The `write_step_output` Tool

New file: `src/agent/write-step-output-tool.ts`

A custom tool registered with the Pi SDK (analogous to `bash` or `read_file`). The LLM calls it with a JSON string input.

### Validation

1. Parseable JSON
2. Must be an object (not array/primitive)
3. Must have a `status` field of type `string`

### Behavior

- On success: writes to `stepOutputFile(runId, stepId)` and returns confirmation
- On failure: returns error message (e.g. "Missing required field: status") — the LLM can retry within the same session
- Write-once: rejects a second call with "Output already written for this step"

### Registration

`executeWithPi` passes the tool to `createAgentSession` via the tools array. The tool receives `runId` and `stepId` injected at registration time.

## Hamilton System Prompt Section

Added to `buildAgentPrompt` in `activity.ts`, placed as the first section (before identity/soul/context/agents):

```
## Hamilton Workflow System

You are executing a step within a Hamilton workflow. A workflow is a sequence of steps
that pass context between them. Your job is to complete one step and save your result.

### How to finish your step

When you have completed your work, call the write_step_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent steps.

Example: write_step_output with { "status": "done", "repo": "/path/to/repo", ... }

IMPORTANT:
- You MUST call write_step_output exactly once — it will reject duplicate calls
- Do NOT output your results as text in your response — use the tool
- The tool validates that your output is valid JSON with a "status" field
```

The hardcoded `"\n\nWhen complete, respond with a JSON object containing your results."` line appended to the task prompt is removed — that instruction now lives in the system prompt section above.

## Runner & `executeWithPi` Changes

### `executeWithPi` (`pi-executor.ts`)

- Registers `write_step_output` tool in session creation
- After `session.prompt()` resolves, reads `stepOutputFile(runId, stepId)` and parses as JSON
- Returns the parsed `Record<string, unknown>`
- Removes: `extractTextContent`, `parseAgentOutput` calls, "No assistant response" / "no text content" error paths
- If file doesn't exist: returns `PiExecutionError("Step did not call write_step_output")`
- Timeout handling unchanged (handled at runner level)

### `runner.ts`

- No behavioral changes at orchestration level — still calls `executeWithPi`, writes output via `writeStepOutput`, extracts context via `extractContextFromOutput`
- `max_retries` / `Effect.retry` stays for transient failures (network, timeout), but parse failures are eliminated
- `buildAgentPrompt` drops the hardcoded JSON instruction from task prompt

## Edge Cases

| Scenario | Behavior |
|---|---|
| Agent never calls `write_step_output` | File doesn't exist → `executeWithPi` returns `PiExecutionError("Step did not call write_step_output")` → runner retries or fails |
| Agent calls with invalid JSON | Tool returns error to LLM. LLM can retry in-session |
| Agent calls with missing `status` | Tool returns validation error to LLM. Same in-session recovery |
| Agent calls twice | Tool rejects with "Output already written". First write is authoritative |
| Timeout before tool call | `Effect.timeout` fires → runner handles as today (step_timeout, fail state) |
| Tool call but disk write fails | Tool returns error to LLM. Session ends without file → runner gets "did not call" error |

## Files Changed

### New
- `src/agent/write-step-output-tool.ts` — tool definition, JSON validation, file write logic
- `tests/agent/write-step-output-tool.test.ts` — tool unit tests

### Modified
- `src/agent/activity.ts` — add Hamilton section to `buildAgentPrompt`, remove `parseAgentOutput` and `AgentOutputParseError`, remove hardcoded JSON instruction from task prompt
- `src/agent/pi-executor.ts` — register `write_step_output` in session tools, replace text-parsing with file-read after `session.prompt()`, remove `extractTextContent`
- `src/workflow/runner.ts` — remove `appendStepLog` for retry (already handled by tool path), otherwise unchanged

### Deleted
- `tests/agent/activity.test.ts` — `parseAgentOutput` describe block
