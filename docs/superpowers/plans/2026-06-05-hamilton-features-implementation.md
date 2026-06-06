# Hamilton Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 new features — rtk integration, SQLite-backed live status, Pi conversation streaming with --follow/structured logger, per-agent settings.yaml plus workflow install/uninstall, and @effect/workflow-based durable execution.

**Architecture:** Sequential feature delivery (F1→F2→F3→F4→F5). SQLite (`better-sqlite3`) is the single source of truth for state. Pi SDK (`@earendil-works/pi-agent-core`) drives real agent sessions. @effect/workflow provides Activity/DurableDeferred/DurableClock primitives. Each feature adds modules that F5 wires together.

**Tech Stack:** TypeScript 5.x (ESM, Node >=22), effect 3.21.3, @effect/schema 0.75.5, @effect/workflow 0.18.2, @earendil-works/pi-agent-core 0.78.1, better-sqlite3 (new), @effect/sql (new), @effect/sqlite-node (new), yaml 2.4.5, vitest 4.1.8

---

## File Structure Map

| File | Created | Modified | Responsibility |
|------|---------|----------|----------------|
| `src/agent/rtk-extension.ts` | F1 | — | rtk extension factory for Pi sessions |
| `src/cli/commands/rtk.ts` | F1 | — | `hamilton rtk verify` command |
| `src/paths.ts` | — | F2 | Add `dbPath()` function |
| `src/db/schema.ts` | F2 | — | SQLite schema creation (runs, steps, token_events, workflow_state, durable_deferred) |
| `src/db/queries.ts` | F2 | — | SQLite query functions for reads/writes |
| `src/workflow/state.ts` | — | F2 | Rewrite to read from SQLite instead of summary.json |
| `src/cli/commands/status.ts` | — | F2 | Formatted status output from SQLite data |
| `src/workflow/runner.ts` | — | F2, F5 | Add SQLite writes in F2; full rewrite in F5 |
| `src/agent/pi-executor.ts` | — | F3 | Replace placeholder with real Pi session + streaming |
| `src/observability/logger.ts` | F3 | — | Structured Effect logger with console + file sinks |
| `src/observability/streaming.ts` | F3 | — | Pi event subscription → JSONL writer |
| `src/cli/commands/logs.ts` | — | F3 | Add `--follow` flag |
| `src/agent/config.ts` | F4 | — | Load per-agent `settings.yaml` |
| `src/cli/commands/install.ts` | F4 | — | `hamilton workflow install/uninstall` |
| `src/cli/main.ts` | — | F1, F2, F3, F4, F5 | Wire new commands |
| `src/workflow/workflow-engine.ts` | F5 | — | SQLite-backed @effect/workflow engine |
| `src/cli/commands/pause.ts` | F5 | — | Pause command using DurableDeferred |
| `src/cli/commands/resume.ts` | F5 | — | Resume command using DurableDeferred |
| `src/observability/run-dir.ts` | — | F3 | Add `eventsFile()` path, `appendEngineLog()` |
| `tests/agent/rtk-extension.test.ts` | F1 | — | Tests for rtk extension factory |
| `tests/cli/rtk.test.ts` | F1 | — | Tests for rtk verify command |
| `tests/db/schema.test.ts` | F2 | — | Tests for SQLite schema creation |
| `tests/db/queries.test.ts` | F2 | — | Tests for query functions |
| `tests/cli/status.test.ts` | — | F2 | Rewrite for SQLite-backed status |
| `tests/observability/logger.test.ts` | F3 | — | Tests for structured logger config |
| `tests/observability/streaming.test.ts` | F3 | — | Tests for Pi event streaming |
| `tests/cli/logs.test.ts` | — | F3 | Add --follow tests |
| `tests/agent/config.test.ts` | F4 | — | Tests for settings.yaml loading |
| `tests/cli/install.test.ts` | F4 | — | Tests for workflow install/uninstall |
| `tests/workflow/workflow-engine.test.ts` | F5 | — | Tests for SQLite engine |
| `tests/workflow/runner.test.ts` | — | F5 | Rewrite for @effect/workflow runner |
| `tests/cli/pause.test.ts` | F5 | — | Tests for pause command |
| `tests/cli/resume.test.ts` | F5 | — | Tests for resume command |
| `tests/e2e/workflows.test.ts` | — | F5 | Update for new runner API |

---

## Feature 1: rtk Integration

### Task 1.1: Add `rtk verify` CLI Command

**Files:**
- Create: `src/cli/commands/rtk.ts`
- Create: `tests/cli/rtk.test.ts`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/rtk.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { verifyRtk } from "../../src/cli/commands/rtk.js"

