# Refactor Pi Logic into executors/pi Package

Date: 2026-06-09

## Overview

Move Pi-specific code out of `src/agent/` and `src/observability/` into a dedicated `src/executors/pi/` package. Extract the generic validation core from `write-step-output-tool.ts` into `src/agent/write-step-output.ts`. All generic agent logic (activity, persona, config, instructions) stays in `src/agent/`.

## New Package Structure

```
src/executors/pi/
  pi-executor.ts              ← src/agent/pi-executor.ts
  rtk-extension.ts            ← src/agent/rtk-extension.ts
  streaming.ts                ← src/observability/streaming.ts
  paths.ts                    ← piAgentDir() from src/paths.ts
  write-step-output-tool.ts   ← src/agent/write-step-output-tool.ts (Pi wrapper)

src/agent/
  activity.ts                 (unchanged)
  config.ts                   (unchanged)
  persona.ts                  (unchanged)
  instructions.ts             (unchanged)
  write-step-output.ts        (NEW — generic core)

tests/executors/pi/
  rtk-extension.test.ts       ← tests/agent/rtk-extension.test.ts
  write-step-output-tool.test.ts ← tests/agent/write-step-output-tool.test.ts

tests/agent/
  write-step-output.test.ts   (NEW — tests for generic core)
  (all other test files unchanged)
```

## File Changes

### src/agent/write-step-output.ts (NEW)

Generic validation and file-writing. No Pi SDK imports. Exports:

```ts
export interface WriteOutputResult {
  success: boolean
  error?: string
}

export function validateAndWriteOutput(
  runId: string,
  stepId: string,
  outputSchema: Record<string, unknown> | undefined,
  input: unknown,
  onComplete: () => void
): WriteOutputResult
```

Extracts the core logic from the current `createWriteStepOutputTool`:
- `Fs.existsSync` duplicate check
- Type guard for object (not array/null/primitive)
- Status field validation
- Ajv schema compilation and validation
- Directory creation and file write
- `onComplete` callback

### src/executors/pi/write-step-output-tool.ts

Thin Pi wrapper. Imports the generic core and `defineTool`/`ToolDefinition` from Pi SDK:

```ts
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent"
import { validateAndWriteOutput } from "../../agent/write-step-output.js"
```

The `execute` handler delegates to `validateAndWriteOutput`, maps the result to Pi's tool response format (`{ content: [...], details: {} }`).

### src/executors/pi/paths.ts (NEW)

```ts
export function piAgentDir(): string {
  return Path.join(hamiltonHome(), "executors", "pi", "agent")
}
```

Moved from `src/paths.ts`.

### src/paths.ts

- Remove `piAgentDir()` export
- `ensureHamiltonHome()` still creates `executors/pi/agent/` during init — uses `Path.join(hamiltonHome(), "executors", "pi", "agent")` directly

### Import Updates

| File | Old Import | New Import |
|------|-----------|------------|
| `src/workflow/runner.ts` | `../agent/pi-executor.js` | `../executors/pi/pi-executor.js` |
| `src/workflow/runner.ts` | `../agent/instructions.js` | unchanged |
| `src/agent/pi-executor.ts` → `executors/pi/pi-executor.ts` | `./write-step-output-tool.js` | `./write-step-output-tool.js` |
| `src/agent/pi-executor.ts` → `executors/pi/pi-executor.ts` | `./rtk-extension.js` | `./rtk-extension.js` |
| `src/agent/pi-executor.ts` → `executors/pi/pi-executor.ts` | `../observability/streaming.js` | `./streaming.js` |
| `src/agent/pi-executor.ts` → `executors/pi/pi-executor.ts` | `../paths.js` | `./paths.js` |
| `src/observability/streaming.ts` → `executors/pi/streaming.ts` | `../events/bus.js` | `../../events/bus.js` |
| `tests/agent/rtk-extension.test.ts` → `tests/executors/pi/rtk-extension.test.ts` | `../../src/agent/rtk-extension.js` | `../../../src/executors/pi/rtk-extension.js` |
| `tests/agent/write-step-output-tool.test.ts` → `tests/executors/pi/write-step-output-tool.test.ts` | `../../src/agent/write-step-output-tool.js` | `../../../src/executors/pi/write-step-output-tool.js` |
| `tests/cli/run.test.ts` | `../../src/agent/pi-executor.js` | `../../src/executors/pi/pi-executor.js` |

## Error Handling

No change. Existing error types (`PiExecutionError`, `RunDirError`) stay in their current files. `PiExecutionError` stays in `executors/pi/pi-executor.ts`.

## Testing

| Test File | Status |
|-----------|--------|
| `tests/agent/activity.test.ts` | Unchanged |
| `tests/agent/config.test.ts` | Unchanged |
| `tests/agent/persona.test.ts` | Unchanged |
| `tests/agent/instructions.test.ts` | Unchanged |
| `tests/agent/write-step-output.test.ts` | NEW — tests generic validateAndWriteOutput |
| `tests/executors/pi/write-step-output-tool.test.ts` | Moved from tests/agent/ — tests Pi wrapper |
| `tests/executors/pi/rtk-extension.test.ts` | Moved from tests/agent/ |
| `tests/cli/run.test.ts` | Mock path updated |
