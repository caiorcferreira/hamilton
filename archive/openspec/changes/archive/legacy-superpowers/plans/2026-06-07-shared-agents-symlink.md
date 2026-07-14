# Shared Agents Symlink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix shared agent distribution — remove per-workflow agent duplication in `~/.hamilton/agents/`, replace fragile `../../agents/shared/` YAML paths with symlink-based `shared/agents/` paths.

**Architecture:** New module `src/workflow/shared-agents.ts` exports `ensureSharedAgentsSymlink(workflowDir)` which creates/verifies a `<workflowDir>/shared/agents → ~/.hamilton/agents` symlink. Called at install time (install-logic.ts) and verified at run time (runner.ts). `init.ts` drops `copyWorkflowAgents`. All 19 workflow YAMLs change `../../agents/shared/` → `shared/agents/`.

**Tech Stack:** TypeScript, Effect-TS, Node.js `fs` (symlinkSync, lstatSync, readlinkSync), bun:sqlite, vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/workflow/shared-agents.ts` | **New** — `ensureSharedAgentsSymlink()` + `SharedAgentsSymlinkError` |
| `tests/workflow/shared-agents.test.ts` | **New** — unit tests for symlink helper |
| `src/cli/commands/init.ts` | **Modify** — remove `copyWorkflowAgents()` |
| `src/cli/commands/install-logic.ts` | **Modify** — call `ensureSharedAgentsSymlink` in `installWorkflow` |
| `src/workflow/runner.ts` | **Modify** — call `ensureSharedAgentsSymlink` before task loop |
| `tests/cli/init.test.ts` | **Modify** — replace per-workflow-agent-copy test with negative test |
| `tests/cli/install.test.ts` | **Modify** — add symlink tests |
| `tests/agent/persona.test.ts` | **Modify** — add symlink resolution test |
| `workflows/*/workflow.yml` (19 files) | **Modify** — `../../agents/shared/` → `shared/agents/` |

---

### Task 1: Create `ensureSharedAgentsSymlink` module + tests

**Files:**
- Create: `src/workflow/shared-agents.ts`
- Create: `tests/workflow/shared-agents.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/workflow/shared-agents.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { ensureSharedAgentsSymlink, SharedAgentsSymlinkError } from "../../src/workflow/shared-agents.js"

describe("ensureSharedAgentsSymlink", () => {
  let tmpDir: string
  let agentsDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-symlink-"))
    agentsDir = Path.join(tmpDir, "agents")
    Fs.mkdirSync(agentsDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentsDir, "setup", "AGENTS.md"), "shared setup agent")
    Fs.mkdirSync(Path.join(agentsDir, "setup"), { recursive: true })
    Fs.writeFileSync(Path.join(agentsDir, "setup", "AGENTS.md"), "shared setup agent")
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates symlink when link path does not exist", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "bug-fix")
    Fs.mkdirSync(workflowDir, { recursive: true })

    const exit = await Effect.runPromiseExit(
      ensureSharedAgentsSymlink(workflowDir, agentsDir)
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(Fs.readlinkSync(linkPath)).toBe(agentsDir)
  })

  it("no-ops when correct symlink already exists", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "bug-fix")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.symlinkSync(agentsDir, Path.join(sharedDir, "agents"), "dir")

    const exit = await Effect.runPromiseExit(
      ensureSharedAgentsSymlink(workflowDir, agentsDir)
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.readlinkSync(linkPath)).toBe(agentsDir)
  })

  it("replaces symlink when wrong target exists", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "bug-fix")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    const wrongDir = Path.join(tmpDir, "wrong-agents")
    Fs.mkdirSync(wrongDir, { recursive: true })
    Fs.symlinkSync(wrongDir, Path.join(sharedDir, "agents"), "dir")

    const exit = await Effect.runPromiseExit(
      ensureSharedAgentsSymlink(workflowDir, agentsDir)
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.readlinkSync(linkPath)).toBe(agentsDir)
  })

  it("replaces when a file (not symlink) exists at link path", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "bug-fix")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(sharedDir, "agents"), "not a symlink")

    const exit = await Effect.runPromiseExit(
      ensureSharedAgentsSymlink(workflowDir, agentsDir)
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(Fs.readlinkSync(linkPath)).toBe(agentsDir)
  })

  it("creates shared/ parent directory if missing", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "bug-fix")
    Fs.mkdirSync(workflowDir, { recursive: true })
    expect(Fs.existsSync(Path.join(workflowDir, "shared"))).toBe(false)

    const exit = await Effect.runPromiseExit(
      ensureSharedAgentsSymlink(workflowDir, agentsDir)
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(workflowDir, "shared"))).toBe(true)
    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/workflow/shared-agents.test.ts`
Expected: FAIL — `Cannot find module '../../src/workflow/shared-agents.js'`

- [ ] **Step 3: Write implementation**

```typescript
// src/workflow/shared-agents.ts
import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"

export class SharedAgentsSymlinkError extends Data.TaggedError("SharedAgentsSymlinkError")<{
  workflowDir: string
  message: string
}> {}

export function ensureSharedAgentsSymlink(
  workflowDir: string,
  agentsDir?: string
): Effect.Effect<void, SharedAgentsSymlinkError> {
  return Effect.gen(function* () {
    const target = agentsDir ?? Path.resolve(workflowDir, "..", "..", "agents")
    const sharedDir = Path.join(workflowDir, "shared")
    const linkPath = Path.join(sharedDir, "agents")

    yield* Effect.try({
      try: () => {
        if (!Fs.existsSync(sharedDir)) {
          Fs.mkdirSync(sharedDir, { recursive: true })
        }

        if (Fs.existsSync(linkPath)) {
          const stat = Fs.lstatSync(linkPath)
          if (stat.isSymbolicLink()) {
            const existingTarget = Fs.readlinkSync(linkPath)
            if (existingTarget === target) return
          }
          Fs.rmSync(linkPath, { recursive: true, force: true })
        }

        Fs.symlinkSync(target, linkPath, "dir")
      },
      catch: (e) =>
        new SharedAgentsSymlinkError({
          workflowDir,
          message: `Failed to create shared/agents symlink: ${String(e)}`
        })
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/workflow/shared-agents.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/shared-agents.ts tests/workflow/shared-agents.test.ts
git commit -m "feat: add ensureSharedAgentsSymlink helper"
```

---

### Task 2: Remove `copyWorkflowAgents` from init + update tests

**Files:**
- Modify: `src/cli/commands/init.ts` (lines 39–64 removed, line 85–87 removed)
- Modify: `tests/cli/init.test.ts` (lines 57–64 replaced)

- [ ] **Step 1: Write the failing test**

Replace the existing test at `tests/cli/init.test.ts` lines 57–64:

```typescript
  it("does NOT copy per-workflow agents to shared agents dir", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const agentsBase = Path.join(tmpHome, ".hamilton", "agents")
    expect(Fs.existsSync(Path.join(agentsBase, "triager", "AGENTS.md"))).toBe(false)
    expect(Fs.existsSync(Path.join(agentsBase, "investigator", "AGENTS.md"))).toBe(false)
    expect(Fs.existsSync(Path.join(agentsBase, "fixer", "AGENTS.md"))).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/cli/init.test.ts`
Expected: FAIL — triager, investigator, fixer still exist in `~/.hamilton/agents/` because `copyWorkflowAgents` still copies them

- [ ] **Step 3: Remove `copyWorkflowAgents` from init.ts**

In `src/cli/commands/init.ts`, delete:
- The entire `copyWorkflowAgents` function (lines 39–64)
- The loop calling it in `initHamilton` (lines 85–87)

The `initHamilton` function becomes:

```typescript
export function initHamilton(options?: { force?: boolean }): Effect.Effect<string[], InitError> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => ensureHamiltonHome(),
      catch: (e) =>
        new InitError({ message: `Failed to create hamilton home directories: ${String(e)}` })
    })

    const db = yield* Effect.mapError(openDb(), (e) =>
      new InitError({ message: `Failed to open database: ${e.message}` })
    )
    yield* Effect.sync(() => db.close())

    yield* copySharedAgents(options)

    const workflowSlugs = yield* Effect.mapError(installAllWorkflows({ force: true }), (e) =>
      new InitError({ message: `Failed to install workflows: ${e.message}` })
    )

    return workflowSlugs
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/cli/init.test.ts`
Expected: 8 tests PASS (7 existing + 1 replaced negative test)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/init.ts tests/cli/init.test.ts
git commit -m "fix: remove copyWorkflowAgents from init"
```

---

### Task 3: Call `ensureSharedAgentsSymlink` from install-logic

**Files:**
- Modify: `src/cli/commands/install-logic.ts`
- Modify: `tests/cli/install.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/cli/install.test.ts` inside the existing `describe("installWorkflow", ...)` block, after the existing tests:

```typescript
  it("creates shared/agents symlink on install", async () => {
    const exit = await Effect.runPromiseExit(installWorkflow("bug-fix"))
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(tmpHome, ".hamilton", "workflows", "bug-fix", "shared", "agents")
    expect(Fs.existsSync(linkPath)).toBe(true)
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
  })

  it("replaces stale shared/agents symlink on re-install", async () => {
    await Effect.runPromiseExit(installWorkflow("bug-fix"))

    const linkPath = Path.join(tmpHome, ".hamilton", "workflows", "bug-fix", "shared", "agents")
    const wrongDir = Path.join(tmpHome, "wrong-target")
    Fs.mkdirSync(wrongDir, { recursive: true })
    Fs.rmSync(linkPath, { recursive: true, force: true })
    Fs.symlinkSync(wrongDir, linkPath, "dir")
    expect(Fs.readlinkSync(linkPath)).toBe(wrongDir)

    const exit = await Effect.runPromiseExit(installWorkflow("bug-fix", { force: true }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(Fs.readlinkSync(linkPath)).not.toBe(wrongDir)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/cli/install.test.ts`
Expected: FAIL — symlink does not exist after install

- [ ] **Step 3: Add `ensureSharedAgentsSymlink` call to `installWorkflow`**

In `src/cli/commands/install-logic.ts`, add import and call:

At the top, add the import:
```typescript
import { ensureSharedAgentsSymlink } from "../../workflow/shared-agents.js"
```

After the `Fs.cpSync`/`Fs.copyFileSync` block inside `installWorkflow` (after line 68, before the closing of the Effect.gen), add:

```typescript
    yield* Effect.mapError(
      ensureSharedAgentsSymlink(destDir),
      (e) => new InstallError({ workflowSlug, message: e.message })
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/cli/install.test.ts`
Expected: 5 tests PASS (3 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/install-logic.ts tests/cli/install.test.ts
git commit -m "feat: create shared/agents symlink on workflow install"
```

---

### Task 4: Verify symlink in runner before task execution

**Files:**
- Modify: `src/workflow/runner.ts`
- Modify: `tests/workflow/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/workflow/runner.test.ts` after the existing `describe("topological sort + context integration"...)` block:

```typescript
describe("shared/agents symlink verification", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-symlink-runner-"))
    process.env.HOME = tmpHome
    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "agents"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("creates shared/agents symlink when missing before execution", async () => {
    const spec = makeSpec()
    const wfDir = Path.join(tmpHome, ".hamilton", "workflows", spec.name)
    Fs.mkdirSync(wfDir, { recursive: true })

    await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    const linkPath = Path.join(wfDir, "shared", "agents")
    expect(Fs.existsSync(linkPath)).toBe(true)
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
  })

  it("fixes broken shared/agents symlink before execution", async () => {
    const spec = makeSpec()
    const wfDir = Path.join(tmpHome, ".hamilton", "workflows", spec.name)
    Fs.mkdirSync(wfDir, { recursive: true })
    const sharedDir = Path.join(wfDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    const wrongDir = Path.join(tmpHome, "wrong")
    Fs.mkdirSync(wrongDir, { recursive: true })
    Fs.symlinkSync(wrongDir, Path.join(sharedDir, "agents"), "dir")

    await Effect.runPromise(
      Effect.scoped(
        runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows") })
      ).pipe(Effect.provide(EventBusLive))
    )

    const linkPath = Path.join(wfDir, "shared", "agents")
    expect(Fs.readlinkSync(linkPath)).not.toBe(wrongDir)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/workflow/runner.test.ts`
Expected: FAIL — symlink is not created by the runner

- [ ] **Step 3: Add `ensureSharedAgentsSymlink` call to runner**

In `src/workflow/runner.ts`, add import at the top:

```typescript
import { ensureSharedAgentsSymlink } from "../workflow/shared-agents.js"
```

In the `runWorkflow` function, after the `workflowDir` assignment (line 43) and before the `collectReachableTasks` call (line 45), add:

```typescript
    yield* _(ensureSharedAgentsSymlink(workflowDir))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/workflow/runner.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/runner.test.ts
git commit -m "feat: verify shared/agents symlink in runner before execution"
```

---

### Task 5: Change YAML paths from `../../agents/shared/` to `shared/agents/`

**Files:**
- Modify: 19 workflow YAML files under `workflows/`

- [ ] **Step 1: Replace paths in all workflow YAMLs**

Run the following sed command to replace all occurrences:

```bash
find workflows -name 'workflow.yml' -exec sed -i '' 's|../../agents/shared/|shared/agents/|g' {} +
```

This changes every `../../agents/shared/<name>/AGENTS.md` (and SOUL.md, IDENTITY.md) to `shared/agents/<name>/AGENTS.md` across all 19 affected workflow YAMLs.

- [ ] **Step 2: Verify the replacement**

```bash
rg "../../agents/shared/" workflows/ -g '*.yml'
```

Expected: no output (no remaining `../../agents/shared/` references)

```bash
rg "shared/agents/" workflows/ -g '*.yml' -l
```

Expected: 19 files listed (all the same ones that previously had `../../agents/shared/`)

- [ ] **Step 3: Run build to verify no breakage**

Run: `bun run build`

Expected: clean exit, no errors

- [ ] **Step 4: Commit**

```bash
git add workflows/
git commit -m "refactor: change shared agent paths from ../../agents/shared/ to shared/agents/"
```

---

### Task 6: Add persona symlink resolution test + full suite verification

**Files:**
- Modify: `tests/agent/persona.test.ts`

- [ ] **Step 1: Write the test**

Add this test to `tests/agent/persona.test.ts` inside the existing `describe("resolvePersona"...)` block, after the last test:

```typescript
  it("resolves shared agent through symlink", async () => {
    const sharedAgentsDir = Path.join(tmpDir, "agents")
    Fs.mkdirSync(Path.join(sharedAgentsDir, "setup"), { recursive: true })
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "AGENTS.md"), "shared setup agent")
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "SOUL.md"), "shared setup soul")
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "IDENTITY.md"), "shared setup identity")

    const workflowDir = Path.join(tmpDir, "workflows", "test-wf")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.symlinkSync(sharedAgentsDir, Path.join(sharedDir, "agents"), "dir")

    const paths = {
      agent: "shared/agents/setup/AGENTS.md",
      soul: "shared/agents/setup/SOUL.md",
      identity: "shared/agents/setup/IDENTITY.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, workflowDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent).toBe("shared setup agent")
      expect(exit.value.soul).toBe("shared setup soul")
      expect(exit.value.identity).toBe("shared setup identity")
    }
  })
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun --bun vitest run tests/agent/persona.test.ts`
Expected: 4 tests PASS (3 existing + 1 new). `Path.resolve` follows symlinks transparently, so this should pass immediately.

- [ ] **Step 3: Run full test suite**

Run: `bun --bun vitest run`
Expected: All tests pass

- [ ] **Step 4: Build verification**

Run: `bun run build`
Expected: clean exit

- [ ] **Step 5: Commit**

```bash
git add tests/agent/persona.test.ts
git commit -m "test: add persona resolution through shared/agents symlink"
```