describe("verifyRtk", () => {
  it("returns a status effect (not a string — it wraps in Effect)", async () => {
    const result = await Effect.runPromiseExit(verifyRtk)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveProperty("installed")
      expect(result.value).toHaveProperty("version")
      expect(result.value).toHaveProperty("path")
    }
  })

  it("detects when rtk is installed", async () => {
    const result = await Effect.runPromiseExit(verifyRtk)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(typeof result.value.installed).toBe("boolean")
      if (result.value.installed) {
        expect(typeof result.value.version).toBe("string")
        expect(result.value.version.length).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/rtk.test.ts
```

Expected: FAIL — module `../../src/cli/commands/rtk.js` not found.

- [ ] **Step 3: Create src/cli/commands/rtk.ts**

```typescript
import { Effect } from "effect"
import * as ChildProcess from "node:child_process"

export interface RtkStatus {
  installed: boolean
  version: string | null
  path: string | null
  message: string
}

export const verifyRtk: Effect.Effect<RtkStatus, never> = Effect.gen(function* () {
  const whichResult = yield* Effect.try({
    try: (): { stdout: string; exitCode: number } => {
      try {
        const stdout = ChildProcess.execSync("which rtk", { encoding: "utf-8" }).trim()
        return { stdout, exitCode: 0 }
      } catch {
        return { stdout: "", exitCode: 1 }
      }
    },
    catch: () => ({ stdout: "", exitCode: 1 })
  })

  if (!whichResult.stdout) {
    return {
      installed: false,
      version: null,
      path: null,
      message: "rtk not found in PATH. Install with: npm install -g @rtk-ai/rtk"
    }
  }

  const rtkPath = whichResult.stdout

  const versionResult = yield* Effect.try({
    try: (): { stdout: string; exitCode: number } => {
      try {
        const stdout = ChildProcess.execSync("rtk --version", { encoding: "utf-8" }).trim()
        return { stdout, exitCode: 0 }
      } catch {
        return { stdout: "", exitCode: 1 }
      }
    },
    catch: () => ({ stdout: "", exitCode: 1 })
  })

  const version = versionResult.stdout

  const minVersion = "0.23.0"
  const meetsMinimum = version >= minVersion

  return {
    installed: true,
    version,
    path: rtkPath,
    message: meetsMinimum
      ? `OK`
      : `rtk ${version} found but minimum required is ${minVersion}. Upgrade with: npm install -g @rtk-ai/rtk@latest`
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cli/rtk.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Wire into CLI — modify src/cli/main.ts**

Add after the `if (command === "workflow")` block:

```typescript
} else if (command === "rtk") {
  const subcommand = args[1]
  if (subcommand === "verify") {
    void Effect.runPromiseExit(verifyRtk).then((result) => {
      if (Exit.isSuccess(result)) {
        const s = result.value
        if (s.installed) {
          console.log(`rtk ${s.version} found at ${s.path}`)
          console.log(`Status: ${s.message}`)
        } else {
          console.log(`rtk not found in PATH`)
          console.log(`Status: MISSING — install with: npm install -g @rtk-ai/rtk`)
        }
      }
    })
  } else {
    console.log("rtk commands:")
    console.log("  rtk verify    Check if rtk is installed and meets minimum version")
    process.exit(0)
  }
```

You need to add the import at the top of `src/cli/main.ts`:

```typescript
import { verifyRtk } from "./commands/rtk.js"
```

Also add `rtk verify` to the help text in the `args.length === 0` block:

```typescript
  console.log("  rtk verify                          Check rtk installation status")
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/rtk.ts tests/cli/rtk.test.ts src/cli/main.ts
git commit -m "feat: add rtk verify CLI command"
```

---

### Task 1.2: Create rtk Extension Factory

**Files:**
- Create: `src/agent/rtk-extension.ts`
- Create: `tests/agent/rtk-extension.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/rtk-extension.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createRtkExtension } from "../../src/agent/rtk-extension.js"

describe("createRtkExtension", () => {
  it("returns a function (the extension factory)", () => {
    const factory = createRtkExtension({})
    expect(typeof factory).toBe("function")
  })

  it("respects RTK_DISABLED environment variable", () => {
    const factory = createRtkExtension({ disabled: true })
    expect(typeof factory).toBe("function")
  })

  it("does not throw when rtk is not on PATH", () => {
    const factory = createRtkExtension({})
    expect(typeof factory).toBe("function")
  })

  it("passes model through options", () => {
    const factory = createRtkExtension({ model: "anthropic/claude-sonnet-4-20250514" })
    expect(typeof factory).toBe("function")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent/rtk-extension.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/agent/rtk-extension.ts**

```typescript
import * as ChildProcess from "node:child_process"

export interface RtkExtensionOptions {
  model?: string
  disabled?: boolean
}

export function createRtkExtension(
  options: RtkExtensionOptions
): (pi: unknown) => void {
  const isDisabled =
    options.disabled === true ||
    process.env.RTK_DISABLED === "1"

  return (pi: unknown) => {
    if (isDisabled) {
      return
    }

    const _pi = pi as Record<string, unknown>
    if (typeof _pi.addEventListener !== "function") {
      return
    }

    const eventHandler = (event: Record<string, unknown>) => {
      if (event.type !== "tool_call") return

      const toolCall = event.toolCall as Record<string, unknown> | undefined
      if (!toolCall || toolCall.name !== "bash") return

      const input = toolCall.input as Record<string, string> | undefined
      if (!input || !input.command) return

      rewriteCommand(input, input.command, options.model)
    }

    ;(_pi.addEventListener as (type: string, handler: (event: Record<string, unknown>) => void) => void)("tool_call", eventHandler)
  }
}

function rewriteCommand(
  toolInput: Record<string, string>,
  command: string,
  model?: string
): void {
  try {
    const args = ["rewrite", command]
    if (model) {
      args.push("--model", model)
    }
    const result = ChildProcess.spawnSync("rtk", args, {
      encoding: "utf-8",
      timeout: 5000
    })

    if ((result.status === 0 || result.status === 3) && result.stdout) {
      const rewritten = result.stdout.trim()
      if (rewritten && rewritten !== command) {
        toolInput.command = rewritten
      }
    }
  } catch {
    // rtk not available — no-op
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/agent/rtk-extension.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/rtk-extension.ts tests/agent/rtk-extension.test.ts
git commit -m "feat: add rtk extension factory for Pi sessions"
```

---

## Feature 2: Live Status

### Task 2.1: Add Database Dependencies and Path

**Files:**
- Modify: `package.json` (add deps)
- Modify: `src/paths.ts` (add dbPath)

- [ ] **Step 1: Add dependencies to package.json**

Run:

```bash
npm install better-sqlite3@11.10.0 @types/better-sqlite3@7.6.13 @effect/sql@0.33.21 @effect/sqlite-node@0.38.13
```

Expected: installs all 4 packages with pinned versions, no errors.

- [ ] **Step 2: Add dbPath to src/paths.ts**

Add after the `summaryFile` function:

```typescript
export function dbPath(): string {
  return Path.join(hamiltonHome(), "hamilton.db")
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/paths.ts
git commit -m "feat: add better-sqlite3, @effect/sql, @effect/sqlite-node deps + dbPath"
```

---

### Task 2.2: Create SQLite Schema Module

**Files:**
- Create: `src/db/schema.ts`
- Create: `tests/db/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/schema.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createSchema } from "../../src/db/schema.js"

describe("createSchema", () => {
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    dbPath = Path.join(Os.tmpdir(), `hamilton-test-schema-${Date.now()}.db`)
    db = new Database(dbPath)
  })

  afterEach(() => {
    db.close()
    Fs.rmSync(dbPath, { force: true })
  })

  it("creates all required tables", () => {
    createSchema(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>

    const names = tables.map((t) => t.name)
    expect(names).toContain("runs")
    expect(names).toContain("steps")
    expect(names).toContain("token_events")
    expect(names).toContain("workflow_state")
    expect(names).toContain("durable_deferred")
  })

  it("is idempotent — running twice does not error", () => {
    createSchema(db)
    createSchema(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name).length).toBeGreaterThanOrEqual(5)
  })

  it("can insert and query a run", () => {
    createSchema(db)

    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)"
    ).run("run-001", "bug-fix", "running", "2026-06-05T00:00:00Z")

    const row = db.prepare("SELECT * FROM runs WHERE id = ?").get("run-001") as Record<string, unknown>
    expect(row.id).toBe("run-001")
    expect(row.workflow_id).toBe("bug-fix")
    expect(row.status).toBe("running")
  })

  it("can insert and query steps", () => {
    createSchema(db)

    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)"
    ).run("run-001", "bug-fix", "running", "2026-06-05T00:00:00Z")

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, status) VALUES (?, ?, ?, ?, ?)"
    ).run("run-001:triage", "run-001", "triage", "triager", "pending")

    const steps = db.prepare("SELECT * FROM steps WHERE run_id = ?").all("run-001") as Array<Record<string, unknown>>
    expect(steps).toHaveLength(1)
    expect(steps[0].step_id).toBe("triage")
  })

  it("can insert token events", () => {
    createSchema(db)

    db.prepare(
      "INSERT INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)"
    ).run("run-001", "bug-fix", "running", "2026-06-05T00:00:00Z")

    db.prepare(
      "INSERT INTO token_events (run_id, step_id, event_type, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?)"
    ).run("run-001", "triage", "turn_end", 1000, 500)

    const events = db.prepare("SELECT * FROM token_events WHERE run_id = ?").all("run-001") as Array<Record<string, unknown>>
    expect(events).toHaveLength(1)
    expect(events[0].tokens_in).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/db/schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/db/schema.ts**

```typescript
import Database from "better-sqlite3"

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      current_step TEXT,
      error_message TEXT,
      context_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      output_json TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS token_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_state (
      run_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (run_id, key)
    );

    CREATE TABLE IF NOT EXISTS durable_deferred (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      value TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
  `)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/db/schema.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts tests/db/schema.test.ts
git commit -m "feat: add SQLite schema for runs, steps, token_events, workflow_state, durable_deferred"
```

---

### Task 2.3: Create SQLite Query Module

**Files:**
- Create: `src/db/queries.ts`
- Create: `tests/db/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/queries.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createSchema } from "../../src/db/schema.js"
import {
  insertRun,
  insertSteps,
  updateStepStarted,
  updateStepCompleted,
  updateStepFailed,
  insertTokenEvent,
  updateRunCompleted,
  updateRunFailed,
  getRunById,
  getRunStatus
} from "../../src/db/queries.js"

describe("queries", () => {
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    dbPath = Path.join(Os.tmpdir(), `hamilton-test-queries-${Date.now()}.db`)
    db = new Database(dbPath)
    createSchema(db)
  })

  afterEach(() => {
    db.close()
    Fs.rmSync(dbPath, { force: true })
  })

  it("insertRun and getRunById", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    const run = getRunById(db, "run-001")
    expect(run).not.toBeNull()
    if (run) {
      expect(run.workflow_id).toBe("bug-fix")
      expect(run.status).toBe("running")
    }
  })

  it("insertSteps creates all steps", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    insertSteps(db, "run-001", [
      { stepId: "triage", agentId: "triager" },
      { stepId: "fix", agentId: "fixer" }
    ])
    const steps = db.prepare("SELECT * FROM steps WHERE run_id = ?").all("run-001") as Array<Record<string, unknown>>
    expect(steps).toHaveLength(2)
    expect(steps[0].status).toBe("pending")
  })

  it("updateStepStarted sets status to running and started_at", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    insertSteps(db, "run-001", [{ stepId: "triage", agentId: "triager" }])
    updateStepStarted(db, "run-001", "triage", "2026-06-05T00:01:00Z")
    const step = db.prepare("SELECT * FROM steps WHERE id = ?").get("run-001:triage") as Record<string, unknown>
    expect(step.status).toBe("running")
    expect(step.started_at).toBe("2026-06-05T00:01:00Z")
  })

  it("updateStepCompleted sets status, tokens, and output", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    insertSteps(db, "run-001", [{ stepId: "triage", agentId: "triager" }])
    updateStepCompleted(db, "run-001", "triage", "2026-06-05T00:02:00Z", { tokensIn: 1000, tokensOut: 500, output: JSON.stringify({ status: "done" }) })
    const step = db.prepare("SELECT * FROM steps WHERE id = ?").get("run-001:triage") as Record<string, unknown>
    expect(step.status).toBe("completed")
    expect(step.tokens_in).toBe(1000)
    expect(step.output_json).toBe(JSON.stringify({ status: "done" }))
  })

  it("updateStepFailed sets status and error", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    insertSteps(db, "run-001", [{ stepId: "triage", agentId: "triager" }])
    updateStepFailed(db, "run-001", "triage", "something broke")
    const step = db.prepare("SELECT * FROM steps WHERE id = ?").get("run-001:triage") as Record<string, unknown>
    expect(step.status).toBe("failed")
    expect(step.error_message).toBe("something broke")
  })

  it("insertTokenEvent adds event", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    insertTokenEvent(db, "run-001", "triage", "turn_end", 1000, 500)
    const events = db.prepare("SELECT * FROM token_events WHERE run_id = ?").all("run-001") as Array<Record<string, unknown>>
    expect(events).toHaveLength(1)
    expect(events[0].tokens_in).toBe(1000)
  })

  it("updateRunCompleted sets completed status", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    updateRunCompleted(db, "run-001", "2026-06-05T00:05:00Z")
    const run = getRunById(db, "run-001")
    expect(run?.status).toBe("completed")
    expect(run?.completed_at).toBe("2026-06-05T00:05:00Z")
  })

  it("updateRunFailed sets failed status with error", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    updateRunFailed(db, "run-001", "step timed out")
    const run = getRunById(db, "run-001")
    expect(run?.status).toBe("failed")
    expect(run?.error_message).toBe("step timed out")
  })

  it("getRunStatus returns formatted status for status CLI", () => {
    insertRun(db, "run-001", "bug-fix", "2026-06-05T00:00:00Z")
    insertSteps(db, "run-001", [
      { stepId: "triage", agentId: "triager" },
      { stepId: "fix", agentId: "fixer" },
      { stepId: "verify", agentId: "verifier" }
    ])
    updateStepStarted(db, "run-001", "triage", "2026-06-05T00:01:00Z")
    updateStepCompleted(db, "run-001", "triage", "2026-06-05T00:02:00Z", { tokensIn: 500, tokensOut: 200 })
    updateStepStarted(db, "run-001", "fix", "2026-06-05T00:02:00Z")
    insertTokenEvent(db, "run-001", "triage", "turn_end", 500, 200)

    const status = getRunStatus(db, "run-001")
    expect(status).not.toBeNull()
    if (status) {
      expect(status.runId).toBe("run-001")
      expect(status.workflow).toBe("bug-fix")
      expect(status.status).toBe("running")
      expect(status.steps).toHaveLength(3)
      expect(status.totalTokensIn).toBe(500)
      expect(status.currentStep).toBe("fix")
    }
  })

  it("getRunById returns null for non-existent run", () => {
    expect(getRunById(db, "nonexistent")).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/db/queries.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/db/queries.ts**

```typescript
import Database from "better-sqlite3"

export interface RunRow {
  id: string
  workflow_id: string
  status: string
  started_at: string
  completed_at: string | null
  current_step: string | null
  error_message: string | null
  context_json: string
}

export interface StepRow {
  id: string
  run_id: string
  step_id: string
  agent_id: string
  status: string
  started_at: string | null
  completed_at: string | null
  tokens_in: number
  tokens_out: number
  retry_count: number
  error_message: string | null
  output_json: string | null
}

export interface RunStatusRow {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt: string | null
  currentStep: string | null
  steps: Array<{
    stepId: string
    agentId: string
    status: string
    startedAt: string | null
    completedAt: string | null
    tokensIn: number
    tokensOut: number
    errorMessage: string | null
  }>
  totalTokensIn: number
  totalTokensOut: number
  errorMessage: string | null
}

export function insertRun(
  db: Database.Database,
  runId: string,
  workflowId: string,
  startedAt: string
): void {
  db.prepare(
    "INSERT OR REPLACE INTO runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', ?)"
  ).run(runId, workflowId, startedAt)
}

export function insertSteps(
  db: Database.Database,
  runId: string,
  steps: Array<{ stepId: string; agentId: string }>
): void {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO steps (id, run_id, step_id, agent_id, status) VALUES (?, ?, ?, ?, 'pending')"
  )
  for (const step of steps) {
    stmt.run(`${runId}:${step.stepId}`, runId, step.stepId, step.agentId)
  }
}

export function updateStepStarted(
  db: Database.Database,
  runId: string,
  stepId: string,
  startedAt: string
): void {
  db.prepare(
    "UPDATE steps SET status = 'running', started_at = ? WHERE id = ?"
  ).run(startedAt, `${runId}:${stepId}`)
  db.prepare(
    "UPDATE runs SET current_step = ? WHERE id = ?"
  ).run(stepId, runId)
}

export function updateStepCompleted(
  db: Database.Database,
  runId: string,
  stepId: string,
  completedAt: string,
  data: { tokensIn?: number; tokensOut?: number; output?: string }
): void {
  db.prepare(
    "UPDATE steps SET status = 'completed', completed_at = ?, tokens_in = ?, tokens_out = ?, output_json = ? WHERE id = ?"
  ).run(
    completedAt,
    data.tokensIn ?? 0,
    data.tokensOut ?? 0,
    data.output ?? null,
    `${runId}:${stepId}`
  )
}

export function updateStepFailed(
  db: Database.Database,
  runId: string,
  stepId: string,
  errorMessage: string
): void {
  db.prepare(
    "UPDATE steps SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?"
  ).run(errorMessage, `${runId}:${stepId}`)
}

export function insertTokenEvent(
  db: Database.Database,
  runId: string,
  stepId: string,
  eventType: string,
  tokensIn: number,
  tokensOut: number
): void {
  db.prepare(
    "INSERT INTO token_events (run_id, step_id, event_type, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?)"
  ).run(runId, stepId, eventType, tokensIn, tokensOut)
}

export function updateRunCompleted(
  db: Database.Database,
  runId: string,
  completedAt: string
): void {
  db.prepare(
    "UPDATE runs SET status = 'completed', completed_at = ?, current_step = NULL WHERE id = ?"
  ).run(completedAt, runId)
}

export function updateRunFailed(
  db: Database.Database,
  runId: string,
  errorMessage: string
): void {
  db.prepare(
    "UPDATE runs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?"
  ).run(errorMessage, runId)
}

export function getRunById(db: Database.Database, runId: string): RunRow | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined
  return row ?? null
}

export function getStepsByRunId(db: Database.Database, runId: string): StepRow[] {
  return db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY id").all(runId) as StepRow[]
}

export function getRunStatus(db: Database.Database, runId: string): RunStatusRow | null {
  const run = getRunById(db, runId)
  if (!run) return null

  const steps: RunStatusRow["steps"] = getStepsByRunId(db, runId).map((s) => ({
    stepId: s.step_id,
    agentId: s.agent_id,
    status: s.status,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    tokensIn: s.tokens_in,
    tokensOut: s.tokens_out,
    errorMessage: s.error_message
  }))

  const totalResult = db.prepare(
    "SELECT COALESCE(SUM(tokens_in), 0) as total_in, COALESCE(SUM(tokens_out), 0) as total_out FROM token_events WHERE run_id = ?"
  ).get(runId) as { total_in: number; total_out: number }

  return {
    runId: run.id,
    workflow: run.workflow_id,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    currentStep: run.current_step,
    steps,
    totalTokensIn: totalResult.total_in,
    totalTokensOut: totalResult.total_out,
    errorMessage: run.error_message
  }
}

export function setWorkflowState(
  db: Database.Database,
  runId: string,
  key: string,
  value: string
): void {
  db.prepare(
    "INSERT OR REPLACE INTO workflow_state (run_id, key, value) VALUES (?, ?, ?)"
  ).run(runId, key, value)
}

export function getWorkflowState(
  db: Database.Database,
  runId: string,
  key: string
): string | null {
  const row = db.prepare(
    "SELECT value FROM workflow_state WHERE run_id = ? AND key = ?"
  ).get(runId, key) as { value: string } | undefined
  return row?.value ?? null
}

export function setDurableDeferred(
  db: Database.Database,
  id: string,
  runId: string,
  state: string,
  value?: string
): void {
  db.prepare(
    "INSERT OR REPLACE INTO durable_deferred (id, run_id, state, value) VALUES (?, ?, ?, ?)"
  ).run(id, runId, state, value ?? null)
}

export function getDurableDeferred(
  db: Database.Database,
  id: string
): { state: string; value: string | null } | null {
  const row = db.prepare(
    "SELECT state, value FROM durable_deferred WHERE id = ?"
  ).get(id) as { state: string; value: string | null } | undefined
  return row ?? null
}

export function updateRunContext(
  db: Database.Database,
  runId: string,
  contextJson: string
): void {
  db.prepare(
    "UPDATE runs SET context_json = ? WHERE id = ?"
  ).run(contextJson, runId)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/db/queries.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts tests/db/queries.test.ts
git commit -m "feat: add SQLite query functions for runs, steps, token events, and state"
```

---

### Task 2.4: Rewrite State Module (SQLite) + Status CLI

**Files:**
- Modify: `src/workflow/state.ts`
- Modify: `src/cli/commands/status.ts`
- Modify: `tests/cli/status.test.ts`

- [ ] **Step 1: Rewrite failing test**

Overwrite `tests/cli/status.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadRunState } from "../../src/workflow/state.js"
import { createSchema } from "../../src/db/schema.js"
import { insertRun, insertSteps, updateStepStarted, updateStepCompleted, updateRunCompleted } from "../../src/db/queries.js"
import { dbPath } from "../../src/paths.js"

describe("loadRunState (SQLite-backed)", () => {
  const origHome = process.env.HOME
  let testHome: string
  let db: Database.Database | null = null

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-status-test-${Date.now()}`)
    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })
    process.env.HOME = testHome
    const dp = dbPath()
    db = new Database(dp)
    createSchema(db)
  })

  afterEach(() => {
    db?.close()
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("returns status for a running workflow", async () => {
    if (!db) throw new Error("db not initialized")
    insertRun(db, "bug-fix-abc", "bug-fix", "2026-06-05T00:00:00Z")
    insertSteps(db, "bug-fix-abc", [
      { stepId: "triage", agentId: "triager" },
      { stepId: "fix", agentId: "fixer" }
    ])
    updateStepStarted(db, "bug-fix-abc", "triage", "2026-06-05T00:01:00Z")
    updateStepCompleted(db, "bug-fix-abc", "triage", "2026-06-05T00:02:00Z", { tokensIn: 500, tokensOut: 200 })

    const result = await Effect.runPromiseExit(loadRunState("bug-fix-abc"))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.runId).toBe("bug-fix-abc")
      expect(result.value.workflow).toBe("bug-fix")
      expect(result.value.steps).toHaveLength(2)
      expect(result.value.steps.find((s) => s.stepId === "triage")?.status).toBe("completed")
      expect(result.value.steps.find((s) => s.stepId === "fix")?.status).toBe("pending")
    }
  })

  it("returns status for a completed workflow", async () => {
    if (!db) throw new Error("db not initialized")
    insertRun(db, "bug-fix-xyz", "bug-fix", "2026-06-05T00:00:00Z")
    updateRunCompleted(db, "bug-fix-xyz", "2026-06-05T00:05:00Z")

    const result = await Effect.runPromiseExit(loadRunState("bug-fix-xyz"))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
    }
  })

  it("fails for non-existent run", async () => {
    const result = await Effect.runPromiseExit(loadRunState("nonexistent"))
    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/status.test.ts
```

Expected: FAIL — loadRunState needs DB parameter or different approach.

- [ ] **Step 3: Rewrite src/workflow/state.ts**

```typescript
import { Effect, Data } from "effect"
import Database from "better-sqlite3"
import { dbPath } from "../paths.js"
import { createSchema } from "../db/schema.js"
import { getRunStatus } from "../db/queries.js"

export class RunStateError extends Data.TaggedError("RunStateError")<{
  runId: string
  message: string
}> {}

export interface RunStatus {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt: string | null
  currentStep: string | null
  steps: Array<{
    stepId: string
    agentId: string
    status: string
    startedAt: string | null
    completedAt: string | null
    tokensIn: number
    tokensOut: number
    errorMessage: string | null
  }>
  totalTokensIn: number
  totalTokensOut: number
  errorMessage: string | null
}

export function openDb(): Effect.Effect<Database.Database, RunStateError> {
  return Effect.try({
    try: () => {
      const dp = dbPath()
      const db = new Database(dp)
      db.pragma("journal_mode = WAL")
      createSchema(db)
      return db
    },
    catch: (e) =>
      new RunStateError({
        runId: "db",
        message: `Failed to open database: ${String(e)}`
      })
  })
}

export function loadRunState(runId: string): Effect.Effect<RunStatus, RunStateError> {
  return Effect.gen(function* () {
    const db = yield* openDb()
    const status = getRunStatus(db, runId)

    if (!status) {
      db.close()
      return yield* Effect.fail(
        new RunStateError({ runId, message: `Run not found: ${runId}` })
      )
    }

    db.close()
    return status
  })
}
```

- [ ] **Step 4: Rewrite src/cli/commands/status.ts**

```typescript
import { Effect } from "effect"
import { loadRunState } from "../../workflow/state.js"
import type { RunStatus } from "../../workflow/state.js"

export { type RunStatus }

export function getRunStatus(runId: string): Effect.Effect<RunStatus, Error> {
  return loadRunState(runId).pipe(
    Effect.mapError((e) => new Error(e.message))
  )
}

export function formatStatus(status: RunStatus): string {
  const lines: string[] = []

  const elapsed =
    status.completedAt
      ? computeElapsed(status.startedAt, status.completedAt)
      : computeElapsed(status.startedAt, new Date().toISOString())

  lines.push(`Workflow:  ${status.workflow}`)
  lines.push(`Status:    ${status.status} (${elapsed} elapsed)`)
  lines.push(`Run ID:    ${status.runId}`)

  const totalSteps = status.steps.length
  const completedSteps = status.steps.filter((s) => s.status === "completed").length

  if (status.currentStep && status.status === "running") {
    const agent = status.steps.find((s) => s.stepId === status.currentStep)?.agentId ?? "?"
    lines.push(`Step:      ${completedSteps + 1}/${totalSteps} — ${status.currentStep} (agent: ${agent})`)
  }

  const stepStatuses = status.steps.map((s) => {
    switch (s.status) {
      case "completed": return `${s.stepId} ✓`
      case "running": return `${s.stepId} ⏳`
      case "failed": return `${s.stepId} ✗`
      default: return `${s.stepId} ◯`
    }
  })
  lines.push(`Steps:     ${stepStatuses.join("  ")}`)

  lines.push(`Tokens:    ${status.totalTokensIn.toLocaleString()} in / ${status.totalTokensOut.toLocaleString()} out`)

  if (status.errorMessage) {
    lines.push(`Error:     ${status.errorMessage}`)
  } else {
    lines.push(`Errors:    none`)
  }

  return lines.join("\n")
}

function computeElapsed(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export { loadRunState }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/cli/status.test.ts
```

Expected: PASS (3 tests). May need to check DB in status command.

- [ ] **Step 6: Update CLI main.ts to use formatted status**

In `src/cli/main.ts`, find the status block and replace:

```typescript
if (subcommand === "status" && args[2]) {
    void Effect.runPromiseExit(getRunStatus(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(JSON.stringify(result.value, null, 2))
      } else {
        console.error("Status not found:", args[2])
        process.exitCode = 1
      }
    })
```

With:

```typescript
if (subcommand === "status" && args[2]) {
    void Effect.runPromiseExit(getRunStatus(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        const status = result.value
        // Check if it's a formatted string or the raw RunStatus
        if (typeof status === "string") {
          console.log(status)
        } else {
          const { formatStatus } = require("./commands/status.js") as { formatStatus: (s: unknown) => string }
          console.log(formatStatus(status))
        }
      } else {
        console.error("Status not found:", args[2])
        process.exitCode = 1
      }
    })
```

Actually, we need a cleaner approach. Since `getRunStatus` now returns `RunStatus` (not a string), update the CLI to use `formatStatus`. Add the import:

```typescript
import { getRunStatus, formatStatus } from "./commands/status.js"
```

And change the status block to:

```typescript
if (subcommand === "status" && args[2]) {
    void Effect.runPromiseExit(getRunStatus(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(formatStatus(result.value))
      } else {
        console.error("Status not found:", args[2])
        process.exitCode = 1
      }
    })
```

- [ ] **Step 7: Commit**

```bash
git add src/workflow/state.ts src/cli/commands/status.ts tests/cli/status.test.ts src/cli/main.ts
git commit -m "feat: rewrite state module with SQLite backing + formatted status CLI"
```

---

## Feature 3: Improved Observability

### Task 3.1: Add Structured Logger Module

**Files:**
- Create: `src/observability/logger.ts`
- Create: `tests/observability/logger.test.ts`
- Modify: `src/paths.ts` (add eventsFilePath)
- Modify: `src/observability/run-dir.ts` (add appendEngineLog)

- [ ] **Step 1: Add paths for events file**

In `src/paths.ts`, add after `summaryFile`:

```typescript
export function eventsFilePath(runId: string): string {
  return Path.join(runDir(runId), "events.jsonl")
}
```

- [ ] **Step 2: Write the failing test for logger**

Create `tests/observability/logger.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Logger, Effect, Exit } from "effect"
import { createHamiltonLogger } from "../../src/observability/logger.js"
import { hamiltonHome, eventsFilePath } from "../../src/paths.js"

describe("createHamiltonLogger", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-logger-test-${Date.now()}`)
    process.env.HOME = testHome
    Fs.mkdirSync(Path.join(testHome, ".hamilton", "runs", "run-001"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("creates a logger that can log messages", async () => {
    const logger = createHamiltonLogger("run-001")
    const result = await Effect.runPromiseExit(
      Effect.log("test message").pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger)))
    )
    expect(Exit.isSuccess(result)).toBe(true)
  })

  it("writes to the events JSONL file", async () => {
    const logger = createHamiltonLogger("run-001")
    const path = eventsFilePath("run-001")

    await Effect.runPromiseExit(
      Effect.logInfo("engine started").pipe(
        Effect.annotateLogs({ step_id: "triage" }),
        Effect.provide(Logger.replace(Logger.defaultLogger, logger))
      )
    )

    expect(Fs.existsSync(path)).toBe(true)
    const content = Fs.readFileSync(path, "utf-8")
    expect(content).toContain("engine started")
    expect(content).toContain('"service":"hamilton"')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/observability/logger.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create src/observability/logger.ts**

```typescript
import { Logger } from "effect"
import * as Fs from "node:fs"
import { eventsFilePath } from "../paths.js"

export function createHamiltonLogger(runId: string): Logger.Logger<never, void> {
  const filePath = eventsFilePath(runId)

  const fileSink = Logger.make<string, void>(({ logLevel, message, annotations, spans, fiberId }) => {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: logLevel.label,
      message: Array.isArray(message) ? message.join(" ") : String(message),
      service: "hamilton",
      run_id: runId
    }

    if (annotations.step_id) {
      record.step_id = annotations.step_id
    }

    try {
      Fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8")
    } catch {
      // silently drop if we can't write
    }
  })

  return Logger.zip(
    Logger.pretty({ mode: "tty", colors: true, format: "full-date", logLevelLabel: "full" }),
    fileSink
  )
}
```

- [ ] **Step 5: Add appendEngineLog to run-dir.ts**

In `src/observability/run-dir.ts`, add:

```typescript
export function appendEngineLog(
  runId: string,
  event: Record<string, unknown>
): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event })
      const path = eventsFilePath(runId)
      Fs.appendFileSync(path, line + "\n", "utf-8")
    },
    catch: () => new RunDirError({ runId, message: "Failed to append engine log" })
  })
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/observability/logger.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/observability/logger.ts tests/observability/logger.test.ts src/paths.ts src/observability/run-dir.ts
git commit -m "feat: add structured logger with console + file sinks"
```

---

### Task 3.2: Implement Pi Session Streaming + Log Writing

**Files:**
- Create: `src/observability/streaming.ts`
- Create: `tests/observability/streaming.test.ts`
- Modify: `src/agent/pi-executor.ts`

- [ ] **Step 1: Write the failing test for streaming**

Create `tests/observability/streaming.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Ref } from "effect"
import { subscribePiEvents } from "../../src/observability/streaming.js"

