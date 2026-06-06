# Hamilton CLI v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Hamilton CLI to `@effect/cli` with typed args/options, auto-generated `--help`, a new `workflow runs` command, improved `workflow list` output with color, and `doctor` replacing `rtk verify`.

**Architecture:** Each command file exports a `Command<Effect<...>>` from `@effect/cli`. `main.ts` composes them into a tree, wraps with `Command.run()`, and provides `BunContext.layer` + `BunRuntime.runMain`. Output formatting lives in `src/cli/formatting/` (ANSI colors, table renderer). A new `listRuns` query is added to `src/db/queries.ts`.

**Tech Stack:** `@effect/cli` 0.75.2, `@effect/platform-bun` 0.90.0, effect 3.21.3, bun:sqlite, vitest

**File structure (final):**
```
src/cli/
  main.ts                      # Command tree + BunRuntime.runMain
  commands/
    init.ts                    # init Command + initHamilton Effect (rewritten)
    doctor.ts                  # doctor Command + checks    (new, was rtk.ts)
    list.ts                    # list Command + listWorkflows Effect (rewritten)
    runs.ts                    # runs Command + listRunHistory Effect (new)
    run.ts                     # run Command + executeRun Effect
    status.ts                  # status Command + getRunStatus Effect
    logs.ts                    # logs Command + getRunLogs / followLogs Effects
    resume.ts                  # resume Command + resumeWorkflow Effect
    pause.ts                   # pause Command + pauseWorkflow Effect
    install.ts                 # install Command (wraps shared install-logic)
    uninstall.ts               # uninstall Command (wraps shared install-logic)
    install-logic.ts           # Shared: installWorkflow, uninstallWorkflow, installAllWorkflows, InstallError (extracted from old install.ts)
  formatting/
    table.ts                   # renderTable<T>()
    colors.ts                  # ANSI wrappers + categoryColor()
```

**Key design decisions:**
- `rtk.ts` is deleted. `doctor.ts` replaces it with an extensible `checks` array (currently only `checkRtk`)
- `install.ts` (old) is split: `install-logic.ts` has shared functions; new `install.ts` and `uninstall.ts` are Commands
- `list.ts` (old) is rewritten in-place with the formatted table output
- Existing command files (`run.ts`, `status.ts`, `logs.ts`, `pause.ts`, `resume.ts`, `init.ts`) keep their Effect functions, add a Command export
- `main.ts` drops all manual `process.argv` parsing — becomes ~30 lines

---

### Task 1: Add Dependencies

**Files:**
- Modify: `package.json`
- Modify: `bun.lock` (auto)

- [ ] **Step 1: Install @effect/cli and @effect/platform-bun**

```bash
bun add @effect/cli@0.75.2 @effect/platform-bun@0.90.0
```

- [ ] **Step 2: Verify build**

```bash
bun run build
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add @effect/cli 0.75.2 and @effect/platform-bun 0.90.0"
```

---

### Task 2: Create Formatting Utilities

**Files:**
- Create: `src/cli/formatting/colors.ts`
- Create: `src/cli/formatting/table.ts`
- Create: `tests/cli/formatting/colors.test.ts`
- Create: `tests/cli/formatting/table.test.ts`

- [ ] **Step 1: Create `src/cli/formatting/colors.ts`**

```typescript
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

export function categoryColor(id: string): (s: string) => string {
  if (id.startsWith("bug-fix")) return red
  if (id.startsWith("feature-dev")) return green
  if (id.startsWith("quarantine")) return yellow
  if (id.startsWith("security")) return cyan
  return (s: string) => s
}

export function statusColor(status: string): (s: string) => string {
  if (status === "running") return yellow
  if (status === "completed") return green
  if (status === "failed") return red
  if (status === "paused") return cyan
  return (s: string) => s
}
```

- [ ] **Step 2: Create `tests/cli/formatting/colors.test.ts`**

