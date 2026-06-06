# Hamilton Blocking Gaps Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 blocking gaps (no init, no agents, no pi agent dir, resume doesn't restart, workflow-local personas ignored, no first-run bootstrap) via `hamilton init` command, state machine runner, two-tier persona resolution, and guard checks.

**Architecture:** New `init` command bootstraps `~/.hamilton/` with directories, DB, shared agents, and workflows. A `WorkflowRuntime` state machine replaces ad-hoc checkpointing, enabling resume across processes. `resolvePersona` does two-tier agent lookup (workflow-local → shared pool). All CLI commands guard-check `hamiltonHome()` existence.

**Tech Stack:** TypeScript, Effect-TS, better-sqlite3, vitest, Node.js fs/path/os

---

### File Structure

**Create:**
- `src/cli/commands/init.ts` — `initHamilton(options?)` bootstrap logic
- `src/workflow/run-state-machine.ts` — `WorkflowRuntime` state machine + `RunState`/`StepState` types
- `tests/cli/init.test.ts` — init command tests
- `tests/agent/persona-resolution.test.ts` — two-tier persona resolution tests
- `tests/workflow/run-state-machine.test.ts` — state machine tests

**Modify:**
- `src/paths.ts` — add `ensureHamiltonHome()` helper
- `src/cli/commands/run.ts` — guard check, pass `existingRunId`
- `src/cli/commands/resume.ts` — load state, YAML, context; call runner with existingRunId
- `src/cli/commands/pause.ts` — guard check
- `src/cli/commands/status.ts` — guard check
- `src/cli/commands/logs.ts` — guard check
- `src/cli/commands/list.ts` — guard check
- `src/cli/commands/install.ts` — guard check
- `src/cli/main.ts` — wire `init` subcommand, add guard checks
- `src/agent/persona.ts` — replace `loadPersona` with `resolvePersona` (two-tier lookup)
- `src/workflow/runner.ts` — integrate state machine, two-tier agent resolution, resume support
- `src/workflow/workflow-engine.ts` — remove checkpoint functions, keep `buildRunId`/`computeStepOrder`/`resolveStepTimeout`
- `tests/agent/persona.test.ts` — update to test `resolvePersona` instead of `loadPersona`
- `tests/workflow/runner.test.ts` — update mocks for state machine, add resume test

**Deleted/removed:**
- `src/workflow/workflow-engine.ts` — checkpoint functions removed (lines 31-111)
- `src/agent/persona.ts` — `loadPersona` removed, replaced by `resolvePersona`

---

### Task 1: Add `ensureHamiltonHome()` to paths.ts

**Files:**
- Modify: `src/paths.ts:55`

- [ ] **Step 1: Add the function**

```typescript
export function ensureHamiltonHome(): void {
  const dirs = [
    hamiltonHome(),
    agentsDir(),
    workflowsDir(),
    runsDir(),
    piAgentDir()
  ]
  for (const dir of dirs) {
    if (!Fs.existsSync(dir)) {
      Fs.mkdirSync(dir, { recursive: true })
    }
  }
}
```

Also add the import at the top of the file, after the existing `import * as Path`:

```typescript
import * as Fs from "node:fs"
```

- [ ] **Step 2: Run typecheck and tests**

```bash
npx tsc --noEmit 2>&1 && npm test 2>&1
```
Expected: TypeScript clean, all 117 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/paths.ts
git commit -m "feat: add ensureHamiltonHome helper to paths.ts"
```

---

### Task 2: Add `hamilton init` command

**Files:**
- Create: `src/cli/commands/init.ts`
- Modify: `src/cli/main.ts` (wire in Task 10)
- Create: `tests/cli/init.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `tests/cli/init.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { initHamilton, InitError } from "../../src/cli/commands/init.js"

function projectRoot(): string {
  return Path.resolve(import.meta.dirname, "..", "..")
}

describe("initHamilton", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-init-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("creates all required directories", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)

    const hh = Path.join(tmpHome, ".hamilton")
    expect(Fs.existsSync(hh)).toBe(true)
    expect(Fs.existsSync(Path.join(hh, "agents"))).toBe(true)
    expect(Fs.existsSync(Path.join(hh, "workflows"))).toBe(true)
    expect(Fs.existsSync(Path.join(hh, "runs"))).toBe(true)
    expect(Fs.existsSync(Path.join(hh, "executors", "pi", "agent"))).toBe(true)
  })

  it("creates the SQLite DB", async () => {
    await Effect.runPromise(initHamilton())
    const dbPath = Path.join(tmpHome, ".hamilton", "hamilton.db")
    expect(Fs.existsSync(dbPath)).toBe(true)
  })

  it("copies shared agents from project root", async () => {
    await Effect.runPromise(initHamilton())

    const agentsDir = Path.join(tmpHome, ".hamilton", "agents")
    const entries = Fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)

    expect(entries).toContain("pr")
    expect(entries).toContain("setup")
    expect(entries).toContain("verifier")
  })

  it("installs bundled workflows", async () => {
    await Effect.runPromise(initHamilton())

    const wfDir = Path.join(tmpHome, ".hamilton", "workflows")
    expect(Fs.existsSync(Path.join(wfDir, "bug-fix", "workflow.yml"))).toBe(true)
  })

  it("copies per-workflow agents to shared agents dir", async () => {
    await Effect.runPromise(initHamilton())

    const agentsDir = Path.join(tmpHome, ".hamilton", "agents")
    expect(Fs.existsSync(Path.join(agentsDir, "triager", "AGENTS.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(agentsDir, "investigator", "AGENTS.md"))).toBe(true)
  })

  it("is idempotent", async () => {
    await Effect.runPromise(initHamilton())
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("skips agent copy when already exists without force", async () => {
    await Effect.runPromise(initHamilton())

    const agentsDir = Path.join(tmpHome, ".hamilton", "agents")
    const origContent = Fs.readFileSync(Path.join(agentsDir, "triager", "AGENTS.md"), "utf-8")

    Fs.writeFileSync(Path.join(agentsDir, "triager", "AGENTS.md"), "modified content")

    await Effect.runPromise(initHamilton())
    const after = Fs.readFileSync(Path.join(agentsDir, "triager", "AGENTS.md"), "utf-8")
    expect(after).toBe("modified content")
  })

  it("force overwrites agents", async () => {
    await Effect.runPromise(initHamilton())

    const agentsDir = Path.join(tmpHome, ".hamilton", "agents")
    Fs.writeFileSync(Path.join(agentsDir, "triager", "AGENTS.md"), "modified content")

    await Effect.runPromise(initHamilton({ force: true }))
    const after = Fs.readFileSync(Path.join(agentsDir, "triager", "AGENTS.md"), "utf-8")
    expect(after).not.toBe("modified content")
  })

  it("returns installed workflow IDs", async () => {
    const exit = await Effect.runPromiseExit(initHamilton())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.length).toBeGreaterThan(0)
      expect(exit.value).toContain("bug-fix")
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/init.test.ts 2>&1
```
Expected: FAIL — cannot find module `../../src/cli/commands/init.js`