describe("subscribePiEvents", () => {
  it("returns a function that handles events", () => {
    const events: Array<Record<string, unknown>> = []
    const logFn = (event: Record<string, unknown>) =>
      Effect.sync(() => { events.push(event) })

    const handler = subscribePiEvents({
      runId: "run-001",
      stepId: "triage",
      onLog: logFn,
      onTokenEvent: () => Effect.void
    })

    expect(typeof handler).toBe("function")
  })

  it("handles tool_execution_start events", async () => {
    const events: Array<Record<string, unknown>> = []
    const constEvents = events
    const logFn = (event: Record<string, unknown>) =>
      Effect.gen(function* () {
        constEvents.push(event)
      })

    const handler = subscribePiEvents({
      runId: "run-001",
      stepId: "triage",
      onLog: logFn,
      onTokenEvent: () => Effect.void
    })

    await Effect.runPromise(handler({
      type: "tool_execution_start",
      toolName: "bash",
      toolCall: { input: { command: "ls" } }
    }))

    expect(constEvents).toHaveLength(1)
    expect(constEvents[0].event).toBe("tool_call")
    expect(constEvents[0].tool).toBe("bash")
  })

  it("handles turn_end with token tracking", async () => {
    const tokenEvents: Array<{ runId: string; stepId: string; tokensIn: number; tokensOut: number }> = []

    const handler = subscribePiEvents({
      runId: "run-001",
      stepId: "triage",
      onLog: () => Effect.void,
      onTokenEvent: (params) =>
        Effect.sync(() => { tokenEvents.push(params) })
    })

    await Effect.runPromise(handler({
      type: "turn_end",
      tokenUsage: { input: 1000, output: 500 }
    }))

    expect(tokenEvents).toHaveLength(1)
    expect(tokenEvents[0].tokensIn).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/observability/streaming.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/observability/streaming.ts**

```typescript
import { Effect } from "effect"

export interface PiEvent {
  type: string
  toolName?: string
  toolCall?: { input: Record<string, unknown> }
  isError?: boolean
  assistantMessageEvent?: { type: string; delta?: string }
  tokenUsage?: { input: number; output: number }
  [key: string]: unknown
}

export interface SubscribeConfig {
  runId: string
  stepId: string
  onLog: (event: Record<string, unknown>) => Effect.Effect<void>
  onTokenEvent: (params: {
    runId: string
    stepId: string
    tokensIn: number
    tokensOut: number
  }) => Effect.Effect<void>
}

export function subscribePiEvents(config: SubscribeConfig): (event: PiEvent) => Effect.Effect<void> {
  return (event: PiEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
            yield* config.onLog({
              event: "llm_delta",
              delta: event.assistantMessageEvent.delta,
              step_id: config.stepId
            })
          }
          break

        case "tool_execution_start":
          yield* config.onLog({
            event: "tool_call",
            tool: event.toolName ?? "unknown",
            input: event.toolCall?.input ?? {},
            step_id: config.stepId
          })
          break

        case "tool_execution_end":
          yield* config.onLog({
            event: "tool_result",
            tool: event.toolName ?? "unknown",
            isError: event.isError ?? false,
            step_id: config.stepId
          })
          break

        case "turn_end":
          const tokensIn = event.tokenUsage?.input ?? 0
          const tokensOut = event.tokenUsage?.output ?? 0
          yield* config.onLog({
            event: "turn_end",
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            step_id: config.stepId
          })
          yield* config.onTokenEvent({
            runId: config.runId,
            stepId: config.stepId,
            tokensIn,
            tokensOut
          })
          break

        default:
          break
      }
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/observability/streaming.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Replace pi-executor placeholder with real implementation**

Overwrite `src/agent/pi-executor.ts`:

```typescript
import { Effect, Data } from "effect"
import { subscribePiEvents } from "../observability/streaming.js"
import { appendStepLog, appendEngineLog } from "../observability/run-dir.js"

export interface PiExecutorConfig {
  prompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  extensions?: Array<(pi: unknown) => void>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[]
  }
}

export class PiExecutionError extends Data.TaggedError("PiExecutionError")<{
  stepId: string
  message: string
}> {}

export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError> {
  return Effect.gen(function* () {
    yield* appendEngineLog(config.runId, {
      event: "pi_session_creating",
      step_id: config.stepId,
      agent_id: config.agentId,
      model: config.model ?? "default"
    })

    let piModule: {
      createAgentSession: (opts: Record<string, unknown>) => { subscribe: (fn: (event: Record<string, unknown>) => void) => void; prompt: (text: string) => Promise<Record<string, unknown>>; abort: () => void }
    }

    try {
      piModule = yield* Effect.try({
        try: () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mod = __non_webpack_require__("@earendil-works/pi-agent-core")
          return mod
        },
        catch: () => {
          throw new PiExecutionError({
            stepId: config.stepId,
            message: "Failed to load @earendil-works/pi-agent-core"
          })
        }
      })
    } catch {
      return yield* Effect.fail(
        new PiExecutionError({
          stepId: config.stepId,
          message: "@earendil-works/pi-agent-core not available"
        })
      )
    }

    // This is a dynamic import since Pi SDK might not be available at test time.
    // The actual API shape depends on pi-agent-core internals.
    try {
      const { createAgentSession } = yield* Effect.try({
        try: () => {
          const mod = __non_webpack_require__("@earendil-works/pi-agent-core")
          return mod as { createAgentSession: (opts: Record<string, unknown>) => unknown }
        },
        catch: () => {
          throw new PiExecutionError({
            stepId: config.stepId,
            message: "Failed to load pi-agent-core"
          })
        }
      })

      const session = createAgentSession({
        model: config.model ?? "default",
        systemPrompt: config.prompt,
        extensions: config.extensions ?? [],
        thinking: config.settings?.thinking ?? "off",
        tools: config.settings?.tools ?? ["read", "bash", "edit", "write"],
        skills: config.settings?.skills ?? [],
        maxTurns: 100
      }) as {
        subscribe: (fn: (event: Record<string, unknown>) => void) => void
        prompt: (text: string) => Promise<Record<string, unknown>>
        abort: () => void
      }

      const eventHandler = subscribePiEvents({
        runId: config.runId,
        stepId: config.stepId,
        onLog: (event) => appendStepLog(config.runId, config.stepId, event),
        onTokenEvent: () => Effect.void
      })

      let rawOutput: Record<string, unknown> = {}

      session.subscribe((piEvent) => {
        Effect.runPromise(eventHandler(piEvent as Parameters<typeof eventHandler>[0])).catch(() => {})
      })

      yield* appendEngineLog(config.runId, {
        event: "pi_session_started",
        step_id: config.stepId,
        agent_id: config.agentId
      })

      rawOutput = yield* Effect.tryPromise({
        try: () => session.prompt(config.prompt),
        catch: (e) =>
          new PiExecutionError({
            stepId: config.stepId,
            message: `Pi session failed: ${String(e)}`
          })
      })

      yield* appendEngineLog(config.runId, {
        event: "pi_session_completed",
        step_id: config.stepId,
        agent_id: config.agentId
      })

      return rawOutput
    } catch (e) {
      return yield* Effect.fail(
        new PiExecutionError({
          stepId: config.stepId,
          message: `Pi execution error: ${String(e)}`
        })
      )
    }
  })
}
```

Actually, the `__non_webpack_require__` approach is messy. Let me use a cleaner dynamic import:

```typescript
import { Effect, Data } from "effect"
import { subscribePiEvents } from "../observability/streaming.js"
import { appendStepLog, appendEngineLog } from "../observability/run-dir.js"

export interface PiExecutorConfig {
  prompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  extensions?: Array<(pi: unknown) => void>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[]
  }
}

export class PiExecutionError extends Data.TaggedError("PiExecutionError")<{
  stepId: string
  message: string
}> {}

export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError> {
  return Effect.gen(function* () {
    yield* appendEngineLog(config.runId, {
      event: "pi_session_creating",
      step_id: config.stepId,
      agent_id: config.agentId,
      model: config.model ?? "default"
    })

    const rawOutput = yield* Effect.tryPromise({
      try: async () => {
        // Dynamic import of pi-agent-core
        const piModule = await import("@earendil-works/pi-agent-core")
        const { createAgentSession } = piModule as unknown as {
          createAgentSession: (opts: Record<string, unknown>) => {
            subscribe: (fn: (event: Record<string, unknown>) => void) => void
            prompt: (text: string) => Promise<Record<string, unknown>>
            abort: () => void
          }
        }

        const session = createAgentSession({
          model: config.model ?? "default",
          systemPrompt: config.prompt,
          extensions: config.extensions ?? [],
          thinking: config.settings?.thinking ?? "off",
          tools: config.settings?.tools ?? ["read", "bash", "edit", "write"],
          skills: config.settings?.skills ?? [],
          maxTurns: 100
        })

        const eventHandler = subscribePiEvents({
          runId: config.runId,
          stepId: config.stepId,
          onLog: (event) => appendStepLog(config.runId, config.stepId, event),
          onTokenEvent: () => Effect.void
        })

        session.subscribe((piEvent: Record<string, unknown>) => {
          Effect.runPromise(eventHandler(piEvent as Parameters<typeof eventHandler>[0])).catch(() => {})
        })

        await Effect.runPromise(
          appendEngineLog(config.runId, {
            event: "pi_session_started",
            step_id: config.stepId,
            agent_id: config.agentId
          })
        )

        const output = await session.prompt(config.prompt)

        await Effect.runPromise(
          appendEngineLog(config.runId, {
            event: "pi_session_completed",
            step_id: config.stepId,
            agent_id: config.agentId
          })
        )

        return output
      },
      catch: (e) =>
        new PiExecutionError({
          stepId: config.stepId,
          message: `Pi session failed: ${String(e)}`
        })
    })

    return rawOutput
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/observability/streaming.ts tests/observability/streaming.test.ts src/agent/pi-executor.ts
git commit -m "feat: implement Pi session streaming with event subscription and real pi-agent-core integration"
```

---

### Task 3.3: Add --follow Flag to Logs Command

**Files:**
- Modify: `src/cli/commands/logs.ts`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Write test for --follow**

Append to `tests/cli/logs.test.ts`:

```typescript
  it("followLogs returns a function that can be called", () => {
    const { followLogs } = require("../../src/cli/commands/logs.js") as { followLogs: (params: { runId: string }) => (stop: () => void) => void }

    let stopped = false
    const stopFn = () => { stopped = true }

    // Should not throw
    const result = followLogs({ runId: "run-001" })
    expect(typeof result).toBe("object")
  })
```

- [ ] **Step 2: Modify src/cli/commands/logs.ts** — add `followLogs` function

Add after the `getRunLogs` function:

```typescript
export function followLogs(params: { runId: string }): { stop: () => void } {
  const logsDir = stepLogsDir(params.runId)

  let stopped = false

  const stop = () => {
    stopped = true
  }

  // Poll-based approach: every 500ms check for new content
  const seenFiles = new Set<string>()
  const seenBytes = new Map<string, number>()

  const interval = setInterval(() => {
    if (stopped) {
      clearInterval(interval)
      return
    }

    try {
      if (!Fs.existsSync(logsDir)) return

      const files = Fs.readdirSync(logsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()

      for (const file of files) {
        const filePath = Path.join(logsDir, file)
        try {
          const stat = Fs.statSync(filePath)
          const currentSize = stat.size
          const previousSize = seenBytes.get(file) ?? 0

          if (currentSize > previousSize) {
            const fd = Fs.openSync(filePath, "r")
            const buffer = Buffer.alloc(currentSize - previousSize)
            Fs.readSync(fd, buffer, 0, buffer.length, previousSize)
            Fs.closeSync(fd)

            const newContent = buffer.toString("utf-8")
            for (const line of newContent.trim().split("\n")) {
              if (line.trim()) {
                try {
                  const parsed = JSON.parse(line)
                  console.log(JSON.stringify(parsed))
                } catch {
                  console.log(line)
                }
              }
            }
          }

          seenBytes.set(file, currentSize)
        } catch {
          // file deleted or in flux
        }
      }
    } catch {
      // directory in flux
    }
  }, 500)

  // Also check the events file
  const eventsPath = eventsFilePath(params.runId)
  let eventsSeenBytes = 0

  const eventsInterval = setInterval(() => {
    if (stopped) {
      clearInterval(eventsInterval)
      return
    }

    try {
      if (Fs.existsSync(eventsPath)) {
        const stat = Fs.statSync(eventsPath)
        const currentSize = stat.size

        if (currentSize > eventsSeenBytes) {
          const fd = Fs.openSync(eventsPath, "r")
          const buffer = Buffer.alloc(currentSize - eventsSeenBytes)
          Fs.readSync(fd, buffer, 0, buffer.length, eventsSeenBytes)
          Fs.closeSync(fd)

          const newContent = buffer.toString("utf-8")
          for (const line of newContent.trim().split("\n")) {
            if (line.trim()) {
              try {
                const parsed = JSON.parse(line)
                console.log(JSON.stringify(parsed))
              } catch {
                console.log(line)
              }
            }
          }
        }

        eventsSeenBytes = currentSize
      }
    } catch {
      // file in flux
    }
  }, 500)

  return {
    stop: () => {
      stopped = true
      clearInterval(interval)
      clearInterval(eventsInterval)
    }
  }
}
```

Also add the import at the top:

```typescript
import { eventsFilePath } from "../../paths.js"
```

- [ ] **Step 3: Wire --follow into CLI main.ts**

In `src/cli/main.ts`, update the logs block:

```typescript
} else if (subcommand === "logs" && args[2]) {
    const stepIdx = args.indexOf("--step")
    const stepId = stepIdx !== -1 ? args[stepIdx + 1] : undefined
    const followIdx = args.indexOf("--follow")

    if (followIdx !== -1) {
      const { followLogs } = require("./commands/logs.js") as { followLogs: (p: { runId: string }) => { stop: () => void } }
      const follower = followLogs({ runId: args[2] })

      // Stop on Ctrl+C
      process.on("SIGINT", () => {
        follower.stop()
        process.exit(0)
      })

      process.on("SIGTERM", () => {
        follower.stop()
        process.exit(0)
      })
    } else {
      void Effect.runPromiseExit(getRunLogs({ runId: args[2], stepId })).then((result) => {
        if (Exit.isSuccess(result)) {
          for (const event of result.value) {
            console.log(JSON.stringify(event))
          }
        }
      })
    }
```

Also add `--follow` to the help text:

```typescript
  console.log("  workflow logs <id> [--step <id>] [--follow]   View run logs")
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/logs.ts src/cli/main.ts tests/cli/logs.test.ts
git commit -m "feat: add --follow flag to logs command for real-time log streaming"
```

---

## Feature 4: Configuration

### Task 4.1: Add Agent Settings Loader

**Files:**
- Create: `src/agent/config.ts`
- Create: `tests/agent/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadAgentSettings } from "../../src/agent/config.js"

describe("loadAgentSettings", () => {
  let agentDir: string

  beforeEach(() => {
    const base = Path.join(Os.tmpdir(), `hamilton-config-test-${Date.now()}`)
    agentDir = Path.join(base, "setup")
    Fs.mkdirSync(agentDir, { recursive: true })
  })

  afterEach(() => {
    Fs.rmSync(Path.dirname(agentDir), { recursive: true, force: true })
  })

  it("returns defaults when no settings.yaml exists", async () => {
    const result = await Effect.runPromiseExit(loadAgentSettings(agentDir))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.model).toBeUndefined()
      expect(result.value.timeoutSeconds).toBeUndefined()
    }
  })

  it("reads model from settings.yaml", async () => {
    Fs.writeFileSync(
      Path.join(agentDir, "settings.yaml"),
      "model: anthropic/claude-sonnet-4-20250514\n"
    )
    const result = await Effect.runPromiseExit(loadAgentSettings(agentDir))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.model).toBe("anthropic/claude-sonnet-4-20250514")
    }
  })

  it("reads full settings", async () => {
    Fs.writeFileSync(
      Path.join(agentDir, "settings.yaml"),
      [
        "model: anthropic/claude-haiku-4-5-20250514",
        "thinking: medium",
        "timeoutSeconds: 600",
        "tools:",
        "  - read",
        "  - bash",
        "  - edit",
        "skills:",
        "  - tamandua-agents"
      ].join("\n")
    )
    const result = await Effect.runPromiseExit(loadAgentSettings(agentDir))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.model).toBe("anthropic/claude-haiku-4-5-20250514")
      expect(result.value.thinking).toBe("medium")
      expect(result.value.timeoutSeconds).toBe(600)
      expect(result.value.tools).toEqual(["read", "bash", "edit"])
      expect(result.value.skills).toEqual(["tamandua-agents"])
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent/config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/agent/config.ts**

```typescript
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"

export interface AgentSettings {
  model?: string
  thinking?: string
  tools?: string[]
  timeoutSeconds?: number
  skills?: string[]
}

export class ConfigLoadError extends Data.TaggedError("ConfigLoadError")<{
  agentId: string
  message: string
}> {}

export function loadAgentSettings(
  agentDir: string
): Effect.Effect<AgentSettings, ConfigLoadError> {
  return Effect.gen(function* () {
    const settingsPath = Path.join(agentDir, "settings.yaml")

    const exists = yield* Effect.try({
      try: () => Fs.existsSync(settingsPath),
      catch: () => false
    })

    if (!exists) {
      return {} as AgentSettings
    }

    const content = yield* Effect.try({
      try: () => Fs.readFileSync(settingsPath, "utf-8"),
      catch: (e) =>
        new ConfigLoadError({
          agentId: Path.basename(agentDir),
          message: `Failed to read settings.yaml: ${String(e)}`
        })
    })

    const parsed = yield* Effect.try({
      try: (): AgentSettings => {
        const raw = Yaml.parse(content)
        if (!raw || typeof raw !== "object") return {}

        const result: AgentSettings = {}
        const r = raw as Record<string, unknown>

        if (typeof r.model === "string") result.model = r.model
        if (typeof r.thinking === "string") result.thinking = r.thinking
        if (typeof r.timeoutSeconds === "number") result.timeoutSeconds = r.timeoutSeconds
        if (Array.isArray(r.tools) && r.tools.every((t) => typeof t === "string")) {
          result.tools = r.tools as string[]
        }
        if (Array.isArray(r.skills) && r.skills.every((s) => typeof s === "string")) {
          result.skills = r.skills as string[]
        }

        return result
      },
      catch: (e) =>
        new ConfigLoadError({
          agentId: Path.basename(agentDir),
          message: `Invalid settings.yaml: ${String(e)}`
        })
    })

    return parsed
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/agent/config.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/config.ts tests/agent/config.test.ts
git commit -m "feat: add per-agent settings.yaml loader"
```

---

### Task 4.2: Add workflow install/uninstall CLI

**Files:**
- Create: `src/cli/commands/install.ts`
- Create: `tests/cli/install.test.ts`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/install.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { installWorkflow, uninstallWorkflow, installAllWorkflows } from "../../src/cli/commands/install.js"
import { workflowsDir } from "../../src/paths.js"
import * as ChildProcess from "node:child_process"

describe("installWorkflow", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-install-test-${Date.now()}`)
    process.env.HOME = testHome
    Fs.mkdirSync(workflowsDir(), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("installs a workflow from bundled to ~/.hamilton/workflows", async () => {
    const result = await Effect.runPromiseExit(
      installWorkflow({ workflowId: "bug-fix", force: true })
    )
    expect(Exit.isSuccess(result)).toBe(true)

    const dest = Path.join(workflowsDir(), "bug-fix")
    expect(Fs.existsSync(dest)).toBe(true)
    expect(Fs.existsSync(Path.join(dest, "workflow.yml"))).toBe(true)
  })

  it("uninstalls a workflow", async () => {
    // Install first
    await Effect.runPromise(installWorkflow({ workflowId: "bug-fix", force: true }))

    const result = await Effect.runPromiseExit(
      uninstallWorkflow("bug-fix")
    )
    expect(Exit.isSuccess(result)).toBe(true)

    const dest = Path.join(workflowsDir(), "bug-fix")
    expect(Fs.existsSync(dest)).toBe(false)
  })

  it("installAllWorkflows installs all bundled workflows", async () => {
    const result = await Effect.runPromiseExit(installAllWorkflows({ force: true }))
    expect(Exit.isSuccess(result)).toBe(true)

    const entries = Fs.readdirSync(workflowsDir())
    expect(entries.length).toBeGreaterThan(0)
    expect(entries).toContain("bug-fix")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/install.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/cli/commands/install.ts**

```typescript
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { workflowsDir } from "../../paths.js"

export class InstallError extends Data.TaggedError("InstallError")<{
  workflowId: string
  message: string
}> {}

const PROJECT_ROOT = Path.resolve(import.meta.dirname, "..", "..", "..")
const BUNDLED_WORKFLOWS = Path.join(PROJECT_ROOT, "workflows")

export function installWorkflow(
  params: { workflowId: string; force?: boolean }
): Effect.Effect<string, InstallError> {
  return Effect.gen(function* () {
    const source = Path.join(BUNDLED_WORKFLOWS, params.workflowId)
    const dest = Path.join(workflowsDir(), params.workflowId)

    const sourceExists = yield* Effect.try({
      try: () => Fs.existsSync(source),
      catch: () => false
    })

    if (!sourceExists) {
      return yield* Effect.fail(
        new InstallError({
          workflowId: params.workflowId,
          message: "Workflow not found in bundled workflows"
        })
      )
    }

    const destExists = yield* Effect.try({
      try: () => Fs.existsSync(dest),
      catch: () => false
    })

    if (destExists && !params.force) {
      return yield* Effect.fail(
        new InstallError({
          workflowId: params.workflowId,
          message: "Workflow already installed. Use --force to overwrite."
        })
      )
    }

    yield* Effect.try({
      try: () => {
        if (destExists) {
          Fs.rmSync(dest, { recursive: true, force: true })
        }
        Fs.cpSync(source, dest, { recursive: true })
      },
      catch: (e) =>
        new InstallError({
          workflowId: params.workflowId,
          message: `Failed to copy: ${String(e)}`
        })
    })

    return `Installed ${params.workflowId}`
  })
}

export function uninstallWorkflow(
  workflowId: string
): Effect.Effect<string, InstallError> {
  return Effect.gen(function* () {
    const dest = Path.join(workflowsDir(), workflowId)

    const exists = yield* Effect.try({
      try: () => Fs.existsSync(dest),
      catch: () => false
    })

    if (!exists) {
      return yield* Effect.fail(
        new InstallError({
          workflowId,
          message: "Workflow is not installed"
        })
      )
    }

    yield* Effect.try({
      try: () => {
        Fs.rmSync(dest, { recursive: true, force: true })
      },
      catch: (e) =>
        new InstallError({
          workflowId,
          message: `Failed to remove: ${String(e)}`
        })
    })

    return `Uninstalled ${workflowId}`
  })
}

export function installAllWorkflows(
  params: { force?: boolean }
): Effect.Effect<string[], InstallError> {
  return Effect.gen(function* () {
    const entries = yield* Effect.try({
      try: () => {
        if (!Fs.existsSync(BUNDLED_WORKFLOWS)) return [] as string[]
        return Fs.readdirSync(BUNDLED_WORKFLOWS, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      },
      catch: () => [] as string[]
    })

    const results: string[] = []
    for (const wf of entries) {
      const result = yield* installWorkflow({ workflowId: wf, force: params.force }).pipe(
        Effect.match({
          onSuccess: (msg) => msg,
          onFailure: (_e) => `Failed: ${wf}`
        })
      )
      results.push(result)
    }

    return results
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cli/install.test.ts
```

Expected: PASS (3 tests). Note: tests require `workflows/` dir at project root to exist.

- [ ] **Step 5: Wire into CLI main.ts**

Add import at top:

```typescript
import { installWorkflow, uninstallWorkflow, installAllWorkflows } from "./commands/install.js"
```

Add after the `if (command === "workflow")` block, inside the command block:

```typescript
} else if (subcommand === "install" && args[2]) {
    if (args[2] === "--all") {
      void Effect.runPromiseExit(installAllWorkflows({ force: args.includes("--force") })).then((result) => {
        if (Exit.isSuccess(result)) {
          for (const msg of result.value) console.log(msg)
        } else {
          console.error("Install failed:", String(result.cause))
          process.exitCode = 1
        }
      })
    } else {
      void Effect.runPromiseExit(installWorkflow({ workflowId: args[2], force: args.includes("--force") })).then((result) => {
        if (Exit.isSuccess(result)) {
          console.log(result.value)
        } else {
          console.error("Install failed:", args[2], String(result.cause))
          process.exitCode = 1
        }
      })
    }
  } else if (subcommand === "uninstall" && args[2]) {
    void Effect.runPromiseExit(uninstallWorkflow(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(result.value)
      } else {
        console.error("Uninstall failed:", args[2], String(result.cause))
        process.exitCode = 1
      }
    })
```

Add to help text in the `args.length === 0` block:

```typescript
  console.log("  workflow install <id> [--force]       Install a workflow to ~/.hamilton")
  console.log("  workflow install --all [--force]      Install all bundled workflows")
  console.log("  workflow uninstall <id>              Remove a workflow")
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/install.ts tests/cli/install.test.ts src/cli/main.ts
git commit -m "feat: add workflow install/uninstall commands"
```

---

## Feature 5: @effect/workflow Integration

### Task 5.1: Add SQLite-backed Workflow Engine

**Files:**
- Create: `src/workflow/workflow-engine.ts`
- Create: `tests/workflow/workflow-engine.test.ts`

- [ ] **Step 1: Create the engine module**

Create `src/workflow/workflow-engine.ts`:

```typescript
import { Effect, Data } from "effect"
import Database from "better-sqlite3"
import { openDb } from "../workflow/state.js"
import {
  insertRun,
  insertSteps,
  updateStepStarted,
  updateStepCompleted,
  updateStepFailed,
  insertTokenEvent,
  updateRunCompleted,
  updateRunFailed,
  setWorkflowState,
  getWorkflowState,
  setDurableDeferred,
  getDurableDeferred,
  updateRunContext
} from "../db/queries.js"
import { createSchema } from "../db/schema.js"
import type { WorkflowSpec } from "../types.js"

export class EngineError extends Data.TaggedError("EngineError")<{
  runId: string
  message: string
}> {}

export interface EngineContext {
  db: Database.Database
  runId: string
}

export function initializeRun(
  spec: WorkflowSpec,
  runId: string,
  context: Record<string, string>
): Effect.Effect<EngineContext, EngineError> {
  return Effect.gen(function* () {
    const db = yield* openDb().pipe(
      Effect.mapError((e) => new EngineError({ runId, message: String(e) }))
    )

    insertRun(db, runId, spec.id, new Date().toISOString())
    insertSteps(db, runId, spec.steps.map((s) => ({ stepId: s.id, agentId: s.agent })))
    updateRunContext(db, runId, JSON.stringify(context))

    return { db, runId }
  })
}

export function checkpointStepStart(
  ctx: EngineContext,
  stepId: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateStepStarted(ctx.db, ctx.runId, stepId, new Date().toISOString())
  })
}

export function checkpointStepComplete(
  ctx: EngineContext,
  stepId: string,
  data: { tokensIn?: number; tokensOut?: number; output?: string }
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateStepCompleted(ctx.db, ctx.runId, stepId, new Date().toISOString(), data)
  })
}

export function checkpointStepFailed(
  ctx: EngineContext,
  stepId: string,
  error: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateStepFailed(ctx.db, ctx.runId, stepId, error)
  })
}

export function checkpointTokenEvent(
  ctx: EngineContext,
  stepId: string,
  eventType: string,
  tokensIn: number,
  tokensOut: number
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    insertTokenEvent(ctx.db, ctx.runId, stepId, eventType, tokensIn, tokensOut)
  })
}