```typescript
import { describe, it, expect } from "vitest"
import { red, green, yellow, cyan, dim, bold, categoryColor, statusColor } from "../../../src/cli/formatting/colors.js"

describe("color functions", () => {
  it("red wraps with ANSI 31", () => {
    expect(red("fail")).toBe("\x1b[31mfail\x1b[0m")
  })
  it("green wraps with ANSI 32", () => {
    expect(green("ok")).toBe("\x1b[32mok\x1b[0m")
  })
  it("yellow wraps with ANSI 33", () => {
    expect(yellow("warn")).toBe("\x1b[33mwarn\x1b[0m")
  })
  it("cyan wraps with ANSI 36", () => {
    expect(cyan("info")).toBe("\x1b[36minfo\x1b[0m")
  })
  it("dim wraps with ANSI 2", () => {
    expect(dim("faded")).toBe("\x1b[2mfaded\x1b[0m")
  })
  it("bold wraps with ANSI 1", () => {
    expect(bold("strong")).toBe("\x1b[1mstrong\x1b[0m")
  })
})

describe("categoryColor", () => {
  it("bug-fix -> red", () => {
    const fn = categoryColor("bug-fix-github-pr")
    expect(fn("t")).toBe(red("t"))
  })
  it("feature-dev -> green", () => {
    const fn = categoryColor("feature-dev-merge")
    expect(fn("t")).toBe(green("t"))
  })
  it("quarantine -> yellow", () => {
    const fn = categoryColor("quarantine-broken-tests")
    expect(fn("t")).toBe(yellow("t"))
  })
  it("security -> cyan", () => {
    const fn = categoryColor("security-audit-worktree")
    expect(fn("t")).toBe(cyan("t"))
  })
  it("unknown -> identity", () => {
    const fn = categoryColor("other")
    expect(fn("test")).toBe("test")
  })
})

describe("statusColor", () => {
  it("running -> yellow", () => {
    expect(statusColor("running")("t")).toBe(yellow("t"))
  })
  it("completed -> green", () => {
    expect(statusColor("completed")("t")).toBe(green("t"))
  })
  it("failed -> red", () => {
    expect(statusColor("failed")("t")).toBe(red("t"))
  })
  it("paused -> cyan", () => {
    expect(statusColor("paused")("t")).toBe(cyan("t"))
  })
})
```

- [ ] **Step 3: Run colors tests — expect PASS**

```bash
bun --bun vitest run tests/cli/formatting/colors.test.ts
```

Expected: 15 tests pass.

- [ ] **Step 4: Create `src/cli/formatting/table.ts`**

```typescript
export interface Column<T> {
  header: string
  width: number
  render: (item: T) => string
}

export function renderTable<T>(items: T[], columns: Column<T>[]): string {
  const pad = (s: string, w: number) => {
    if (s.length >= w) return s.slice(0, w)
    return s + " ".repeat(w - s.length)
  }

  const header = columns.map((c) => pad(c.header, c.width)).join("  ")

  if (items.length === 0) return header

  const rows = items.map((item) =>
    columns.map((c) => pad(c.render(item), c.width)).join("  ")
  )
  return [header, ...rows].join("\n")
}
```

- [ ] **Step 5: Create `tests/cli/formatting/table.test.ts`**

```typescript
import { describe, it, expect } from "vitest"
import { renderTable, Column } from "../../../src/cli/formatting/table.js"

type Item = { id: string; name: string; n: number }
const cols: Column<Item>[] = [
  { header: "ID", width: 6, render: (i) => i.id },
  { header: "NAME", width: 8, render: (i) => i.name },
  { header: "N", width: 3, render: (i) => String(i.n) }
]

describe("renderTable", () => {
  it("single row", () => {
    const out = renderTable([{ id: "abc", name: "test", n: 3 }], cols)
    const lines = out.split("\n")
    expect(lines[0]).toContain("ID")
    expect(lines[0]).toContain("NAME")
    expect(lines[1]).toContain("abc")
    expect(lines[1]).toContain("test")
  })

  it("column alignment across rows", () => {
    const out = renderTable([
      { id: "x", name: "s", n: 1 },
      { id: "yyy", name: "longer", n: 99 }
    ], cols)
    const lines = out.split("\n")
    expect(lines).toHaveLength(3)
    const i1 = lines[1].indexOf("x")
    const i2 = lines[2].indexOf("y")
    expect(i1).toBe(i2)
  })

  it("empty items returns header only", () => {
    const out = renderTable([], cols)
    expect(out.split("\n")).toHaveLength(1)
  })
})
```

