# Setup Guideline Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest all guidelines into the qmd memory store during `hamilton setup`, between result printing and doctor checks.

**Architecture:** New exported function `ingestSetupGuidelines()` in `src/cli/commands/setup.ts` that creates a memory store, loads all guidelines unfiltered, ingests them, and handles all errors gracefully (logging warnings, never failing). Called once in the `setupCommand` handler after `setupHamilton()` returns but before doctor checks.

**Tech Stack:** Effect-TS (Effect.gen, Effect.scoped, Effect.orElseSucceed), bun:sqlite (Database), @tobilu/qmd (memory store), existing loadAllGuidelines and ingestGuidelines functions.

---

### Task 1: `ingestSetupGuidelines` — function + tests

**Files:**
- Create: (none)
- Modify: `src/cli/commands/setup.ts` (add function + imports)
- Test: `tests/cli/setup.test.ts` (add describe block)

- [ ] **Step 1: Write the failing tests**

Add at the end of `tests/cli/setup.test.ts` (after the `buildSettingsYaml` describe block), before the final closing:

```typescript
import { ingestSetupGuidelines } from "../../src/cli/commands/setup.js"

describe("ingestSetupGuidelines", () => {
  let tmpHome: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-ingest-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("ingests guidelines into qmd.db after setupHamilton", async () => {
    await Effect.runPromiseExit(setupHamilton())

    const exit = await Effect.runPromiseExit(ingestSetupGuidelines())
    expect(Exit.isSuccess(exit)).toBe(true)

    const qmdDbPath = Path.join(tmpHome, ".hamilton", "memory", "user", "qmd.db")
    expect(Fs.existsSync(qmdDbPath)).toBe(true)

    const canonicalDir = Path.join(tmpHome, ".hamilton", "memory", "user", "canonical")
    const files = Fs.readdirSync(canonicalDir)
    expect(files.length).toBeGreaterThan(0)
  })

  it("succeeds gracefully when guidelines directory is empty", async () => {
    const exit = await Effect.runPromiseExit(ingestSetupGuidelines())
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --bun vitest run tests/cli/setup.test.ts
```
Expected: FAIL — `ingestSetupGuidelines` is not exported

- [ ] **Step 3: Add imports to `src/cli/commands/setup.ts`**

Add these imports at the top of the file (after the existing imports, line 12):

```typescript
import { Database } from "bun:sqlite"
import { dbPath } from "../../paths.js"
import { createUserMemoryStore } from "../../memory/store.js"
import { ingestGuidelines, type IngestSummary } from "../../memory/guidelines.js"
import { loadAllGuidelines } from "../../guidelines/loader.js"
import { migrate } from "../../db/migrations.js"
```

The `dbPath` import should be added to the existing `../../paths.js` import on line 7.

- [ ] **Step 4: Update the existing paths import on line 7**

Replace:
```typescript
import { ensureHamiltonHome, agentsDir, settingsPath, skillsDir, guidelinesDir, hooksDir } from "../../paths.js"
```
With:
```typescript
import { ensureHamiltonHome, agentsDir, settingsPath, skillsDir, guidelinesDir, hooksDir, hamiltonHome, dbPath } from "../../paths.js"
```

- [ ] **Step 5: Implement `ingestSetupGuidelines`**

Add the function after the `setupHamilton` function (after line 265), before the `force`/`copyPiConfigs`/`modelAlias` option definitions (line 267):

```typescript
export function ingestSetupGuidelines(): Effect.Effect<void, never, never> {
  return Effect.scoped(Effect.gen(function* (_) {
    const store = yield* _(
      Effect.tryPromise(() => createUserMemoryStore(hamiltonHome())).pipe(
        Effect.orElseSucceed(() => null)
      )
    )
    if (!store) {
      yield* _(Console.log("Skipping guideline ingestion \u2014 memory store unavailable. Ingestion will run on first workflow execution."))
      return
    }
    yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))

    const loadedGuidelines = yield* _(loadAllGuidelines(guidelinesDir()))

    const db = new Database(dbPath())
    migrate(db)
    yield* _(Effect.addFinalizer(() => Effect.sync(() => db.close())))

    const summary = yield* _(
      Effect.promise(async () => {
        return ingestGuidelines(store.writer, db, loadedGuidelines)
      }).pipe(
        Effect.orElseSucceed(() => undefined)
      )
    )

    if (summary) {
      yield* _(Console.log(`Guideline memory primed: ${(summary as IngestSummary).ingested} ingested, ${(summary as IngestSummary).skipped} unchanged`))
    } else {
      yield* _(Console.log("Guideline ingestion failed \u2014 will retry on next workflow run."))
    }
  }))
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun --bun vitest run tests/cli/setup.test.ts
```
Expected: all tests pass, including the two new `ingestSetupGuidelines` tests

- [ ] **Step 7: Run the build to verify types**

```bash
bun run build
```
Expected: no type errors

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/setup.ts tests/cli/setup.test.ts
git commit -m "feat: add ingestSetupGuidelines to prime memory store during setup"
```

---

### Task 2: Wire into the setup command handler

**Files:**
- Modify: `src/cli/commands/setup.ts:284-297`

- [ ] **Step 1: Insert the call between result printing and doctor checks**

In the `setupCommand` handler (line 289 is the last line of result printing, line 291 starts doctor), insert the ingestion call after line 289:

```typescript
    yield* Console.log("Hamilton set up successfully.")
    yield* Console.log(`Installed ${installed.length} workflows.`)
    for (const id of installed) {
      yield* Console.log(`  ${id}`)
    }

    yield* Console.log("")
    yield* Console.log("Priming guideline memory...")
    yield* ingestSetupGuidelines()

    yield* Console.log("")
    yield* Console.log("Running prerequisite checks...")
    const checkResults = yield* runDoctorChecks()
```

- [ ] **Step 2: Verify existing setup tests still pass**

```bash
bun --bun vitest run tests/cli/setup.test.ts
```
Expected: all tests pass (existing + new)

- [ ] **Step 3: Run the full test suite**

```bash
bun --bun vitest run
```
Expected: all 631 tests pass

- [ ] **Step 4: Build**

```bash
bun run build
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/setup.ts
git commit -m "feat: wire ingestSetupGuidelines into setup command flow"
```