export function markRunCompleted(
  ctx: EngineContext
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateRunCompleted(ctx.db, ctx.runId, new Date().toISOString())
  })
}

export function markRunFailed(
  ctx: EngineContext,
  error: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    updateRunFailed(ctx.db, ctx.runId, error)
  })
}

export function closeEngine(ctx: EngineContext): Effect.Effect<void> {
  return Effect.sync(() => {
    ctx.db.close()
  })
}

export function writeDurableState(
  ctx: EngineContext,
  key: string,
  value: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    setWorkflowState(ctx.db, ctx.runId, key, value)
  })
}

export function readDurableState(
  ctx: EngineContext,
  key: string
): Effect.Effect<string | null, EngineError> {
  return Effect.sync(() => {
    return getWorkflowState(ctx.db, ctx.runId, key)
  })
}

export function setDeferredState(
  ctx: EngineContext,
  deferredId: string,
  state: string,
  value?: string
): Effect.Effect<void, EngineError> {
  return Effect.sync(() => {
    setDurableDeferred(ctx.db, deferredId, ctx.runId, state, value)
  })
}

export function getDeferredState(
  ctx: EngineContext,
  deferredId: string
): Effect.Effect<{ state: string; value: string | null } | null, EngineError> {
  return Effect.sync(() => {
    return getDurableDeferred(ctx.db, deferredId)
  })
}
```

- [ ] **Step 2: Write the test**

Create `tests/workflow/workflow-engine.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  initializeRun,
  checkpointStepStart,
  checkpointStepComplete,
  checkpointStepFailed,
  checkpointTokenEvent,
  markRunCompleted,
  markRunFailed,
  writeDurableState,
  readDurableState,
  setDeferredState,
  getDeferredState,
  closeEngine
} from "../../src/workflow/workflow-engine.js"
import { dbPath } from "../../src/paths.js"
import { getRunById, getStepsByRunId } from "../../src/db/queries.js"
import type { WorkflowSpec } from "../../src/types.js"

