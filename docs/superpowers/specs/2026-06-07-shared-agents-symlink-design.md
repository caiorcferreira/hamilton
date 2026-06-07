# Shared Agents Symlink — Design Spec

**Date:** 2026-06-07
**Status:** approved
**Scope:** Fix how shared agent personas are distributed and resolved at runtime.

## Problem

1. `hamilton init` copies per-workflow agents (triager, investigator, fixer, etc.) into `~/.hamilton/agents/` alongside the shared agents. Only the 4 shared agents (`do`, `pr`, `setup`, `verifier`) should live in the global agents directory.

2. Workflow YAMLs use fragile `../../agents/shared/<name>/...` relative paths to reference shared agents. These traverse up two directories from the workflow install dir, relying on path math that is brittle and opaque.

3. No symlink logic exists — all agent distribution is done via full file copies.

## Solution

Per-workflow agents stay in their workflow directory. Shared agents live in `~/.hamilton/agents/`. Each installed workflow gets a `shared/agents` symlink pointing to `~/.hamilton/agents/`, allowing YAML paths like `shared/agents/setup/AGENTS.md` — clean, canonical, and self-documenting.

### Directory layout after fix

```
~/.hamilton/
  agents/
    do/           ← from agents/shared/do/
    pr/           ← from agents/shared/pr/
    setup/        ← from agents/shared/setup/
    verifier/     ← from agents/shared/verifier/
    # NO per-workflow agents here
  workflows/
    bug-fix/
      agents/          ← per-workflow: triager, investigator, fixer
      shared/
        agents/ → symlink → ../../agents (→ ~/.hamilton/agents/)
      workflow.yml     ← paths: shared/agents/setup/AGENTS.md
```

## Design

### 1. Remove `copyWorkflowAgents` from init

File: `src/cli/commands/init.ts`

- Delete the `copyWorkflowAgents()` function (lines 39–64).
- Remove its call from `initHamilton()`.
- Remove any imports that become unused as a result.

After this, `~/.hamilton/agents/` contains only the 4 shared agent directories populated by `copySharedAgents()`.

### 2. Change YAML paths for shared agents

In all 20 workflow YAML files under `workflows/`, replace every shared agent reference:

```
Before:  ../../agents/shared/<name>/AGENTS.md
After:   shared/agents/<name>/AGENTS.md
```

Same pattern for `SOUL.md` and `IDENTITY.md`. Affected agent names: `setup`, `verifier`, `pr`. The `do` workflow has no shared agent references and needs no YAML changes.

At runtime, `resolvePersona` receives `shared/agents/<name>/AGENTS.md` relative to the workflow directory. Since `shared/agents/` is a symlink to `~/.hamilton/agents/`, `Path.resolve` follows it transparently.

### 3. Shared helper for symlink creation

New file: `src/workflow/shared-agents.ts`

Exports a single function:

```typescript
ensureSharedAgentsSymlink(workflowDir: string): Effect<void, SharedAgentsSymlinkError>
```

Implementation:
- Target: `agentsDir()` (resolves to `~/.hamilton/agents`)
- Link path: `Path.resolve(workflowDir, "shared", "agents")`
- Create parent directory `shared/` if needed.
- If something exists at the link path: check if it is a symlink with the correct target. If yes, no-op. Otherwise, remove it and create the symlink.
- Use `Effect.try` for all FS operations, mapping errors to `SharedAgentsSymlinkError` (a `Data.TaggedError`).

### 4. Symlink creation at install time

File: `src/cli/commands/install-logic.ts`

In `installWorkflow()`, after copying the workflow directory to its destination, call `ensureSharedAgentsSymlink(workflowDestDir)`. The install pipeline already runs inside Effect, so the call integrates naturally.

### 5. Symlink verification at run time

File: `src/workflow/runner.ts`

Before the task execution loop begins, call `ensureSharedAgentsSymlink(workflowDir)`. This is a lightweight guard — in normal operation the symlink already exists from install, but it catches edge cases (manual directory manipulation, partial installs, etc.).

### 6. Test changes

**`tests/cli/init.test.ts`:**
- Replace test `"copies per-workflow agents to shared agents dir"` with `"does NOT copy per-workflow agents to shared agents dir"` — asserts that `~/.hamilton/agents/` does not contain `triager`, `investigator`, `fixer` after init.
- All other 7 test cases remain unchanged.

**`tests/cli/install.test.ts`:**
- Add `"creates shared/agents symlink on install"` — install a workflow, assert symlink exists at `<workflowDir>/shared/agents`, readlink matches `agentsDir()`.
- Add `"replaces stale shared/agents symlink on re-install"` — manually create a wrong symlink, re-install, assert correct target.

**`tests/workflow/runner.test.ts`:**
- Add `"creates shared/agents symlink when missing before execution"` — run with no symlink, assert it is created.
- Add `"fixes broken shared/agents symlink before execution"` — wrong target, assert corrected.

**`tests/agent/persona.test.ts`:**
- Add `"resolves shared agent through symlink"` — create temp structure with symlink, call `resolvePersona` with `shared/agents/<name>/` paths, assert content matches.

**`tests/workflow/shared-agents.test.ts`:** (new file)
- `"creates symlink when link path does not exist"`
- `"no-ops when correct symlink already exists"`
- `"replaces when wrong target exists"`
- `"replaces when a file (not symlink) exists at link path"`
- `"fails with SharedAgentsSymlinkError when source does not exist"`
- `"creates shared/ parent directory if missing"`

## Error handling

- `SharedAgentsSymlinkError` (new `Data.TaggedError` in `src/workflow/shared-agents.ts`): wraps any FS error during symlink creation or verification.
- If the symlink cannot be created or verified at run time, the workflow fails before any task executes — fast failure, clear error.
- At install time, the same error propagates through the install Effect pipeline.

## Files changed

| File | Change |
|------|--------|
| `src/cli/commands/init.ts` | Remove `copyWorkflowAgents()` and its call |
| `src/cli/commands/install-logic.ts` | Call `ensureSharedAgentsSymlink` in `installWorkflow` |
| `src/workflow/runner.ts` | Call `ensureSharedAgentsSymlink` before task loop |
| `src/workflow/shared-agents.ts` | New file — `ensureSharedAgentsSymlink` + `SharedAgentsSymlinkError` |
| `workflows/*/workflow.yml` (20 files) | `../../agents/shared/...` → `shared/agents/...` |
| `tests/cli/init.test.ts` | Negative test for per-workflow agents |
| `tests/cli/install.test.ts` | Symlink tests |
| `tests/workflow/runner.test.ts` | Symlink verification tests |
| `tests/agent/persona.test.ts` | Symlink resolution test |
| `tests/workflow/shared-agents.test.ts` | New file — unit tests for `ensureSharedAgentsSymlink` |

## Non-goals

- Restructuring the `~/.hamilton/agents/` directory layout
- Changing how per-workflow agents are bundled inside workflow directories
- Altering `resolvePersona` logic — it continues to work with `Path.resolve(workflowDir, path)`