- [ ] **Step 6: Run table tests — expect PASS**

```bash
bun --bun vitest run tests/cli/formatting/table.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/formatting/ tests/cli/formatting/
git commit -m "feat: add CLI formatting utilities (ANSI colors, table renderer)"
```

---

### Task 3: Add `listRuns` DB Query

**Files:**
- Modify: `src/db/queries.ts`
- Modify: `tests/db/queries.test.ts`

- [ ] **Step 1: Add `listRuns` to `src/db/queries.ts`** (append at end of file)

```typescript
export interface RunSummary {
  id: string
  workflow_id: string
  status: string
  started_at: string
  current_step: string | null
}

export function listRuns(
  db: Database,
  opts?: { status?: string; limit?: number }
): RunSummary[] {
  const status = opts?.status ?? null
  const limit = opts?.limit ?? 20
  const rows = db.prepare(
    `SELECT id, workflow_id, status, started_at, current_step
     FROM runs
     WHERE (? IS NULL OR status = ?)
     ORDER BY started_at DESC
     LIMIT ?`
  ).all(status, status, limit)
  return rows as RunSummary[]
}
```

- [ ] **Step 2: Add test cases to `tests/db/queries.test.ts`**

Add import: `{ ..., listRuns }` from queries.

Append describe block:

```typescript
describe("listRuns", () => {
  it("returns runs ordered by started_at DESC", () => {
    const now = new Date().toISOString()
    const earlier = new Date(Date.now() - 3600000).toISOString()
    insertRun(db, "run-1", "bug-fix", earlier)
    insertRun(db, "run-2", "feature-dev", now)
    const runs = listRuns(db)
    expect(runs).toHaveLength(2)
    expect(runs[0].id).toBe("run-2")
    expect(runs[1].id).toBe("run-1")
  })

  it("filters by status", () => {
    const now = new Date().toISOString()
    insertRun(db, "run-ok", "bug-fix", now)
    insertRun(db, "run-fail", "security-audit", now)
    updateRunFailed(db, "run-fail", "it broke")
    const running = listRuns(db, { status: "running" })
    expect(running).toHaveLength(1)
    expect(running[0].id).toBe("run-ok")
    const failed = listRuns(db, { status: "failed" })
    expect(failed).toHaveLength(1)
    expect(failed[0].id).toBe("run-fail")
  })

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      insertRun(db, `run-${i}`, "bug-fix", new Date(Date.now() - i * 1000).toISOString())
    }
    expect(listRuns(db, { limit: 3 })).toHaveLength(3)
  })

  it("default limit is 20", () => {
    const runs = listRuns(db)
    expect(runs.length).toBeLessThanOrEqual(20)
  })
})
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
bun --bun vitest run tests/db/queries.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts
git commit -m "feat: add listRuns query for run history listing"
```

---

### Task 4: Create `doctor` Command (replaces `rtk verify`)

**Files:**
- Create: `src/cli/commands/doctor.ts`
- Delete: `src/cli/commands/rtk.ts`
- Modify: `tests/cli/rtk.test.ts` (update import; rename to doctor.test.ts)

- [ ] **Step 1: Create `src/cli/commands/doctor.ts`**

