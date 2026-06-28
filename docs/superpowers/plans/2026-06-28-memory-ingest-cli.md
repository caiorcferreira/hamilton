# Memory Ingest CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `hamilton memory ingest --guidelines` CLI command that triggers guideline ingestion outside of workflow runs, extracting shared logic from `run.ts`/`resume.ts`.

**Architecture:** Add `ingestGuidelines()` async function to `src/memory/guidelines.ts` that orchestrates existing steps (detectChanges, tombstoneStale, writeToQmd, registerIngestedEvent) and returns an `IngestSummary`. Create `memory` parent command + `ingest` subcommand in new `src/cli/commands/memory.ts` and `src/cli/commands/memory-ingest.ts`. Refactor `run.ts`/`resume.ts` to call the shared function instead of duplicated inline loops.

**Tech Stack:** TypeScript, `@effect/cli`, Effect-TS, `bun:sqlite`, `@tobilu/qmd`, vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/memory/guidelines.ts` | Modify | Add `ingestGuidelines()` orchestrator + `IngestSummary` type |
| `src/cli/commands/memory.ts` | Create | Parent `memory` command |
| `src/cli/commands/memory-ingest.ts` | Create | `ingest` subcommand + `executeMemoryIngest()` Effect + `formatSummary()` |
| `src/cli/commands/run.ts` | Modify | Replace inline ingestion loop with `ingestGuidelines()` call |
| `src/cli/commands/resume.ts` | Modify | Same refactor as `run.ts` |
| `src/cli/main.ts` | Modify | Register `memoryCommand` as root subcommand |
| `tests/memory/guidelines.test.ts` | Modify | Add tests for `ingestGuidelines()` |
| `tests/cli/memory-ingest.test.ts` | Create | Tests for `executeMemoryIngest()` |

---

### Task 1: Add `ingestGuidelines()` to `src/memory/guidelines.ts`

**Files:**
- Modify: `src/memory/guidelines.ts`
- Modify: `tests/memory/guidelines.test.ts`

- [ ] **Step 1: Write the failing test for `ingestGuidelines()`**

Append to `tests/memory/guidelines.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { migrate } from "../../src/db/migrations.js"
import { createUserMemoryStore } from "../../src/memory/store.js"
import { ingestGuidelines, type IngestSummary } from "../../src/memory/guidelines.js"
import type { MemoryWriter } from "../../src/memory/store.js"
import type { LoadedGuideline } from "../../src/guidelines/types.js"

function makeGuideline(name: string, content: string): LoadedGuideline {
  return { name, instructions: [{ name: `${name}/file.md`, content }], rules: null }
}