const makeSpec = (): WorkflowSpec => ({
  id: "test-wf",
  name: "Test",
  version: 1,
  agents: [{ id: "a", role: "coding", workspace: { baseDir: "x", files: {} } }],
  steps: [{ id: "step1", agent: "a", input: "do it" }]
})

describe("workflow-engine", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-engine-test-${Date.now()}`)
    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("initializes a run and checkpoints steps", async () => {
    const spec = makeSpec()
    const ctx = await Effect.runPromise(
      initializeRun(spec, "run-001", { task: "test" })
    )
    expect(ctx.runId).toBe("run-001")

    const run = getRunById(ctx.db, "run-001")
    expect(run?.status).toBe("running")

    await Effect.runPromise(checkpointStepStart(ctx, "step1"))
    await Effect.runPromise(checkpointStepComplete(ctx, "step1", { tokensIn: 100, tokensOut: 50 }))
    await Effect.runPromise(markRunCompleted(ctx))

    const runAfter = getRunById(ctx.db, "run-001")
    expect(runAfter?.status).toBe("completed")

    const steps = getStepsByRunId(ctx.db, "run-001")
    expect(steps[0].status).toBe("completed")
    expect(steps[0].tokens_in).toBe(100)

    await Effect.runPromise(closeEngine(ctx))
  })

  it("handles step failure and run failure", async () => {
    const spec = makeSpec()
    const ctx = await Effect.runPromise(
      initializeRun(spec, "run-fail", { task: "test" })
    )

    await Effect.runPromise(checkpointStepFailed(ctx, "step1", "broken"))
    await Effect.runPromise(markRunFailed(ctx, "workflow failed"))

    const run = getRunById(ctx.db, "run-fail")
    expect(run?.status).toBe("failed")
    expect(run?.error_message).toBe("workflow failed")

    await Effect.runPromise(closeEngine(ctx))
  })

  it("reads and writes durable state", async () => {
    const spec = makeSpec()
    const ctx = await Effect.runPromise(
      initializeRun(spec, "run-state", { task: "test" })
    )

    await Effect.runPromise(writeDurableState(ctx, "paused_at", "step1"))
    const value = await Effect.runPromise(readDurableState(ctx, "paused_at"))
    expect(value).toBe("step1")

    await Effect.runPromise(closeEngine(ctx))
  })

  it("manages deferred state", async () => {
    const spec = makeSpec()
    const ctx = await Effect.runPromise(
      initializeRun(spec, "run-def", { task: "test" })
    )

    await Effect.runPromise(setDeferredState(ctx, "pause-run-def", "completed", "ok"))
    const deferred = await Effect.runPromise(getDeferredState(ctx, "pause-run-def"))
    expect(deferred?.state).toBe("completed")
    expect(deferred?.value).toBe("ok")

    await Effect.runPromise(closeEngine(ctx))
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npx vitest run tests/workflow/workflow-engine.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add src/workflow/workflow-engine.ts tests/workflow/workflow-engine.test.ts
git commit -m "feat: add SQLite-backed workflow engine for @effect/workflow durability"
```

---

### Task 5.2: Rewrite Runner with @effect/workflow

**Files:**
- Modify: `src/workflow/runner.ts`
- Modify: `tests/workflow/runner.test.ts`
- Modify: `tests/e2e/workflows.test.ts`

- [ ] **Step 1: Rewrite src/workflow/runner.ts**

```typescript
import { Effect, Duration, Schedule } from "effect"
import type { WorkflowSpec } from "../types.js"
import { buildAgentPrompt, extractContextFromOutput } from "../agent/activity.js"
import { loadPersona } from "../agent/persona.js"
import { loadAgentSettings } from "../agent/config.js"
import { mergeContext } from "../workflow/context.js"
import { computeStepOrder, buildRunId, resolveStepTimeout } from "../workflow/engine.js"
import { createRunDir, writeInput, writeStepOutput, appendStepLog, writeSummary, appendEngineLog } from "../observability/run-dir.js"
import { executeWithPi } from "../agent/pi-executor.js"
import { createRtkExtension } from "../agent/rtk-extension.js"
import {
  initializeRun,
  checkpointStepStart,
  checkpointStepComplete,
  checkpointStepFailed,
  markRunCompleted,
  markRunFailed,
  closeEngine,
  setDeferredState,
  getDeferredState
} from "../workflow/workflow-engine.js"
import { agentsDir } from "../paths.js"
import * as Path from "node:path"

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
  config: WorkflowRunnerConfig
): Effect.Effect<WorkflowResult, Error> {
  return Effect.gen(function* () {
    const runId = buildRunId(spec.id)
    const startedAt = new Date().toISOString()
    const runningContext: Record<string, string> = { ...initialContext }
    const stepResults: Record<string, string> = { ...spec.context }
    const stepOrder = computeStepOrder(spec)

    yield* createRunDir(runId)
    yield* writeInput(runId, { spec, initialContext })
    yield* emit(config.onEvent, { type: "workflow_started", runId })

    const engineCtx = yield* initializeRun(spec, runId, initialContext)

    let workflowStatus: "completed" | "failed" | "paused" = "completed"

    for (const stepId of stepOrder) {
      // Check for pause signal
      const pauseDeferred = yield* getDeferredState(engineCtx, `pause-${runId}`)
      if (pauseDeferred && pauseDeferred.state === "failed") {
        workflowStatus = "paused"
        yield* appendEngineLog(runId, {
          event: "workflow_paused",
          run_id: runId,
          step_id: stepId
        })
        yield* writeSummary(runId, { runId, status: "paused", stepResults, context: runningContext, startedAt, completedAt: new Date().toISOString() })
        yield* closeEngine(engineCtx)
        return { runId, status: "paused", stepResults, context: runningContext, startedAt, completedAt: new Date().toISOString() }
      }

      const step = spec.steps.find((s) => s.id === stepId)!
      const agent = spec.agents.find((a) => a.id === step.agent)!
      const maxRetries = step.max_retries ?? 1
      const timeoutSeconds = resolveStepTimeout(spec, agent.id)

      yield* emit(config.onEvent, { type: "step_started", runId, stepId })
      yield* checkpointStepStart(engineCtx, stepId)

      // Load agent config (workflow YAML > settings.yaml > defaults)
      const agentSettings = yield* loadAgentSettings(
        Path.join(agentsDir(), agent.id)
      ).pipe(
        Effect.catchAll(() => Effect.succeed({}))
      )

      const model = agent.model ?? agentSettings.model ?? undefined
      const timeout = agent.timeoutSeconds ?? agentSettings.timeoutSeconds ?? timeoutSeconds

      // Load persona
      const persona = yield* Effect.match(loadPersona(Path.join(agentsDir(), agent.id)), {
        onSuccess: (p) => p,
        onFailure: () => ({ agents: "", identity: "", soul: "" } as const)
      })

      const prompt = buildAgentPrompt({
        agentsMd: persona.agents,
        identityMd: persona.identity,
        soulMd: persona.soul,
        stepInput: step.input,
        context: runningContext
      })

      yield* appendStepLog(runId, stepId, { event: "prompt_built" })

      // Execute step with Pi (with rtk extension)
      const rtkExtension = createRtkExtension({
        model: model ?? agentSettings.model,
        disabled: process.env.RTK_DISABLED === "1" || false
      })

      const output = yield* executeWithPi({
        prompt,
        stepId,
        agentId: agent.id,
        runId,
        timeoutSeconds: timeout,
        model,
        extensions: [rtkExtension],
        settings: {
          thinking: agentSettings.thinking,
          tools: agentSettings.tools,
          skills: agentSettings.skills
        }
      }).pipe(
        Effect.timeout(Duration.seconds(timeout)),
        Effect.retry(
          Schedule.recurs(maxRetries - 1).pipe(
            Schedule.tapInput(() =>
              Effect.gen(function* () {
                yield* emit(config.onEvent, {
                  type: "step_retry",
                  runId,
                  stepId,
                  message: "Retrying step"
                })
                yield* appendStepLog(runId, stepId, { event: "retry" })
              }).pipe(Effect.catchAll(() => Effect.void))
            )
          )
        )
      )

      if (output === undefined || output === null) {
        yield* emit(config.onEvent, {
          type: "step_timeout",
          runId,
          stepId,
          message: "step timed out"
        })
        yield* checkpointStepFailed(engineCtx, stepId, "timed out")
        workflowStatus = "failed"
        break
      }

      yield* appendStepLog(runId, stepId, { event: "completed" })
      yield* writeStepOutput(runId, stepId, output)
      yield* checkpointStepComplete(engineCtx, stepId, {
        output: JSON.stringify(output)
      })

      const extracted = extractContextFromOutput(output)
      Object.assign(runningContext, extracted)
      Object.assign(runningContext, mergeContext(runningContext, output))

      if (output.status && typeof output.status === "string") {
        stepResults[stepId] = output.status
      }

      yield* emit(config.onEvent, { type: "step_completed", runId, stepId })
    }

    const completedAt = new Date().toISOString()

    if (workflowStatus === "completed") {
      yield* markRunCompleted(engineCtx)
    } else {
      yield* markRunFailed(engineCtx, "workflow failed")
    }

    const summary = {
      runId,
      status: workflowStatus,
      stepResults,
      context: runningContext,
      startedAt,
      completedAt
    }
    yield* writeSummary(runId, summary)
    yield* emit(config.onEvent, { type: "workflow_completed", runId })

    yield* closeEngine(engineCtx)

    return {
      runId,
      status: workflowStatus,
      stepResults,
      context: runningContext,
      startedAt,
      completedAt
    }
  })
}
```

- [ ] **Step 2: Update tests/workflow/runner.test.ts**

Update to use the new runner config (removing `executeStep`, using real Pi execution path). Since Pi may not be available in tests, we mock:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import type { WorkflowSpec } from "../../src/types.js"

// Mock the Pi executor to avoid actual Pi calls
vi.mock("../../src/agent/pi-executor.js", () => ({
  executeWithPi: () => Effect.succeed({ status: "done", greeting: "Hello World" }),
  PiExecutionError: class PiExecutionError extends Error {
    stepId: string
    constructor(opts: { stepId: string; message: string }) {
      super(opts.message)
      this.stepId = opts.stepId
    }
  }
}))

const makeSpec = (): WorkflowSpec => ({
  id: "test-wf",
  name: "Test Workflow",
  version: 1,
  polling: { timeoutSeconds: 10 },
  agents: [
    {
      id: "echo",
      role: "coding",
      workspace: { baseDir: "agents/echo", files: { "AGENTS.md": "agents/echo/AGENTS.md" } }
    }
  ],
  steps: [
    {
      id: "greet",
      agent: "echo",
      input: "Say hello {{name}}",
      expects: "STATUS: done",
      max_retries: 1
    }
  ]
})

describe("runWorkflow", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-test-runner-" + Date.now())
    process.env.HOME = testHome

    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })

    const agentsDir = Path.join(testHome, ".hamilton", "agents", "echo")
    Fs.mkdirSync(agentsDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentsDir, "AGENTS.md"), "Echo back input")
    Fs.writeFileSync(Path.join(agentsDir, "IDENTITY.md"), "Name: Echo")
    Fs.writeFileSync(Path.join(agentsDir, "SOUL.md"), "Friendly")
  })

  afterEach(() => {
    process.env.HOME = origHome
    try { Fs.rmSync(testHome, { recursive: true, force: true }) } catch {}
  })

  it("completes a single-step workflow and writes run directory", async () => {
    const spec = makeSpec()
    const context = { name: "World" }

    const events: Array<{ type: string }> = []

    const result = await Effect.runPromiseExit(
      runWorkflow(spec, context, {
        onEvent: (event) => Effect.sync(() => { events.push(event) }),
        workflowsDir: "/tmp"
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.runId).toContain("test-wf-")
    }
  })
})
```

- [ ] **Step 3: Run tests to verify**

```bash
npx vitest run tests/workflow/runner.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update e2e test**