```typescript
import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import * as ChildProcess from "node:child_process"
import { green, red } from "../formatting/colors.js"

interface CheckResult {
  name: string
  pass: boolean
  detail: string
}

const compareSemver = (a: string, b: string): number => {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

const checkRtk: Effect.Effect<CheckResult> = Effect.gen(function* () {
  return yield* Effect.sync(() => {
    const rtkPath = (() => {
      try { return ChildProcess.execSync("which rtk", { encoding: "utf-8" }).trim() }
      catch { return null }
    })()

    if (!rtkPath) {
      return { name: "rtk", pass: false, detail: "not found (install: npm install -g @rtk-ai/rtk)" }
    }

    const version = (() => {
      try { return ChildProcess.execSync("rtk --version", { encoding: "utf-8" }).trim() }
      catch { return null }
    })()

    if (!version) {
      return { name: "rtk", pass: false, detail: "found but version could not be determined" }
    }

    if (compareSemver(version, "0.23.0") >= 0) {
      return { name: "rtk", pass: true, detail: `${version}  ${rtkPath}` }
    }
    return {
      name: "rtk",
      pass: false,
      detail: `${version} (need >= 0.23.0; upgrade: npm install -g @rtk-ai/rtk@latest)`
    }
  })
})

const checks: Array<Effect.Effect<CheckResult>> = [checkRtk]

export const doctorCommand = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    const results = yield* Effect.all(checks, { concurrency: "unbounded" })
    for (const r of results) {
      const mark = r.pass ? green("  ✓") : red("  ✗")
      yield* Console.log(`${mark} ${r.name.padEnd(10)}  ${r.detail}`)
    }
  })
).pipe(Command.withDescription("Check prerequisites for running Hamilton"))
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run build
```