describe("ingestGuidelines", () => {
  let tmpHome: string
  let db: Database
  let writer: MemoryWriter
  let close: () => Promise<void>
  const originalHome = process.env.HOME

  beforeEach(async () => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-ingest-"))
    process.env.HOME = tmpHome
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "memory", "user", "canonical"), { recursive: true })
    db = new Database(Path.join(tmpHome, ".hamilton", "hamilton.db"))
    migrate(db)
    const store = await createUserMemoryStore(tmpHome)
    writer = store.writer
    close = store.close
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    db.close()
    await close()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("ingests new guidelines and returns summary", async () => {
    const guidelines = [
      makeGuideline("guide-a", "Content A"),
      makeGuideline("guide-b", "Content B"),
    ]

    const summary = await ingestGuidelines(writer, db, guidelines)

    expect(summary.processed).toBe(2)
    expect(summary.ingested).toBe(2)
    expect(summary.skipped).toBe(0)
    expect(summary.tombstoned).toBe(0)
    expect(summary.atoms).toHaveLength(2)
    expect(summary.atoms[0].action).toBe("created")
    expect(summary.atoms[0].guidelineName).toBe("guide-a")
    expect(summary.atoms[1].action).toBe("created")
    expect(summary.atoms[1].guidelineName).toBe("guide-b")

    const atoms = db.prepare("SELECT * FROM memory_atoms WHERE status = 'active'").all() as any[]
    expect(atoms).toHaveLength(2)

    const events = db.prepare("SELECT * FROM memory_event_log WHERE event_type = 'ingested'").all() as any[]
    expect(events).toHaveLength(2)
  })

  it("skips unchanged guidelines", async () => {
    const guidelines = [makeGuideline("guide-a", "Content A")]
    await ingestGuidelines(writer, db, guidelines)

    const summary = await ingestGuidelines(writer, db, guidelines)
    expect(summary.processed).toBe(1)
    expect(summary.ingested).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(summary.tombstoned).toBe(0)
    expect(summary.atoms).toHaveLength(1)
    expect(summary.atoms[0].action).toBe("skipped")
  })

  it("tombstones stale atoms when content changes", async () => {
    const v1 = [makeGuideline("guide-a", "Version 1")]
    const v2 = [makeGuideline("guide-a", "Version 2")]

    const first = await ingestGuidelines(writer, db, v1)
    expect(first.ingested).toBe(1)

    const second = await ingestGuidelines(writer, db, v2)
    expect(second.ingested).toBe(1)
    expect(second.tombstoned).toBe(1)
    expect(second.skipped).toBe(0)

    const activeAtoms = db.prepare("SELECT * FROM memory_atoms WHERE status = 'active'").all() as any[]
    expect(activeAtoms).toHaveLength(1)
    expect(activeAtoms[0].id).not.toBe(first.atoms[0].id)

    const tombstonedAtoms = db.prepare("SELECT * FROM memory_atoms WHERE status = 'tombstoned'").all() as any[]
    expect(tombstonedAtoms).toHaveLength(1)
    expect(tombstonedAtoms[0].id).toBe(first.atoms[0].id)
  })

  it("skips guidelines with no instruction content", async () => {
    const guidelines: LoadedGuideline[] = [
      { name: "rules-only", instructions: null, rules: null },
      makeGuideline("guide-a", "Content A"),
    ]

    const summary = await ingestGuidelines(writer, db, guidelines)
    expect(summary.processed).toBe(1)
    expect(summary.ingested).toBe(1)
    expect(summary.atoms[0].guidelineName).toBe("guide-a")
  })

  it("handles empty guidelines array", async () => {
    const summary = await ingestGuidelines(writer, db, [])
    expect(summary.processed).toBe(0)
    expect(summary.ingested).toBe(0)
    expect(summary.skipped).toBe(0)
    expect(summary.tombstoned).toBe(0)
    expect(summary.atoms).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/memory/guidelines.test.ts -t "ingestGuidelines"`
Expected: FAIL with `ingestGuidelines is not exported`

- [ ] **Step 3: Implement `ingestGuidelines()` in `src/memory/guidelines.ts`**

Add the interface and function at the end of the file, after `registerIngestedEvent`:

```typescript
export interface IngestSummary {
  processed: number
  ingested: number
  skipped: number
  tombstoned: number
  atoms: Array<{ id: string; guidelineName: string; action: "created" | "skipped" }>
}

export async function ingestGuidelines(
  writer: MemoryWriter,
  db: Database,
  guidelines: LoadedGuideline[]
): Promise<IngestSummary> {
  const filtered = guidelines.filter((g) => g.instructions !== null && g.instructions.length > 0)
  const atoms: IngestSummary["atoms"] = []
  let ingested = 0
  let skipped = 0
  let tombstoned = 0

  for (const guideline of filtered) {
    const sourcePath = `/guidelines/${guideline.name}.md`
    const change = detectChanges(guideline, db, sourcePath)

    if (!change.changed) {
      skipped++
      atoms.push({ id: "", guidelineName: guideline.name, action: "skipped" })
      continue
    }

    if (getLastIngestedHash(db, sourcePath)) {
      await tombstoneStale(writer, db, sourcePath)
      tombstoned++
    }

    const result = await writeToQmd(writer, guideline, db, "guideline", sourcePath)
    registerIngestedEvent(db, sourcePath, change.hash, 1)
    ingested++
    atoms.push({ id: result.id, guidelineName: guideline.name, action: "created" })
  }

  return {
    processed: filtered.length,
    ingested,
    skipped,
    tombstoned,
    atoms,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/memory/guidelines.test.ts`
Expected: All tests pass (existing + new)

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `bun --bun vitest run`
Expected: 631 tests pass (or more with new tests)

- [ ] **Step 6: Commit**

```bash
git add src/memory/guidelines.ts tests/memory/guidelines.test.ts
git commit -m "feat: add ingestGuidelines() orchestrator for guideline ingestion"
```

---

### Task 2: Create CLI command files + tests

**Files:**
- Create: `src/cli/commands/memory.ts`
- Create: `src/cli/commands/memory-ingest.ts`
- Create: `tests/cli/memory-ingest.test.ts`

- [ ] **Step 1: Write the test for `executeMemoryIngest()`**

Create `tests/cli/memory-ingest.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { executeMemoryIngest } from "../../src/cli/commands/memory-ingest.js"

function createGuideline(tmpHome: string, name: string, instructionContent: string): void {
  const dir = Path.join(tmpHome, ".hamilton", "guidelines", name)
  Fs.mkdirSync(dir, { recursive: true })
  const ymlContent = `apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Guideline
metadata:
  name: ${name}
spec:
  instructions:
    - matching: ["*.md"]
      files:
        - INSTRUCTIONS.md
`
  Fs.writeFileSync(Path.join(dir, "guideline.yml"), ymlContent)
  Fs.writeFileSync(Path.join(dir, "INSTRUCTIONS.md"), instructionContent)
}

function createProjectFile(tmpHome: string, path: string, content: string): void {
  const fullPath = Path.join(tmpHome, "project", path)
  Fs.mkdirSync(Path.dirname(fullPath), { recursive: true })
  Fs.writeFileSync(fullPath, content)
}

describe("executeMemoryIngest", () => {
  let tmpHome: string
  const originalHome = process.env.HOME
  const originalCwd = process.cwd

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-mem-ingest-"))
    process.env.HOME = tmpHome
    const projectDir = Path.join(tmpHome, "project")
    Fs.mkdirSync(projectDir, { recursive: true })

    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "guidelines"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "memory", "user", "canonical"), { recursive: true })
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "executors", "pi", "agent"), { recursive: true })
    Fs.writeFileSync(Path.join(tmpHome, ".hamilton", "executors", "pi", "agent", "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("ingests guidelines and returns summary output", async () => {
    createGuideline(tmpHome, "my-guideline", "Use 2-space indentation.")
    createProjectFile(tmpHome, "README.md", "# Project")

    const result = await Effect.runPromiseExit(
      executeMemoryIngest(Path.join(tmpHome, "project"))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toContain("Guideline ingestion complete")
      expect(result.value).toContain("Processed: 1")
      expect(result.value).toContain("Ingested:  1")
      expect(result.value).toContain("my-guideline")
    }
  })

  it("returns message when no guidelines match", async () => {
    const result = await Effect.runPromiseExit(
      executeMemoryIngest(Path.join(tmpHome, "project"))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toContain("No matching guideline files found")
    }
  })

  it("skips unchanged guidelines on second run", async () => {
    createGuideline(tmpHome, "my-guideline", "Use 2-space indentation.")
    createProjectFile(tmpHome, "README.md", "# Project")

    await Effect.runPromiseExit(executeMemoryIngest(Path.join(tmpHome, "project")))
    const result = await Effect.runPromiseExit(
      executeMemoryIngest(Path.join(tmpHome, "project"))
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toContain("Skipped:   1")
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/cli/memory-ingest.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Create `src/cli/commands/memory.ts`**

```typescript
import { Command } from "@effect/cli"
import { Console } from "effect"
import { ingestCommand } from "./memory-ingest.js"

export const memoryCommand = Command.make("memory", {}, () =>
  Console.log("Use a subcommand: ingest\n\nUse --help for details")
).pipe(
  Command.withSubcommands([ingestCommand])
)
```

- [ ] **Step 4: Create `src/cli/commands/memory-ingest.ts`**

```typescript
import { Command, Options } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import { loadGuidelines } from "../../guidelines/loader.js"
import { guidelinesDir, hamiltonHome, dbPath } from "../../paths.js"
import { createUserMemoryStore } from "../../memory/store.js"
import { ingestGuidelines, type IngestSummary } from "../../memory/guidelines.js"
import { migrate } from "../../db/migrations.js"
import type { LoadedGuideline } from "../../guidelines/types.js"

export function formatSummary(summary: IngestSummary): string {
  const lines = [
    "Guideline ingestion complete",
    "\u2500".repeat(28),
    `  Processed: ${summary.processed}`,
    `  Ingested:  ${summary.ingested}  (atoms created)`,
    `  Skipped:   ${summary.skipped}  (unchanged)`,
    `  Tombstoned: ${summary.tombstoned} (stale atoms replaced)`,
    "",
  ]

  if (summary.atoms.length > 0) {
    const created = summary.atoms.filter((a) => a.action === "created")
    const skipped = summary.atoms.filter((a) => a.action === "skipped")

    if (created.length > 0) {
      lines.push("New atoms:")
      for (const atom of created) {
        lines.push(`  ${atom.guidelineName} \u2192 ${atom.id} (canonical)`)
      }
      lines.push("")
    }

    if (skipped.length > 0) {
      lines.push("Skipped:")
      for (const atom of skipped) {
        lines.push(`  ${atom.guidelineName}: unchanged since last ingestion`)
      }
    }
  }

  return lines.join("\n")
}

export function executeMemoryIngest(projectDir: string): Effect.Effect<string, Error> {
  return Effect.gen(function* (_) {
    const loaded = yield* _(loadGuidelines(guidelinesDir(), projectDir))
    const guidelinesWithInstructions = loaded.filter(
      (g: LoadedGuideline) => g.instructions !== null
    )

    if (guidelinesWithInstructions.length === 0) {
      return "No matching guideline files found."
    }

    const store = yield* _(
      Effect.tryPromise(() => createUserMemoryStore(hamiltonHome()))
    )
    yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))

    const db = new Database(dbPath())
    migrate(db)

    const summary = yield* _(
      Effect.tryPromise(() =>
        ingestGuidelines(store.writer, db, guidelinesWithInstructions)
      )
    )
    db.close()

    return formatSummary(summary)
  })
}

const guidelinesFlag = Options.boolean("guidelines")

export const ingestCommand = Command.make(
  "ingest",
  { guidelines: guidelinesFlag },
  ({ guidelines }) =>
    Effect.gen(function* (_) {
      if (!guidelines) {
        yield* _(Console.error("No ingest mode specified. Use --guidelines."))
        return
      }

      const result = yield* _(Effect.exit(executeMemoryIngest(process.cwd())))
      if (Exit.isFailure(result)) {
        yield* _(Console.error(`Ingestion failed: ${String(result.cause)}`))
        return
      }
      yield* _(Console.log(result.value))
    })
).pipe(
  Command.withDescription("Ingest content into the memory store")
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --bun vitest run tests/cli/memory-ingest.test.ts`
Expected: All 3 tests pass

- [ ] **Step 6: Run TypeScript build to verify types**

Run: `bun run build`
Expected: Compiles without errors

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/memory.ts src/cli/commands/memory-ingest.ts tests/cli/memory-ingest.test.ts
git commit -m "feat: add memory ingest --guidelines CLI command"
```

---

### Task 3: Refactor `run.ts` to use `ingestGuidelines()`

**Files:**
- Modify: `src/cli/commands/run.ts`

- [ ] **Step 1: Replace the inline ingestion loop**

Read `src/cli/commands/run.ts`. Find the block (approximately lines 91-117):

```typescript
    let memoryReader: MemoryReader | null = null

    const store = yield* _(Effect.tryPromise(() => createUserMemoryStore(hamiltonHome())).pipe(
      Effect.orElseSucceed(() => null)
    ))
    if (store) {
      memoryReader = store.reader
      yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))
      const ingestDb = new Database(dbPath())
      migrate(ingestDb)
      yield* _(Effect.promise(async () => {
        for (const guideline of loadedGuidelines) {
          const sourcePath = `/guidelines/${guideline.name}.md`
          const change = detectChanges(guideline, ingestDb, sourcePath)
          if (change.changed) {
            if (getLastIngestedHash(ingestDb, sourcePath)) {
              await tombstoneStale(store.writer, ingestDb, sourcePath)
            }
            await writeToQmd(store.writer, guideline, ingestDb, "guideline", sourcePath)
            registerIngestedEvent(ingestDb, sourcePath, change.hash, 1)
          }
        }
      }).pipe(
        Effect.orElseSucceed(() => undefined)
      ))
      ingestDb.close()
    }
```

Replace with:

```typescript
    let memoryReader: MemoryReader | null = null

    const store = yield* _(Effect.tryPromise(() => createUserMemoryStore(hamiltonHome())).pipe(
      Effect.orElseSucceed(() => null)
    ))
    if (store) {
      memoryReader = store.reader
      yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))
      const ingestDb = new Database(dbPath())
      migrate(ingestDb)
      yield* _(Effect.promise(async () => {
        await ingestGuidelines(store.writer, ingestDb, loadedGuidelines)
      }).pipe(Effect.orElseSucceed(() => undefined)))
      ingestDb.close()
    }
```

- [ ] **Step 2: Update imports**

Replace the old guidelines imports (lines 23-28 approximately):

```typescript
import { createUserMemoryStore, type MemoryReader } from "../../memory/store.js"
import { detectChanges, tombstoneStale, writeToQmd, registerIngestedEvent, getLastIngestedHash } from "../../memory/guidelines.js"
```

Replace with:

```typescript
import { createUserMemoryStore, type MemoryReader } from "../../memory/store.js"
import { ingestGuidelines } from "../../memory/guidelines.js"
```

- [ ] **Step 3: Run TypeScript build to verify**

Run: `bun run build`
Expected: Compiles without errors

- [ ] **Step 4: Run existing run.test.ts to verify no regressions**

Run: `bun --bun vitest run tests/cli/run.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/run.ts
git commit -m "refactor: use ingestGuidelines() in run.ts"
```

---

### Task 4: Refactor `resume.ts` to use `ingestGuidelines()`

**Files:**
- Modify: `src/cli/commands/resume.ts`

- [ ] **Step 1: Find and replace the inline ingestion loop**

Read `src/cli/commands/resume.ts`. The pattern is identical to `run.ts`. Find the block that creates the store and does the inline for-loop over guidelines. Replace the inline for-loop with:

```typescript
      yield* _(Effect.promise(async () => {
        await ingestGuidelines(store.writer, ingestDb, loadedGuidelines)
      }).pipe(Effect.orElseSucceed(() => undefined)))
```

- [ ] **Step 2: Update imports**

Replace the old guidelines imports with:

```typescript
import { ingestGuidelines } from "../../memory/guidelines.js"
```

Remove the unused imports: `detectChanges`, `tombstoneStale`, `writeToQmd`, `registerIngestedEvent`, `getLastIngestedHash`.

- [ ] **Step 3: Run TypeScript build to verify**

Run: `bun run build`
Expected: Compiles without errors

- [ ] **Step 4: Run resume.test.ts to verify no regressions**

Run: `bun --bun vitest run tests/cli/resume.test.ts`
Expected: Pass

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/resume.ts
git commit -m "refactor: use ingestGuidelines() in resume.ts"
```

---

### Task 5: Register `memory` command in `src/cli/main.ts`

**Files:**
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Add import for `memoryCommand`**

Add the import near other command imports (after the `telemetryCommand` import, around line 10):

```typescript
import { memoryCommand } from "./commands/memory.js"
```

- [ ] **Step 2: Add `memoryCommand` to root subcommands**

Find the `Command.withSubcommands([...])` call on the root command. Add `memoryCommand` to the array:

```typescript
Command.withSubcommands([setupCommand, doctorCommand, workflowCommand, mcpCommand, telemetryCommand, memoryCommand])
```

- [ ] **Step 3: Run TypeScript build**

Run: `bun run build`
Expected: Compiles without errors

- [ ] **Step 4: Install CLI locally and verify help output**

```bash
bun run install-local
hamilton memory --help
```

Expected: Shows help text with `ingest` subcommand

```bash
hamilton memory ingest --help
```

Expected: Shows `--guidelines` flag

- [ ] **Step 5: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: register memory command in CLI"
```

---

### Task 6: Run full test suite and final verification

- [ ] **Step 1: Run all tests**

```bash
bun --bun vitest run
```

Expected: All tests pass. No regressions.

- [ ] **Step 2: Run TypeScript build one final time**

```bash
bun run build
```

Expected: Compiles without errors.