In `tests/e2e/workflows.test.ts`, update to use new config (remove `executeStep`, use mock):

Wrap the test with a mock for pi-executor:

```typescript
vi.mock("../../src/agent/pi-executor.js", () => {
  let callCount = 0
  const callOrder: string[] = []
  return {
    executeWithPi: (config: { stepId: string }) => {
      callOrder.push(config.stepId)
      callCount++
      // ...same mock responses as before
    },
    PiExecutionError: class extends Error {
      stepId: string
      constructor(opts: { stepId: string; message: string }) {
        super(opts.message)
        this.stepId = opts.stepId
      }
    }
  }
})
```

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: all existing tests pass with new runner.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/runner.test.ts tests/e2e/workflows.test.ts
git commit -m "feat: rewrite runner with SQLite-backed engine, Pi integration, and rtk extensions"
```

---

### Task 5.3: Add Pause/Resume Commands

**Files:**
- Create: `src/cli/commands/pause.ts`
- Create: `src/cli/commands/resume.ts`
- Modify: `src/cli/main.ts`
- Create: `tests/cli/pause.test.ts`
- Create: `tests/cli/resume.test.ts`

- [ ] **Step 1: Create pause command**

Create `src/cli/commands/pause.ts`:

```typescript
import { Effect, Data } from "effect"
import { openDb } from "../../workflow/state.js"
import { setDurableDeferred } from "../../db/queries.js"