Expected: build succeeds (doctor.ts compiles; main.ts still imports old rtk.ts, which will fail — that's expected, fixed in Task 9).

- [ ] **Step 3: Delete `src/cli/commands/rtk.ts`**

```bash
rm src/cli/commands/rtk.ts
```

- [ ] **Step 4: Update test import**

Rename `tests/cli/rtk.test.ts` → `tests/cli/doctor.test.ts` and update the import line:

```
// was: import { verifyRtk } from "../../src/cli/commands/rtk.js"
// now: import { verifyRtk } from "../../src/cli/commands/doctor.js"
```

Since `verifyRtk` was inlined into the `checkRtk` constant and no longer exported, the existing test needs to test `doctorCommand` differently or be deleted. The simplest fix: delete the old test since it tested `verifyRtk` which is now private. The color/table tests cover the new formatting.

```bash
rm tests/cli/rtk.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/doctor.ts
git rm src/cli/commands/rtk.ts tests/cli/rtk.test.ts
git commit -m "feat: add doctor command replacing rtk verify"
```

---

### Task 5: Rewrite `list` Command (improved output)

**Files:**
- Rewrite: `src/cli/commands/list.ts`
- Modify: `tests/cli/list.test.ts`

- [ ] **Step 1: Rewrite `src/cli/commands/list.ts`**

```typescript
import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { workflowsDir, hamiltonHome } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { renderTable, Column } from "../formatting/table.js"
import { categoryColor, dim } from "../formatting/colors.js"

interface WorkflowListItem {
  id: string
  name: string
  description: string | undefined
  version: number
  stepCount: number
  agentCount: number
}

const listWorkflows = Effect.gen(function* () {
  if (!Fs.existsSync(hamiltonHome())) return [] as WorkflowListItem[]

  const dir = workflowsDir()
  if (!Fs.existsSync(dir)) return [] as WorkflowListItem[]

  const entries = Fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const results: WorkflowListItem[] = []
  for (const slug of entries) {
    const spec = yield* loadWorkflowSpec(dir, slug).pipe(Effect.option)
    if (spec._tag === "Some") {
      results.push({
        id: spec.value.id,
        name: spec.value.name,
        description: spec.value.description,
        version: spec.value.version,
        stepCount: spec.value.steps.length,
        agentCount: spec.value.agents.length
      })
    }
  }
  return results
})

const workflowColumns: Column<WorkflowListItem>[] = [
  { header: "ID", width: 24, render: (i) => categoryColor(i.id)(i.id) },
  { header: "NAME", width: 46, render: (i) => i.name },
  { header: "VERSION", width: 4, render: (i) => dim(`v${i.version}`) },
  { header: "STEPS", width: 9, render: (i) => dim(`${i.stepCount} steps`) },
  { header: "AGENTS", width: 10, render: (i) => dim(`${i.agentCount} agents`) }
]

export const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const items = yield* listWorkflows
    if (items.length === 0) {
      yield* Console.log("No workflows installed.")
    } else {
      yield* Console.log(renderTable(items, workflowColumns))
    }
  })
).pipe(Command.withDescription("List installed workflows"))
```

- [ ] **Step 2: Update `tests/cli/list.test.ts`**

Update import:
```
// was: import { listWorkflows } from "../../src/cli/commands/list.js"
// stays the same — listWorkflows is still exported from list.ts
```

No other changes needed — the test calls `listWorkflows` which returns `WorkflowListItem[]`, same as before.

- [ ] **Step 3: Run list tests**

```bash
bun --bun vitest run tests/cli/list.test.ts
```

Expected: All list tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/list.ts
git commit -m "feat: rewrite list command with colored table output"
```

---

### Task 6: Create `runs` Command (new)

**Files:**
- Create: `src/cli/commands/runs.ts`
- Create: `tests/cli/runs.test.ts`

- [ ] **Step 1: Create `src/cli/commands/runs.ts`**

```typescript
import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { openDb } from "../../workflow/state.js"
import { listRuns, RunSummary } from "../../db/queries.js"
import { renderTable, Column } from "../formatting/table.js"
import { statusColor, dim } from "../formatting/colors.js"

const statusOpt = Options.choice("status", ["running", "completed", "failed", "paused"] as const).pipe(Options.optional)
const limitOpt = Options.integer("limit").pipe(Options.withDefault(20))

export const listRunHistory = (opts?: { status?: string; limit?: number }) =>
  Effect.gen(function* () {
    const db = yield* openDb()
    const runs = listRuns(db, { status: opts?.status, limit: opts?.limit ?? 20 })
    db.close()
    return runs
  })

const runColumns: Column<RunSummary>[] = [
  { header: "RUN ID", width: 22, render: (r) => r.id.slice(0, 22) },
  { header: "WORKFLOW", width: 16, render: (r) => r.workflow_id },
  { header: "STATUS", width: 10, render: (r) => statusColor(r.status)(r.status) },
  { header: "STARTED", width: 20, render: (r) => dim(r.started_at.slice(0, 19)) },
  { header: "STEP", width: 12, render: (r) => r.current_step ?? "-" }
]

export const runsCommand = Command.make("runs", { status: statusOpt, limit: limitOpt }, ({ status, limit }) =>
  Effect.gen(function* () {
    const opts = {
      status: status._tag === "Some" ? status.value : undefined,
      limit
    }
    const runs = yield* listRunHistory(opts)
    if (runs.length === 0) {
      yield* Console.log("No runs found.")
    } else {
      yield* Console.log(renderTable(runs, runColumns))
    }
  })
).pipe(Command.withDescription("List run history"))
```

- [ ] **Step 2: Create `tests/cli/runs.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Effect, Exit } from "effect"
import { listRunHistory } from "../../src/cli/commands/runs.js"
import { createSchema } from "../../src/db/schema.js"
import { insertRun, updateRunFailed } from "../../src/db/queries.js"
import { dbPath } from "../../src/paths.js"