- [ ] **Step 3: Write `init.ts` implementation**

Contents of `src/cli/commands/init.ts`:

```typescript
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { hamiltonHome, agentsDir, piAgentDir } from "../../paths.js"
import { ensureHamiltonHome } from "../../paths.js"
import { openDb } from "../../workflow/state.js"
import { installAllWorkflows } from "./install.js"

const PROJECT_ROOT = Path.resolve(import.meta.dirname, "..", "..", "..")

export class InitError extends Data.TaggedError("InitError")<{
  message: string
}> {}

function sharedAgentsSource(): string {
  return Path.join(PROJECT_ROOT, "agents", "shared")
}

function copySharedAgents(): Effect.Effect<void, InitError> {
  return Effect.try({
    try: () => {
      const src = sharedAgentsSource()
      if (!Fs.existsSync(src)) return

      const destDir = agentsDir()
      const entries = Fs.readdirSync(src, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const destPath = Path.join(destDir, entry.name)
          if (!Fs.existsSync(destPath)) {
            Fs.cpSync(Path.join(src, entry.name), destPath, { recursive: true })
          }
        }
      }
    },
    catch: (e) => new InitError({ message: `Failed to copy shared agents: ${String(e)}` })
  })
}

function copyWorkflowAgents(workflowId: string, force?: boolean): Effect.Effect<void, InitError> {
  return Effect.try({
    try: () => {
      const wfAgentsDir = Path.join(PROJECT_ROOT, "workflows", workflowId, "agents")
      if (!Fs.existsSync(wfAgentsDir)) return

      const destDir = agentsDir()
      const entries = Fs.readdirSync(wfAgentsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const destPath = Path.join(destDir, entry.name)
          if (Fs.existsSync(destPath) && !force) continue
          Fs.cpSync(Path.join(wfAgentsDir, entry.name), destPath, { recursive: true, force: true })
        }
      }
    },
    catch: (e) => new InitError({ message: `Failed to copy agents for workflow "${workflowId}": ${String(e)}` })
  })
}

export function initHamilton(
  options?: { force?: boolean }
): Effect.Effect<string[], InitError> {
  return Effect.gen(function* (_) {
    ensureHamiltonHome()

    yield* _(openDb().pipe(
      Effect.mapError((e) => new InitError({ message: String(e) }))
    ))

    yield* _(copySharedAgents())

    const installed = yield* _(installAllWorkflows({ force: options?.force }).pipe(
      Effect.mapError((e) => new InitError({ message: String(e) }))
    ))

    for (const wfId of installed) {
      yield* _(copyWorkflowAgents(wfId, options?.force))
    }

    return installed
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cli/init.test.ts 2>&1
```
Expected: 8 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npx tsc --noEmit 2>&1 && npm test 2>&1
```
Expected: TypeScript clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/init.ts tests/cli/init.test.ts
git commit -m "feat: add hamilton init command with directory bootstrap and agent installation"
```

---

### Task 3: Replace `loadPersona` with two-tier `resolvePersona`

**Files:**
- Modify: `src/agent/persona.ts` (full rewrite)
- Modify: `tests/agent/persona.test.ts` (rewrite tests)
- Create: `tests/agent/persona-resolution.test.ts` (two-tier tests)

- [ ] **Step 1: Write tests for `resolvePersona`**

Contents of `tests/agent/persona.test.ts` (overwrite existing):

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resolvePersona, PersonaLoadError } from "../../src/agent/persona.js"