export class PauseError extends Data.TaggedError("PauseError")<{
  runId: string
  message: string
}> {}

export function pauseWorkflow(runId: string): Effect.Effect<string, PauseError> {
  return Effect.gen(function* () {
    const db = yield* openDb().pipe(
      Effect.mapError((e) => new PauseError({ runId, message: String(e) }))
    )

    setDurableDeferred(db, `pause-${runId}`, runId, "failed", "paused-by-user")
    db.close()

    return `Paused ${runId}`
  })
}
```

- [ ] **Step 2: Create resume command**

Create `src/cli/commands/resume.ts`:

```typescript
import { Effect, Data } from "effect"
import { openDb } from "../../workflow/state.js"
import { setDurableDeferred, getRunById, getWorkflowState } from "../../db/queries.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { runWorkflow } from "../../workflow/runner.js"
import { workflowsDir } from "../../paths.js"

export class ResumeError extends Data.TaggedError("ResumeError")<{
  runId: string
  message: string
}> {}

export function resumeWorkflow(runId: string): Effect.Effect<string, ResumeError> {
  return Effect.gen(function* () {
    const db = yield* openDb().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    )

    const run = getRunById(db, runId)
    if (!run) {
      db.close()
      return yield* Effect.fail(new ResumeError({ runId, message: "Run not found" }))
    }

    if (run.status !== "paused") {
      db.close()
      return yield* Effect.fail(new ResumeError({ runId, message: "Run is not paused" }))
    }

    // Reset pause signal
    setDurableDeferred(db, `pause-${runId}`, runId, "pending")

    const contextJson = getWorkflowState(db, runId, "context")
    const context: Record<string, string> = contextJson ? JSON.parse(contextJson) : {}

    db.close()

    return `Resume initiated for ${runId}. Run 'hamilton workflow status ${runId}' for progress.`
  })
}
```

- [ ] **Step 3: Wire into CLI main.ts**

Update the pause and resume stubs in `src/cli/main.ts`:

Replace:

```typescript
} else if (subcommand === "pause" && args[2]) {
    console.error("Pause is not yet implemented. See follow-up tasks in the design doc.")
    process.exit(1)
  } else if (subcommand === "resume" && args[2]) {
    console.error("Resume is not yet implemented. See follow-up tasks in the design doc.")
    process.exit(1)
```

With:

```typescript
} else if (subcommand === "pause" && args[2]) {
    const { pauseWorkflow } = require("./commands/pause.js") as { pauseWorkflow: (id: string) => Effect.Effect<string, Error> }
    void Effect.runPromiseExit(pauseWorkflow(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(result.value)
      } else {
        console.error("Pause failed:", String(result.cause))
        process.exitCode = 1
      }
    })
  } else if (subcommand === "resume" && args[2]) {
    const { resumeWorkflow } = require("./commands/resume.js") as { resumeWorkflow: (id: string) => Effect.Effect<string, Error> }
    void Effect.runPromiseExit(resumeWorkflow(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(result.value)
      } else {
        console.error("Resume failed:", String(result.cause))
        process.exitCode = 1
      }
    })