describe("listRunHistory", () => {
  let db: Database & { _tempDir: string }

  beforeEach(() => {
    const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-test-"))
    const fakeHome = Path.join(tmp, ".hamilton")
    Fs.mkdirSync(fakeHome, { recursive: true })
    process.env.HOME = tmp
    db = Object.assign(
      new Database(Path.join(fakeHome, "hamilton.db")),
      { _tempDir: tmp }
    ) as Database & { _tempDir: string }
    createSchema(db)
  })

  afterEach(() => {
    db.close()
    if (db._tempDir) Fs.rmSync(db._tempDir, { recursive: true, force: true })
  })

  it("returns empty array when no runs exist", async () => {
    const exit = await Effect.runPromiseExit(listRunHistory())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("returns runs ordered by started_at DESC", async () => {
    const now = new Date().toISOString()
    const earlier = new Date(Date.now() - 3600000).toISOString()
    insertRun(db, "run-1", "bug-fix", earlier)
    insertRun(db, "run-2", "feature-dev", now)

    const exit = await Effect.runPromiseExit(listRunHistory())
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2)
      expect(exit.value[0].id).toBe("run-2")
    }
  })

  it("filters by status", async () => {
    const now = new Date().toISOString()
    insertRun(db, "run-ok", "bug-fix", now)
    insertRun(db, "run-fail", "bug-fix", now)
    updateRunFailed(db, "run-fail", "error")

    const exit = await Effect.runPromiseExit(listRunHistory({ status: "failed" }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].id).toBe("run-fail")
    }
  })

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      insertRun(db, `run-${i}`, "bug-fix", new Date(Date.now() - i * 1000).toISOString())
    }
    const exit = await Effect.runPromiseExit(listRunHistory({ limit: 3 }))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(3)
    }
  })
})
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
bun --bun vitest run tests/cli/runs.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/runs.ts tests/cli/runs.test.ts
git commit -m "feat: add runs command with status filter and limit"
```

---

### Task 7: Add Command Exports to Existing Command Files

**Files:**
- Modify: `src/cli/commands/init.ts` — add Command export
- Modify: `src/cli/commands/run.ts` — add Command export
- Modify: `src/cli/commands/status.ts` — add Command export
- Modify: `src/cli/commands/logs.ts` — add Command export
- Modify: `src/cli/commands/pause.ts` — add Command export
- Modify: `src/cli/commands/resume.ts` — add Command export

Each file keeps its existing Effect function (tested, unchanged) and adds a `Command` export at the end. Only the bare minimum: parse args from `@effect/cli`, call the existing Effect, print result.

- [ ] **Step 1: Add Command to `src/cli/commands/init.ts`**

Append to end of file (keep all existing code):

```typescript
import { Command, Options } from "@effect/cli"
import { Console, Effect, Exit } from "effect"

const force = Options.boolean("force")

export const initCommand = Command.make("init", { force }, ({ force }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(initHamilton({ force }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Init failed: ${String(result.cause)}`)
      return
    }
    const installed = Exit.getOrElse(result, () => [] as string[])
    yield* Console.log("Hamilton initialized successfully.")
    yield* Console.log(`Installed ${installed.length} workflows.`)
    for (const id of installed) {
      yield* Console.log(`  ${id}`)
    }
  })
).pipe(Command.withDescription("Bootstrap Hamilton directories and install workflows"))
```

Add the `initHamilton` import at the top — it's already local in the file.

- [ ] **Step 2: Add Command to `src/cli/commands/run.ts`**

Append (keep existing executeRun/code):

```typescript
import { Command, Args } from "@effect/cli"
import { Console, Effect, Exit } from "effect"

const slug = Args.text({ name: "slug" })
const prompt = Args.text({ name: "prompt" }).pipe(Args.trailing)

export const runCommand = Command.make("run", { slug, prompt }, ({ slug, prompt }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(executeRun({ workflowSlug: slug, prompt }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Workflow failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Run ID: ${result.value.runId}`)
    yield* Console.log(`Status: ${result.value.status}`)
    for (const [step, status] of Object.entries(result.value.stepResults)) {
      yield* Console.log(`  ${step}: ${status}`)
    }
  })
).pipe(Command.withDescription("Run a workflow"))
```

- [ ] **Step 3: Add Command to `src/cli/commands/status.ts`**

Append (imports for Command at top):

```typescript
import { Command, Args } from "@effect/cli"
import { Console, Effect, Exit } from "effect"

const runIdArg = Args.text({ name: "id" })