describe("resolvePersona", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-persona-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("loads from shared agents dir when workflow-local doesn't exist", async () => {
    const sharedDir = Path.join(tmpHome, ".hamilton", "agents", "agent-a")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(sharedDir, "AGENTS.md"), "shared instructions")
    Fs.writeFileSync(Path.join(sharedDir, "IDENTITY.md"), "shared identity")
    Fs.writeFileSync(Path.join(sharedDir, "SOUL.md"), "shared soul")

    const exit = await Effect.runPromiseExit(resolvePersona("agent-a", "no-such-workflow"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("shared instructions")
      expect(exit.value.identity).toBe("shared identity")
      expect(exit.value.soul).toBe("shared soul")
    }
  })

  it("prefers workflow-local agents over shared agents", async () => {
    const sharedDir = Path.join(tmpHome, ".hamilton", "agents", "agent-a")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(sharedDir, "AGENTS.md"), "shared instructions")

    const localDir = Path.join(tmpHome, ".hamilton", "workflows", "my-wf", "agents", "agent-a")
    Fs.mkdirSync(localDir, { recursive: true })
    Fs.writeFileSync(Path.join(localDir, "AGENTS.md"), "local instructions")

    const exit = await Effect.runPromiseExit(resolvePersona("agent-a", "my-wf"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("local instructions")
    }
  })

  it("fails when agent not found in either location", async () => {
    const exit = await Effect.runPromiseExit(resolvePersona("no-such", "no-wf"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("uses empty strings for missing optional files", async () => {
    const sharedDir = Path.join(tmpHome, ".hamilton", "agents", "minimal")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(sharedDir, "AGENTS.md"), "only agents")

    const exit = await Effect.runPromiseExit(resolvePersona("minimal", "no-wf"))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agents).toBe("only agents")
      expect(exit.value.identity).toBe("")
      expect(exit.value.soul).toBe("")
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/agent/persona.test.ts 2>&1
```
Expected: FAIL — `resolvePersona` is not exported.

- [ ] **Step 3: Rewrite `src/agent/persona.ts`**

```typescript
import * as Fs from "node:fs"
import * as Path from "node:path"
import { Data, Effect } from "effect"
import { agentsDir, workflowsDir } from "../paths.js"

export interface Persona {
  agents: string
  identity: string
  soul: string
}

export class PersonaLoadError extends Data.TaggedError("PersonaLoadError")<{
  agentId: string
  workflowId: string
  message: string
}> {}

function tryReadFile(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

function loadPersonaFromDir(dir: string): Persona | null {
  const agentsPath = Path.join(dir, "AGENTS.md")
  if (!Fs.existsSync(agentsPath)) return null
  const agentsContent = Fs.readFileSync(agentsPath, "utf-8")
  const identityContent = tryReadFile(Path.join(dir, "IDENTITY.md"))
  const soulContent = tryReadFile(Path.join(dir, "SOUL.md"))
  return { agents: agentsContent, identity: identityContent, soul: soulContent }
}

export function resolvePersona(
  agentId: string,
  workflowId: string
): Effect.Effect<Persona, PersonaLoadError> {
  return Effect.sync(() => {
    const localDir = Path.join(workflowsDir(), workflowId, "agents", agentId)
    const local = loadPersonaFromDir(localDir)
    if (local) return local

    const sharedDir = Path.join(agentsDir(), agentId)
    const shared = loadPersonaFromDir(sharedDir)
    if (shared) return shared

    throw new PersonaLoadError({
      agentId,
      workflowId,
      message: `Agent "${agentId}" not found in workflow "${workflowId}" or shared agents. Check "hamilton init".`
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/agent/persona.test.ts 2>&1
```
Expected: 4 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npx tsc --noEmit 2>&1 && npm test 2>&1
```
Expected: TypeScript clean, but runner tests may fail because `runner.ts` still imports `loadPersona`. That's expected — Task 5 fixes it. If runner tests break the suite, use: `npx vitest run --exclude='tests/workflow/runner.test.ts'`

- [ ] **Step 6: Commit**

```bash
git add src/agent/persona.ts tests/agent/persona.test.ts
git commit -m "feat: replace loadPersona with two-tier resolvePersona"
```

---

### Task 4: Create `WorkflowRuntime` state machine

**Files:**
- Create: `src/workflow/run-state-machine.ts`
- Create: `tests/workflow/run-state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `tests/workflow/run-state-machine.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  createWorkflowRuntime,
  WorkflowRuntime,
  EngineError
} from "../../src/workflow/run-state-machine.js"

const testSpec = {
  id: "test-flow",
  name: "Test",
  version: 1,
  agents: [{ id: "agent-a", role: "coding" as const, workspace: { baseDir: ".", files: {} } }],
  steps: [
    { id: "step-1", agent: "agent-a", input: "Do X" },
    { id: "step-2", agent: "agent-a", input: "Do Y" }
  ]
}

describe("WorkflowRuntime", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-sm-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("starts a new run in running state", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        expect(ctx.state).toBe("running")
        return ctx
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("shouldExecuteStep returns true for pending steps", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        const shouldExec = yield* _(ctx.shouldExecuteStep("step-1"))
        expect(shouldExec).toBe(true)
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("shouldExecuteStep returns false for completed steps", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        yield* _(ctx.transitionStep("step-1", "start"))
        yield* _(ctx.transitionStep("step-1", "complete"))
        const shouldExec = yield* _(ctx.shouldExecuteStep("step-1"))
        expect(shouldExec).toBe(false)
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("pause transitions run to paused", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        yield* _(ctx.pause())
        expect(ctx.state).toBe("paused")
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("resume from existing paused run skips completed steps", async () => {
    const ctx1 = await Effect.runPromise(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        yield* _(ctx.transitionStep("step-1", "start"))
        yield* _(ctx.transitionStep("step-1", "complete"))
        yield* _(ctx.pause())
        return ctx
      })
    )

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }, ctx1.runId))
        expect(ctx.state).toBe("running")

        const execStep1 = yield* _(ctx.shouldExecuteStep("step-1"))
        expect(execStep1).toBe(false)

        const execStep2 = yield* _(ctx.shouldExecuteStep("step-2"))
        expect(execStep2).toBe(true)
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("complete transitions run to completed", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        yield* _(ctx.complete())
        expect(ctx.state).toBe("completed")
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("fail transitions run to failed", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        yield* _(ctx.fail("something broke"))
        expect(ctx.state).toBe("failed")
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("rejects invalid step transitions", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        return yield* _(ctx.transitionStep("step-1", "complete"))
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects invalid run transitions", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* (_) {
        const ctx = yield* _(createWorkflowRuntime(testSpec, { task: "test" }))
        yield* _(ctx.complete())
        return yield* _(ctx.pause())
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/workflow/run-state-machine.test.ts 2>&1
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/workflow/run-state-machine.ts`**

```typescript
import { Effect, Data } from "effect"
import Database from "better-sqlite3"
import { openDb } from "../workflow/state.js"
import {
  insertRun,
  insertSteps,
  getRunById,
  getStepsByRunId,
  updateStepStarted,
  updateStepCompleted,
  updateStepFailed,
  updateRunCompleted,
  updateRunFailed,
  setDurableDeferred,
  getDurableDeferred,
  updateRunContext
} from "../db/queries.js"
import type { WorkflowSpec } from "../types.js"
import { buildRunId } from "../workflow/engine.js"

export type RunState = "idle" | "running" | "paused" | "completed" | "failed"
export type StepState = "pending" | "running" | "completed" | "failed"

export class EngineError extends Data.TaggedError("EngineError")<{
  runId: string
  message: string
}> {}

export interface WorkflowRuntime {
  readonly db: Database.Database
  readonly runId: string
  readonly state: RunState
  readonly spec: WorkflowSpec

  readonly shouldExecuteStep: (stepId: string) => Effect.Effect<boolean, EngineError>
  readonly shouldPause: () => Effect.Effect<boolean, EngineError>
  readonly transitionStep: (stepId: string, transition: "start" | "complete" | "fail") => Effect.Effect<void, EngineError>
  readonly pause: () => Effect.Effect<void, EngineError>
  readonly complete: () => Effect.Effect<void, EngineError>
  readonly fail: (error: string) => Effect.Effect<void, EngineError>
  readonly close: () => Effect.Effect<void>
}

const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  idle: ["running"],
  running: ["paused", "completed", "failed"],
  paused: ["running"],
  completed: [],
  failed: []
}

const STEP_TRANSITIONS: Record<StepState, Partial<Record<string, StepState>>> = {
  pending: { start: "running" },
  running: { complete: "completed", fail: "failed" },
  completed: {},
  failed: {}
}

function dbRunStateToState(dbState: string): RunState {
  if (dbState === "completed" || dbState === "failed" || dbState === "paused" || dbState === "running") {
    return dbState
  }
  return "running"
}

function createRuntime(
  db: Database.Database,
  runId: string,
  state: RunState,
  spec: WorkflowSpec
): WorkflowRuntime {
  function ensureState(allowed: RunState[]): Effect.Effect<void, EngineError> {
    return Effect.sync(() => {
      if (!allowed.includes(state)) {
        throw new EngineError({
          runId,
          message: `Invalid state transition: cannot perform operation in state "${state}"`
        })
      }
    })
  }

  function shouldExecuteStep(stepId: string): Effect.Effect<boolean, EngineError> {
    return Effect.sync(() => {
      const steps = getStepsByRunId(db, runId)
      const step = steps.find(s => s.step_id === stepId)
      if (!step) return true
      return step.status !== "completed"
    })
  }

  function shouldPause(): Effect.Effect<boolean, EngineError> {
    return Effect.sync(() => {
      if (state !== "running") return false
      const deferred = getDurableDeferred(db, `pause-${runId}`)
      return deferred?.state === "paused"
    })
  }

  function transitionStep(stepId: string, transition: "start" | "complete" | "fail"): Effect.Effect<void, EngineError> {
    return Effect.sync(() => {
      const steps = getStepsByRunId(db, runId)
      const step = steps.find(s => s.step_id === stepId)
      const currentStepState: StepState = step ? (step.status as StepState) : "pending"

      const validTransitions = STEP_TRANSITIONS[currentStepState]
      if (!validTransitions || !(transition in validTransitions)) {
        throw new EngineError({
          runId,
          message: `Invalid step transition: "${currentStepState}" → "${transition}" for step "${stepId}"`
        })
      }

      const now = new Date().toISOString()
      switch (transition) {
        case "start":
          updateStepStarted(db, runId, stepId, now)
          break
        case "complete":
          updateStepCompleted(db, runId, stepId, now, {})
          break
        case "fail":
          updateStepFailed(db, runId, stepId, "Step failed")
          break
      }
    })
  }

  function pause(): Effect.Effect<void, EngineError> {
    return Effect.gen(function* (_) {
      yield* _(ensureState(["running"]))
      setDurableDeferred(db, `pause-${runId}`, runId, "paused", "paused-by-user")
      updateRunContext(db, runId, JSON.stringify({}));
      (state as RunState) = "paused"
    })
  }

  function complete(): Effect.Effect<void, EngineError> {
    return Effect.gen(function* (_) {
      yield* _(ensureState(["running"]))
      updateRunCompleted(db, runId, new Date().toISOString());
      (state as RunState) = "completed"
    })
  }

  function fail(error: string): Effect.Effect<void, EngineError> {
    return Effect.gen(function* (_) {
      yield* _(ensureState(["running"]))
      updateRunFailed(db, runId, error);
      (state as RunState) = "failed"
    })
  }

  function close(): Effect.Effect<void> {
    return Effect.sync(() => {
      db.close()
    })
  }

  return {
    db,
    runId,
    state,
    spec,
    shouldExecuteStep,
    shouldPause,
    transitionStep,
    pause,
    complete,
    fail,
    close
  }
}

export function createWorkflowRuntime(
  spec: WorkflowSpec,
  context: Record<string, string>,
  existingRunId?: string
): Effect.Effect<WorkflowRuntime, EngineError> {
  return Effect.gen(function* (_) {
    const db = yield* _(openDb().pipe(
      Effect.mapError((e) => new EngineError({ runId: existingRunId ?? "new", message: String(e) }))
    ))

    if (existingRunId) {
      const run = getRunById(db, existingRunId)
      if (!run) {
        db.close()
        return yield* _(Effect.fail(new EngineError({ runId: existingRunId, message: "Run not found" })))
      }

      const state = dbRunStateToState(run.status)
      if (state !== "paused") {
        db.close()
        return yield* _(Effect.fail(new EngineError({ runId: existingRunId, message: `Cannot resume run in state "${state}"` })))
      }

      setDurableDeferred(db, `pause-${existingRunId}`, existingRunId, "pending")
      updateRunContext(db, existingRunId, JSON.stringify(context))

      return createRuntime(db, existingRunId, "running", spec)
    }

    const runId = buildRunId(spec.id)
    const now = new Date().toISOString()
    insertRun(db, runId, spec.id, now)
    insertSteps(db, runId, spec.steps.map(s => ({ stepId: s.id, agentId: s.agent })))
    updateRunContext(db, runId, JSON.stringify(context))

    return createRuntime(db, runId, "running", spec)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/workflow/run-state-machine.test.ts 2>&1
```
Expected: 9 tests pass.

- [ ] **Step 5: Run full test suite (excluding runner — Task 5 fixes it)**

```bash
npx tsc --noEmit 2>&1
```

Expected: TypeScript clean (may have `loadPersona` import error in runner.ts — that's expected for Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/workflow/run-state-machine.ts tests/workflow/run-state-machine.test.ts
git commit -m "feat: add WorkflowRuntime state machine for run/step transitions"
```

---

### Task 5: Rewrite runner with state machine and two-tier persona resolution

**Files:**
- Modify: `src/workflow/runner.ts` (full rewrite)
- Modify: `tests/workflow/runner.test.ts` (update mocks)
- Modify: `src/workflow/workflow-engine.ts` (remove checkpoint fns)
- Modify: `src/cli/commands/run.ts` (guard check + existingRunId)

- [ ] **Step 1: Clean up `src/workflow/workflow-engine.ts`**

Remove the following imports (lines 1-19, except keep what `buildRunId`/`computeStepOrder`/`resolveStepTimeout` need):

```typescript
import * as Crypto from "node:crypto"
import { WorkflowSpec } from "../types.js"

export function computeStepOrder(spec: WorkflowSpec): string[] {
  return spec.steps.map((s) => s.id)
}

export function buildRunId(workflowId: string): string {
  return `${workflowId}-${Crypto.randomUUID()}`
}

export function resolveStepTimeout(spec: WorkflowSpec, agentId: string): number {
  const agent = spec.agents.find((a) => a.id === agentId)
  if (agent?.timeoutSeconds !== undefined) return agent.timeoutSeconds
  if (spec.polling?.timeoutSeconds !== undefined) return spec.polling.timeoutSeconds
  return 300
}
```

Delete everything else (the old `initializeRun`, `checkpointStepStart`, etc. are now in `run-state-machine.ts`). The file should only keep these 3 functions.

- [ ] **Step 2: Update `tests/workflow/runner.test.ts`**

Contents of `tests/workflow/runner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow, WorkflowEvent } from "../../src/workflow/runner.js"
import type { WorkflowSpec } from "../../src/types.js"

vi.mock("../../src/agent/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ status: "done" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

const testSpec: WorkflowSpec = {
  id: "test-flow",
  name: "Test Flow",
  version: 1,
  agents: [
    { id: "agent-a", role: "coding" as const, workspace: { baseDir: ".", files: {} } }
  ],
  steps: [
    { id: "step-1", agent: "agent-a", input: "Do something" },
    { id: "step-2", agent: "agent-a", input: "Do another thing" }
  ]
}

describe("runWorkflow", () => {
  let tmpHome: string
  const origHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-runner-"))
    process.env.HOME = tmpHome

    const hh = Path.join(tmpHome, ".hamilton")
    Fs.mkdirSync(Path.join(hh, "agents", "agent-a"), { recursive: true })
    Fs.writeFileSync(Path.join(hh, "agents", "agent-a", "AGENTS.md"), "Test agent")

    Fs.mkdirSync(Path.join(hh, "workflows"), { recursive: true })
    Fs.mkdirSync(Path.join(hh, "runs"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("executes all steps and returns completed", async () => {
    const events: WorkflowEvent[] = []

    const result = await Effect.runPromiseExit(
      runWorkflow(testSpec, { task: "test" }, {
        onEvent: (e) => Effect.sync(() => events.push(e)),
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults["step-1"]).toBe("done")
      expect(result.value.stepResults["step-2"]).toBe("done")

      const types = events.map((e) => e.type)
      expect(types).toContain("workflow_started")
      expect(types).toContain("step_started")
      expect(types).toContain("step_completed")
      expect(types).toContain("workflow_completed")
    }
  })

  it("emits events in correct order", async () => {
    const events: WorkflowEvent[] = []

    await Effect.runPromise(
      runWorkflow(testSpec, { task: "test" }, {
        onEvent: (e) => Effect.sync(() => events.push(e)),
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(events[0].type).toBe("workflow_started")
    expect(events[1].type).toBe("step_started")
    expect(events[2].type).toBe("step_completed")
    expect(events[events.length - 1].type).toBe("workflow_completed")
  })

  it("fails gracefully when persona not found", async () => {
    const specNoAgent: WorkflowSpec = {
      ...testSpec,
      agents: [
        { id: "no-such-agent", role: "coding" as const, workspace: { baseDir: ".", files: {} } }
      ],
      steps: [
        { id: "step-1", agent: "no-such-agent", input: "Do something" }
      ]
    }

    const result = await Effect.runPromiseExit(
      runWorkflow(specNoAgent, { task: "test" }, {
        onEvent: () => Effect.void,
        workflowsDir: Path.join(tmpHome, ".hamilton", "workflows")
      })
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/workflow/runner.test.ts 2>&1
```
Expected: FAIL — runner still imports old functions from `workflow-engine.ts`.

- [ ] **Step 4: Rewrite `src/workflow/runner.ts`**

```typescript
import { Effect, Schedule, Duration } from "effect"
import { WorkflowSpec } from "../types.js"
import { buildAgentPrompt, extractContextFromOutput } from "../agent/activity.js"
import { resolvePersona } from "../agent/persona.js"
import { loadAgentSettings } from "../agent/config.js"
import { createRtkExtension } from "../agent/rtk-extension.js"
import { executeWithPi } from "../agent/pi-executor.js"
import { mergeContext } from "../workflow/context.js"
import { computeStepOrder, resolveStepTimeout } from "../workflow/engine.js"
import { createWorkflowRuntime, WorkflowRuntime } from "../workflow/run-state-machine.js"
import {
  createRunDir,
  writeInput,
  writeStepOutput,
  appendStepLog,
  writeSummary,
  appendEngineLog
} from "../observability/run-dir.js"

export interface WorkflowEvent {
  type: string
  runId: string
  stepId?: string
  message?: string
  timestamp: string
  data?: Record<string, unknown>
}

export interface WorkflowRunnerConfig {
  onEvent: (event: WorkflowEvent) => Effect.Effect<void>
  workflowsDir: string
}

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
  context: Record<string, string>
  startedAt: string
  completedAt: string
}

function emit(
  onEvent: WorkflowRunnerConfig["onEvent"],
  event: Omit<WorkflowEvent, "timestamp">
): Effect.Effect<void> {
  return onEvent({ ...event, timestamp: new Date().toISOString() })
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialContext: Record<string, string>,
  config: WorkflowRunnerConfig,
  existingRunId?: string
): Effect.Effect<WorkflowResult, Error> {
  return Effect.gen(function* (_) {
    const startedAt = new Date().toISOString()
    const runningContext: Record<string, string> = { ...initialContext }
    const stepResults: Record<string, string> = { ...spec.context }
    const stepOrder = computeStepOrder(spec)

    const ctx: WorkflowRuntime = yield* _(
      createWorkflowRuntime(spec, runningContext, existingRunId).pipe(
        Effect.mapError((e) => new Error(e.message))
      )
    )

    const runId = ctx.runId

    yield* _(createRunDir(runId))
    yield* _(writeInput(runId, { spec, initialContext }))
    yield* _(emit(config.onEvent, { type: "workflow_started", runId }))
    yield* _(appendEngineLog(runId, { event: "workflow_started", workflowId: spec.id }))

    let workflowStatus: "completed" | "failed" | "paused" = "completed"

    const body = Effect.gen(function* () {
      for (const stepId of stepOrder) {
        const shouldExec = yield* _(ctx.shouldExecuteStep(stepId))
        if (!shouldExec) continue

        const step = spec.steps.find((s) => s.id === stepId)!
        const agent = spec.agents.find((a) => a.id === step.agent)!
        const maxRetries = step.max_retries ?? 1
        const timeoutSeconds = resolveStepTimeout(spec, agent.id)
        const model = agent.model

        const shouldPauseVal = yield* _(ctx.shouldPause())
        if (shouldPauseVal) {
          yield* _(emit(config.onEvent, { type: "step_paused", runId, stepId, message: "step paused via deferred state" }))
          workflowStatus = "paused"
          break
        }

        yield* _(ctx.transitionStep(stepId, "start"))
        yield* _(emit(config.onEvent, { type: "step_started", runId, stepId }))
        yield* _(appendEngineLog(runId, { event: "step_started", stepId }))

        const persona = yield* _(
          resolvePersona(agent.id, spec.id).pipe(
            Effect.mapError((e) => new Error(e.message))
          )
        )

        const agentSettings = yield* _(Effect.match(loadAgentSettings(""), {
          onSuccess: (s) => s,
          onFailure: () => ({}) as Record<string, never>
        }))

        const prompt = buildAgentPrompt({
          agentsMd: persona.agents,
          identityMd: persona.identity,
          soulMd: persona.soul,
          stepInput: step.input,
          context: runningContext
        })

        yield* _(appendStepLog(runId, stepId, { event: "prompt_built" }))

        const rtkExtension = createRtkExtension({
          model: model ?? agentSettings.model,
          disabled: process.env.RTK_DISABLED === "1"
        })

        const output = yield* _(executeWithPi({
          systemPrompt: prompt.systemPrompt,
          taskPrompt: prompt.taskPrompt,
          stepId,
          agentId: agent.id,
          runId,
          timeoutSeconds,
          model,
          extensions: [rtkExtension],
          settings: {
            thinking: agentSettings.thinking,
            tools: agentSettings.tools,
            skills: agentSettings.skills
          }
        }).pipe(
          Effect.timeout(Duration.seconds(timeoutSeconds)),
          Effect.retry(
            Schedule.recurs(maxRetries - 1).pipe(
              Schedule.tapInput((_error: unknown) =>
                Effect.gen(function* () {
                  yield* _(emit(config.onEvent, {
                    type: "step_retry",
                    runId,
                    stepId,
                    message: "Retrying step"
                  }))
                  yield* _(appendStepLog(runId, stepId, { event: "retry" }))
                }).pipe(Effect.catchAll(() => Effect.void))
              )
            )
          )
        ))

        if (output === undefined || output === null) {
          yield* _(emit(config.onEvent, { type: "step_timeout", runId, stepId, message: "step timed out" }))
          yield* _(ctx.transitionStep(stepId, "fail"))
          yield* _(appendEngineLog(runId, { event: "step_timeout", stepId }))
          workflowStatus = "failed"
          break
        }

        yield* _(ctx.transitionStep(stepId, "complete"))
        yield* _(appendStepLog(runId, stepId, { event: "completed" }))
        yield* _(writeStepOutput(runId, stepId, output))

        const extracted = extractContextFromOutput(output)
        Object.assign(runningContext, extracted)
        Object.assign(runningContext, mergeContext(runningContext, output))

        if (output.status && typeof output.status === "string") {
          stepResults[stepId] = output.status
        }

        yield* _(emit(config.onEvent, { type: "step_completed", runId, stepId }))
        yield* _(appendEngineLog(runId, { event: "step_completed", stepId }))
      }

      const completedAt = new Date().toISOString()

      if (workflowStatus === "completed") {
        yield* _(ctx.complete().pipe(Effect.catchAll(() => Effect.void)))
      } else if (workflowStatus === "failed") {
        yield* _(ctx.fail(workflowStatus).pipe(Effect.catchAll(() => Effect.void)))
      }

      const summary = { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt }
      yield* _(writeSummary(runId, summary))
      yield* _(emit(config.onEvent, { type: "workflow_completed", runId }))
      yield* _(appendEngineLog(runId, { event: "workflow_completed", status: workflowStatus }))

      return { runId, status: workflowStatus, stepResults, context: runningContext, startedAt, completedAt } as WorkflowResult
    })

    return yield* _(body.pipe(
      Effect.ensuring(ctx.close())
    ))
  })
}
```

- [ ] **Step 5: Update `src/cli/commands/run.ts` for guard check + existingRunId**

```typescript
import { Effect } from "effect"
import * as Fs from "node:fs"
import { hamiltonHome, workflowsDir } from "../../paths.js"
import { resolveWorkflowId } from "../../workflow/resolver.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow, WorkflowResult } from "../../workflow/runner.js"
import { WorkflowSpec as WfSpec } from "../../types.js"
import { buildRunId } from "../../workflow/engine.js"

export interface RunParams {
  workflowSlug: string
  prompt: string
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
}

export function executeRun(params: RunParams): Effect.Effect<RunResult, Error> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new Error('Hamilton is not initialized. Run "hamilton init" first.')))
    }

    const wfDir = workflowsDir()
    const availableSlugs = yield* _(
      Effect.try({
        try: () => {
          if (!Fs.existsSync(wfDir)) return [] as string[]
          return Fs.readdirSync(wfDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        },
        catch: () => [] as string[]
      }).pipe(Effect.orElseSucceed(() => [] as string[]))
    )

    const resolvedId = resolveWorkflowId(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedId)

    const result = yield* _(
      runWorkflow(spec as unknown as WfSpec, { task: params.prompt }, {
        onEvent: (_) => Effect.void,
        workflowsDir: wfDir
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed<WorkflowResult>({
            runId: buildRunId((spec as unknown as WfSpec).id),
            status: "failed",
            stepResults: {},
            context: {},
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          })
        )
      )
    )

    return {
      runId: result.runId,
      status: result.status,
      stepResults: result.stepResults
    }
  })
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/workflow/runner.test.ts 2>&1
```
Expected: 3 tests pass.

- [ ] **Step 7: Run full test suite**

```bash
npx tsc --noEmit 2>&1 && npm test 2>&1
```
Expected: TypeScript clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/workflow/runner.ts src/workflow/workflow-engine.ts tests/workflow/runner.test.ts src/cli/commands/run.ts
git commit -m "feat: integrate WorkflowRuntime state machine and resolvePersona into runner"
```

---

### Task 6: Rewrite resume command to restart execution

**Files:**
- Modify: `src/cli/commands/resume.ts`
- Modify: `tests/workflow/runner.test.ts` (add resume test — but it's already covered by state machine tests)

- [ ] **Step 1: Rewrite `src/cli/commands/resume.ts`**

```typescript
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { openDb } from "../../workflow/state.js"
import { getRunById, getWorkflowState } from "../../db/queries.js"
import { workflowsDir, hamiltonHome } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow } from "../../workflow/runner.js"
import type { WorkflowSpec } from "../../types.js"

export class ResumeError extends Data.TaggedError("ResumeError")<{
  runId: string
  message: string
}> {}

export function resumeWorkflow(runId: string): Effect.Effect<string, ResumeError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new ResumeError({
        runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const db = yield* _(openDb().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const run = getRunById(db, runId)
    if (!run) {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: "Run not found" })))
    }

    if (run.status !== "paused") {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: `Cannot resume run in state "${run.status}"` })))
    }

    const wfDir = Path.join(workflowsDir(), run.workflow_id)
    const ymlPath = Path.join(wfDir, "workflow.yml")
    if (!Fs.existsSync(ymlPath)) {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: `Workflow "${run.workflow_id}" not found on disk` })))
    }

    const contextJson = getWorkflowState(db, runId, "context")
    let context: Record<string, string> = {}
    if (contextJson) {
      try {
        context = JSON.parse(contextJson)
      } catch {
        context = {}
      }
    }
    db.close()

    const spec = yield* _(loadWorkflowSpec(workflowsDir(), run.workflow_id).pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const result = yield* _(
      runWorkflow(spec as unknown as WorkflowSpec, context, {
        onEvent: () => Effect.void,
        workflowsDir: wfDir
      }, runId).pipe(
        Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
      )
    )

    return `Resumed ${runId}. Status: ${result.status}`
  })
}
```

- [ ] **Step 2: Update `src/cli/commands/pause.ts` with guard check**

```typescript
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import { openDb } from "../../workflow/state.js"
import { setDurableDeferred } from "../../db/queries.js"
import { hamiltonHome } from "../../paths.js"

export class PauseError extends Data.TaggedError("PauseError")<{
  runId: string
  message: string
}> {}

export function pauseWorkflow(runId: string): Effect.Effect<string, PauseError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new PauseError({
        runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const db = yield* _(openDb().pipe(
      Effect.mapError((e) => new PauseError({ runId, message: String(e) }))
    ))

    setDurableDeferred(db, `pause-${runId}`, runId, "paused", "paused-by-user")
    db.close()

    return `Paused ${runId}`
  })
}
```

- [ ] **Step 3: Run typecheck and full tests**

```bash
npx tsc --noEmit 2>&1 && npm test 2>&1
```
Expected: TypeScript clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/resume.ts src/cli/commands/pause.ts
git commit -m "feat: rewrite resume to restart execution with state machine, add guard checks"
```

---

### Task 7: Add guard checks to remaining CLI commands

**Files:**
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/logs.ts`
- Modify: `src/cli/commands/list.ts`
- Modify: `src/cli/commands/install.ts`

- [ ] **Step 1: Update `src/cli/commands/status.ts`**

Read the file first to find the right insertion point. Add this at the top of the function body (after `Effect.gen`), right after the `yield*` line if it exists, or as the first statement:

Add import at top:
```typescript
import * as Fs from "node:fs"
import { hamiltonHome } from "../../paths.js"
```

In `getRunStatus`, add as first line inside `Effect.gen`:
```typescript
if (!Fs.existsSync(hamiltonHome())) {
  return yield* _(Effect.fail(new RunStateError({
    runId,
    message: 'Hamilton is not initialized. Run "hamilton init" first.'
  })))
}
```

- [ ] **Step 2: Update `src/cli/commands/logs.ts`**

Read the file first. Add guard-checks for both `getRunLogs` and `followLogs` using the same pattern as above.

- [ ] **Step 3: Update `src/cli/commands/list.ts`**

Add at top of `Effect.gen`:
```typescript
if (!Fs.existsSync(hamiltonHome())) {
  return []
}
```

And add import:
```typescript
import { hamiltonHome } from "../../paths.js"
```

- [ ] **Step 4: Update `src/cli/commands/install.ts`**

Add guard check to `installWorkflow` and `uninstallWorkflow`:
```typescript
if (!Fs.existsSync(hamiltonHome())) {
  return yield* _(Effect.fail(new InstallError({
    workflowId,
    message: 'Hamilton is not initialized. Run "hamilton init" first.'
  })))
}
```

Add import from `../../paths.js`.

- [ ] **Step 5: Run typecheck and tests**

```bash
npx tsc --noEmit 2>&1 && npm test 2>&1
```
Expected: TypeScript clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/status.ts src/cli/commands/logs.ts src/cli/commands/list.ts src/cli/commands/install.ts
git commit -m "feat: add guard checks to all CLI subcommands"
```

---

### Task 8: Wire `init` subcommand in main.ts

**Files:**
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Add `init` import and routing**

Add import at top:
```typescript
import { initHamilton } from "./commands/init.js"
```

Add subcommand handling right before `if (subcommand === "list")`:

```typescript
  if (subcommand === "init") {
    const forceFlag = args.includes("--force")
    void Effect.runPromiseExit(initHamilton({ force: forceFlag })).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log("Hamilton initialized successfully.")
        console.log(`Installed ${result.value.length} workflows.`)
        for (const id of result.value) {
          console.log(`  ${id}`)
        }
        console.log("")
        console.log("Directories created:")
        console.log("  ~/.hamilton/agents/")
        console.log("  ~/.hamilton/workflows/")
        console.log("  ~/.hamilton/runs/")
        console.log("  ~/.hamilton/executors/pi/agent/")
      } else {
        console.error("Init failed:", String(result.cause))
        process.exitCode = 1
      }
    })
  } else if (subcommand === "list") {
```

Also update the help text (around line 15) to include:
```
  init [--force]                       Bootstrap Hamilton directories and install workflows
```

- [ ] **Step 2: Run typecheck and full test suite**

```bash
npx tsc --noEmit 2>&1 && npm test 2>&1
```
Expected: TypeScript clean, all tests pass.

- [ ] **Step 3: Verify build and CLI**

```bash
npm run build 2>&1 && node dist/cli/main.js 2>&1
```
Expected: Help output shows `init [--force]` command, `tsc` succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: wire init subcommand in main.ts"
```

---

### Task 9: Final verification — end-to-end test

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1
```
Expected: All tests pass (target: 135+).

- [ ] **Step 2: Build**

```bash
npm run build 2>&1
```
Expected: TypeScript compilation succeeds with no errors.

- [ ] **Step 3: Verify CLI output**

```bash
node dist/cli/main.js 2>&1
```
Expected: Help shows all commands including `init`.

- [ ] **Step 4: Test init on a temp home directory**

```bash
export TMP_HOME=$(mktemp -d) && HOME=$TMP_HOME node dist/cli/main.js init 2>&1 && echo "---" && ls -la $TMP_HOME/.hamilton/ && echo "---" && ls $TMP_HOME/.hamilton/agents/ && rm -rf $TMP_HOME
```
Expected: Shows directories created, workflows installed, agent list printed.

- [ ] **Step 5: Commit if no changes, otherwise the test passed already**

No commit needed — verification step only.