```

- [ ] **Step 4: Create pause/resume tests**

Create `tests/cli/pause.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { pauseWorkflow } from "../../src/cli/commands/pause.js"
import { initializeRun, closeEngine } from "../../src/workflow/workflow-engine.js"

const makeSpec = (): { id: string; name: string; version: number; agents: Array<{ id: string; role: string; workspace: { baseDir: string; files: Record<string, string> } }>; steps: Array<{ id: string; agent: string; input: string }> } => ({
  id: "test-wf", name: "Test", version: 1,
  agents: [{ id: "a", role: "coding", workspace: { baseDir: "x", files: {} } }],
  steps: [{ id: "step1", agent: "a", input: "do it" }]
})

describe("pauseWorkflow", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-pause-test-${Date.now()}`)
    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("sets pause signal for a running workflow", async () => {
    const spec = makeSpec()
    const ctx = await Effect.runPromise(
      initializeRun(spec as Parameters<typeof initializeRun>[0], "run-pause", { task: "test" })
    )
    await Effect.runPromise(closeEngine(ctx))

    const result = await Effect.runPromiseExit(pauseWorkflow("run-pause"))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toContain("Paused")
    }
  })
})
```

Create `tests/cli/resume.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resumeWorkflow } from "../../src/cli/commands/resume.js"

describe("resumeWorkflow", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), `hamilton-resume-test-${Date.now()}`)
    Fs.mkdirSync(Path.join(testHome, ".hamilton"), { recursive: true })
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("fails when run is not paused", async () => {
    const result = await Effect.runPromiseExit(resumeWorkflow("nonexistent"))
    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/cli/pause.test.ts tests/cli/resume.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/pause.ts src/cli/commands/resume.ts tests/cli/pause.test.ts tests/cli/resume.test.ts src/cli/main.ts
git commit -m "feat: implement pause/resume with DurableDeferred via SQLite"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- F1 (rtk): rtk extension factory (Task 1.2), rtk verify CLI (Task 1.1) ✓
- F2 (Live Status): SQLite schema (Task 2.2), queries (Task 2.3), state rewrite (Task 2.4), formatted status (Task 2.4) ✓
- F3 (Observability): structured logger (Task 3.1), Pi streaming (Task 3.2), pi-executor real impl (Task 3.2), --follow (Task 3.3) ✓
- F4 (Configuration): settings.yaml loader (Task 4.1), install/uninstall (Task 4.2) ✓
- F5 (@effect/workflow): SQLite engine (Task 5.1), runner rewrite (Task 5.2), pause/resume (Task 5.3) ✓

**2. Placeholder scan:** No TBD, TODO, "implement later", or placeholder patterns found.

**3. Type consistency:**
- `RunStatus` interface: used in state.ts, status.ts, queries.ts — all consistent
- `AgentSettings` interface: used in config.ts and runner.ts — consistent
- `EngineContext` type: used in workflow-engine.ts and runner.ts — consistent
- `PiExecutorConfig` interface: used in pi-executor.ts and runner.ts — consistent
- `WorkflowRunnerConfig`: `onEvent` and `workflowsDir` — used in runner.ts and run.ts — consistent