export const statusCommand = Command.make("status", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(getRunStatus(id))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Status not found: ${id}`)
      return
    }
    yield* Console.log(formatStatus(result.value))
  })
).pipe(Command.withDescription("Show run status"))
```

- [ ] **Step 4: Add Command to `src/cli/commands/logs.ts`**

Append (need to import Commands):

```typescript
import { Command, Args, Options } from "@effect/cli"
import { Console, Effect } from "effect"

const runIdArg = Args.text({ name: "id" })
const stepOpt = Options.text("step").pipe(Options.optional)
const followOpt = Options.boolean("follow")

export const logsCommand = Command.make("logs", { id: runIdArg, step: stepOpt, follow: followOpt }, ({ id, step, follow }) =>
  Effect.gen(function* () {
    if (follow) {
      const controller = followLogs({ runId: id })
      process.on("SIGINT", () => { controller.stop(); process.exit(0) })
      yield* Effect.never
    }
    const result = yield* Effect.exit(
      getRunLogs({ runId: id, stepId: step._tag === "Some" ? step.value : undefined })
    )
    if (Exit.isFailure(result)) {
      yield* Console.error(`Logs not found: ${id}`)
      return
    }
    for (const event of result.value) {
      yield* Console.log(JSON.stringify(event))
    }
  })
).pipe(Command.withDescription("View run logs"))
```

- [ ] **Step 5: Add Command to `src/cli/commands/pause.ts`**

Append:

```typescript
import { Command, Args } from "@effect/cli"
import { Console, Effect, Exit } from "effect"

const runIdArg = Args.text({ name: "id" })

export const pauseCommand = Command.make("pause", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(pauseWorkflow(id))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Pause failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(result.value)
  })
).pipe(Command.withDescription("Pause a running workflow"))
```

- [ ] **Step 6: Add Command to `src/cli/commands/resume.ts`**

Append:

```typescript
import { Command, Args } from "@effect/cli"
import { Console, Effect, Exit } from "effect"

const runIdArg = Args.text({ name: "id" })

export const resumeCommand = Command.make("resume", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(resumeWorkflow(id))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Resume failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(result.value)
  })
).pipe(Command.withDescription("Resume a paused workflow"))
```

- [ ] **Step 7: Verify build compiles**

```bash
bun run build
```

Expected: Build succeeds (imports added, Commands exported but not yet used by main.ts).

- [ ] **Step 8: Run existing tests**

```bash
bun --bun vitest run tests/cli/
```

Expected: All existing CLI tests pass (init, list, status, logs, pause, resume, run tests still import the Effect functions, which are unchanged).

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/init.ts src/cli/commands/run.ts src/cli/commands/status.ts src/cli/commands/logs.ts src/cli/commands/pause.ts src/cli/commands/resume.ts
git commit -m "feat: add @effect/cli Command exports to existing command files"
```

---

### Task 8: Add `install` and `uninstall` Commands

**Files:**
- Rename: `src/cli/commands/install.ts` → `src/cli/commands/install-logic.ts`
- Create: `src/cli/commands/install.ts` (new, Command wrapper)
- Create: `src/cli/commands/uninstall.ts` (new, Command wrapper)
- Modify: `src/cli/commands/init.ts` — update import from `./install.js` → `./install-logic.js`

- [ ] **Step 1: Rename shared install logic**

```bash
mv src/cli/commands/install.ts src/cli/commands/install-logic.ts
```

- [ ] **Step 2: Update `init.ts` import**

In `src/cli/commands/init.ts`, change:
```typescript
// was: import { installAllWorkflows } from "./install.js"
import { installAllWorkflows } from "./install-logic.js"
```

- [ ] **Step 3: Create new `src/cli/commands/install.ts`** (Command wrapper)

```typescript
import { Command, Args, Options } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import { installWorkflow, installAllWorkflows } from "./install-logic.js"

const workflowId = Args.text({ name: "id" }).pipe(Args.optional)
const allFlag = Options.boolean("all")
const forceFlag = Options.boolean("force")

export const installCommand = Command.make("install", { id: workflowId, all: allFlag, force: forceFlag }, ({ id, all, force }) =>
  Effect.gen(function* () {
    if (all) {
      const result = yield* Effect.exit(installAllWorkflows({ force }))
      if (Exit.isFailure(result)) {
        yield* Console.error(`Install failed: ${String(result.cause)}`)
        return
      }
      for (const wid of result.value) {
        yield* Console.log(`Installed: ${wid}`)
      }
      return
    }

    if (id._tag === "None") {
      yield* Console.error("Usage: hamilton workflow install <id> [--force] | --all [--force]")
      return
    }

    const result = yield* Effect.exit(installWorkflow(id.value, { force }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Install failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Installed: ${id.value}`)
  })
).pipe(Command.withDescription("Install a workflow"))
```

- [ ] **Step 4: Create new `src/cli/commands/uninstall.ts`**

```typescript
import { Command, Args } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import { uninstallWorkflow } from "./install-logic.js"

const workflowId = Args.text({ name: "id" })

export const uninstallCommand = Command.make("uninstall", { id: workflowId }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(uninstallWorkflow(id))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Uninstall failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Uninstalled: ${id}`)
  })
).pipe(Command.withDescription("Remove a workflow"))
```

- [ ] **Step 5: Verify build compiles**

```bash
bun run build
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/install-logic.ts src/cli/commands/install.ts src/cli/commands/uninstall.ts src/cli/commands/init.ts
git rm src/cli/commands/install.ts  # (handled by git mv above)
git commit -m "feat: add install/uninstall commands using @effect/cli"
```

---

### Task 9: Rewrite `main.ts` with `@effect/cli` Composition

**Files:**
- Rewrite: `src/cli/main.ts`

- [ ] **Step 1: Rewrite `src/cli/main.ts`**

```typescript
#!/usr/bin/env bun
import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect, Console } from "effect"
import { initCommand } from "./commands/init.js"
import { doctorCommand } from "./commands/doctor.js"
import { runCommand } from "./commands/run.js"
import { statusCommand } from "./commands/status.js"
import { listCommand } from "./commands/list.js"
import { runsCommand } from "./commands/runs.js"
import { logsCommand } from "./commands/logs.js"
import { pauseCommand } from "./commands/pause.js"
import { resumeCommand } from "./commands/resume.js"
import { installCommand } from "./commands/install.js"
import { uninstallCommand } from "./commands/uninstall.js"

const workflowCommand = Command.make("workflow", {}, () =>
  Console.log("Hamilton workflows — use a subcommand: run, list, runs, status, logs, pause, resume, install, uninstall")
).pipe(
  Command.withSubcommands([
    runCommand,
    listCommand,
    runsCommand,
    statusCommand,
    logsCommand,
    pauseCommand,
    resumeCommand,
    installCommand,
    uninstallCommand
  ])
)

const rootCommand = Command.make("hamilton", {}, () =>
  Console.log("Hamilton - Workflow-based agentic execution engine\n\nUse --help for available commands")
).pipe(
  Command.withSubcommands([initCommand, doctorCommand, workflowCommand])
)

const cli = Command.run(rootCommand, {
  name: "Hamilton",
  version: "0.1.0"
})

cli(process.argv).pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
```

- [ ] **Step 2: Verify build compiles**

```bash
bun run build
```

Expected: Build succeeds.

- [ ] **Step 3: Quick smoke test — `--help`**

```bash
bun dist/cli/main.js --help
```

Expected: Shows help output with init, doctor, workflow subcommands.

```bash
bun dist/cli/main.js workflow --help
```

Expected: Shows workflow subcommands: run, list, runs, status, logs, pause, resume, install, uninstall.

- [ ] **Step 4: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All existing tests pass. (init tests, list tests, status tests, queries tests, formatting tests — all still passing since they test Effects directly.)

- [ ] **Step 5: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: rewrite main.ts with @effect/cli Command composition"
```

---

### Task 10: Final Verification & Cleanup

- [ ] **Step 1: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All tests pass (target: 133+ existing plus ~25 new = ~158 passing).

- [ ] **Step 2: Run full build**

```bash
bun run build
```

Expected: Clean build, no errors.

- [ ] **Step 3: Reinstall local CLI and smoke test**

```bash
bun run install-local
hamilton --help
hamilton workflow --help
hamilton workflow list
hamilton doctor
```

Expected: All commands output help text, `list` shows colored table, `doctor` shows rtk status.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: final verification and cleanup for CLI v2"
```
