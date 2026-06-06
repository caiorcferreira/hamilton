# Hamilton Blocking Gaps Fix — Design

Date: 2026-06-06

## Summary

6 blocking gaps prevent Hamilton from being usable end-to-end. The root causes fall into two categories: no bootstrap/init mechanism, and resume doesn't restart execution. This design introduces a `hamilton init` command, a state machine for the runner, two-tier agent resolution, and guard checks across all commands.

## Gap 1-3, 5-6: `hamilton init` command

A new `init` subcommand bootstraps the entire `~/.hamilton/` directory. It is idempotent — safe to run multiple times.

### What `init` does

1. Creates directories:
   - `~/.hamilton/agents/`
   - `~/.hamilton/workflows/`
   - `~/.hamilton/runs/`
   - `~/.hamilton/executors/pi/agent/`
2. Opens the SQLite DB at `~/.hamilton/hamilton.db` — triggers `CREATE TABLE IF NOT EXISTS` schema creation
3. Copies each subdirectory from project `agents/shared/` to `~/.hamilton/agents/` (the "shared" prefix is a bundling convention, not a runtime namespace — e.g. `agents/shared/pr/AGENTS.md` → `~/.hamilton/agents/pr/AGENTS.md`)
4. Calls `installAllWorkflows()` to copy all bundled workflows to `~/.hamilton/workflows/<id>/`
5. For each installed workflow, copies `workflows/<id>/agents/<name>/` to `~/.hamilton/agents/<name>/`, skipping if already exists (unless `--force`)
6. Prints a summary of what was created

### Guard checks on other commands

Every command that needs `~/.hamilton/` checks `Fs.existsSync(hamiltonHome())` and prints:

```
Hamilton is not initialized. Run "hamilton init" first.
```

Affected commands: `workflow run`, `status`, `logs`, `pause`, `resume`, `list`, `install`, `uninstall`.

### New files

- `src/cli/commands/init.ts` — `initHamilton(options?: { force?: boolean }): Effect<void, InitError>`

### Modified files

- `src/cli/main.ts` — add `init` subcommand routing + guard checks
- `src/paths.ts` — add `ensureHamiltonHome()` helper

## Gap 5: Two-tier agent persona resolution

Agent personas live in two places at runtime:
- `~/.hamilton/workflows/<workflowId>/agents/<agentId>/` — workflow-local
- `~/.hamilton/agents/<agentId>/` — shared pool (populated by `init`)

### Resolution order

The runner now receives the `workflowId`. When resolving an agent by ID:

1. Check `~/.hamilton/workflows/<workflowId>/agents/<agentId>/AGENTS.md`
2. Fall back to `~/.hamilton/agents/<agentId>/AGENTS.md`
3. If neither exists, fail with a clear error:

```
Agent "triager" not found in workflow "bug-fix" or shared agents. Check "hamilton init".
```

No more silently swallowing persona load failures.

### Modified files

- `src/agent/persona.ts` — `loadPersona` replaced by `resolvePersona(agentId: string, workflowId: string): Effect<Persona, PersonaLoadError>` that does two-tier lookup
- `src/workflow/runner.ts` — pass `spec.id` as `workflowId` to agent resolution

## Gap 4: Resume via state machine pattern

Define explicit states and transitions for both runs and steps. The runner operates as a deterministic state machine instead of checking ad-hoc string conditions.

### Run states and transitions

```
idle ──(start)──▶ running ──(all steps done)──▶ completed
                     │
                     ├──(pause cmd)──▶ paused ──(resume cmd)──▶ running
                     │
                     └──(step failed)──▶ failed
```

### Step states and transitions

```
pending ──(start)──▶ running ──(Pi returns)──▶ completed
                        │
                        └──(Pi error/timeout)──▶ failed
```

### `WorkflowRuntime` factory (`src/workflow/run-state-machine.ts`)

A state machine object that owns the DB connection and enforces valid transitions:

```typescript
interface WorkflowRuntime {
  runId: string
  state: RunState

  start(runId?: string): Effect<WorkflowRuntime, EngineError>
  // If runId given and paused → loads prior state, transitions to running, returns stepSequence.
  // If no runId → INSERTs new run, creates step rows, returns full stepSequence.

  shouldExecuteStep(stepId: string): Effect<boolean, EngineError>
  // Returns false if step is already "completed" in DB (resume skipping).

  shouldPause(): Effect<boolean, EngineError>
  // Checks deferred table for pause-<runId> flag AND validates current state is "running".

  transitionStep(stepId: string, transition: StepTransition): Effect<void, EngineError>
  // pending→running, running→completed, running→failed. Rejects invalid transitions.

  pause(): Effect<void, EngineError>
  // running→paused. Stores deferred state.

  fail(error: string): Effect<void, EngineError>
  // running→failed.

  complete(): Effect<void, EngineError>
  // running→completed.

  close(): Effect<void>
}
```

### Runner changes

The runner creates a `WorkflowRuntime` instead of calling `initializeRun`. Key changes:

1. `WorkflowRuntime.start(existingRunId?)` — creates new run OR resumes existing
2. Step loop: `runtime.shouldExecuteStep(stepId)` — skips completed steps on resume
3. Deferred check: `runtime.shouldPause()` — replaces raw `getDeferredState` check
4. Step transitions via `runtime.transitionStep(stepId, "start")` / `runtime.transitionStep(stepId, "complete")` / `runtime.transitionStep(stepId, "fail")`
5. Workflow completion via `runtime.complete()` or `runtime.fail(error)`

### Resume command (`src/cli/commands/resume.ts`)

1. Open DB, load the run — assert status is `paused`
2. Set deferred flag from `paused` back to `pending`
3. Load the workflow YAML from `~/.hamilton/workflows/<workflowId>/workflow.yml`
4. Load accumulated context from `workflow_state` table
5. Load completed step outputs from `~/.hamilton/runs/<runId>/step-outputs/`
6. Call `runWorkflow(spec, context, { onEvent, workflowsDir }, existingRunId)` — the state machine skips completed steps

### Runner signature change

`runWorkflow` gains an optional `existingRunId?: string` parameter. When provided, `WorkflowRuntime.start(existingRunId)` resumes the run instead of creating a new one.

## New files

- `src/cli/commands/init.ts` — `initHamilton(options?)` bootstrap logic
- `src/workflow/run-state-machine.ts` — state machine types + `WorkflowRuntime` factory

## Modified files

- `src/workflow/runner.ts` — two-tier agent resolution, state machine integration, skip completed steps, optional `existingRunId`
- `src/workflow/workflow-engine.ts` — remove standalone checkpoint functions (folded into state machine); keep `buildRunId`, `computeStepOrder`, `resolveStepTimeout`
- `src/agent/persona.ts` — `resolvePersona(agentId, workflowId)` with two-tier lookup
- `src/cli/commands/resume.ts` — load state, YAML, context, outputs; call `runWorkflow` with existing runId
- `src/cli/commands/run.ts` — guard check for `hamiltonHome()`, pass `existingRunId` support
- `src/cli/commands/pause.ts` — guard check for `hamiltonHome()`
- `src/cli/commands/status.ts` — guard check for `hamiltonHome()`
- `src/cli/commands/logs.ts` — guard check for `hamiltonHome()`
- `src/cli/commands/list.ts` — guard check for `hamiltonHome()`
- `src/cli/commands/install.ts` — guard check for `hamiltonHome()`
- `src/cli/main.ts` — add `init` subcommand routing, add guard checks
- `src/paths.ts` — add `ensureHamiltonHome()` helper

## Implementation order

1. `src/paths.ts` — add `ensureHamiltonHome()`
2. `src/cli/commands/init.ts` — bootstrap logic
3. `src/agent/persona.ts` — two-tier `resolvePersona`
4. `src/workflow/run-state-machine.ts` — `WorkflowRuntime`
5. `src/workflow/runner.ts` — integrate state machine, agent resolution, resume support
6. `src/cli/commands/resume.ts` — load state → call runner
7. `src/cli/commands/*` — add guard checks
8. `src/cli/main.ts` — wire `init` + guard checks
9. Clean up `src/workflow/workflow-engine.ts` — remove checkpoint functions
10. Add tests for init, persona resolution, state machine, resume
