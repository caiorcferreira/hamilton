# Memory Ingest CLI — `hamilton memory ingest --guidelines`

| Field       | Value                                                |
|-------------|------------------------------------------------------|
| Created     | 2026-06-28                                           |
| Status      | Draft                                                |
| RFC         | [RFC-001 §5, §14](../../.superpowers/RFC-001-agent-long-term-memory.md) |
| Scope       | CLI command to trigger guideline ingestion outside of a workflow run |

## 1. Motivation

Guideline ingestion currently only runs automatically at workflow start (in `run.ts` and `resume.ts`). There is no way for a user to re-trigger ingestion without starting a workflow. The RFC specifies `hamilton memory ingest --guidelines` as a standalone CLI command.

## 2. Scope

**In scope:**
- `hamilton memory` parent command (placeholder for future memory subcommands)
- `hamilton memory ingest --guidelines` — loads guidelines, hash-detects changes, tombstones stale canonical atoms, writes new ones to qmd + Hamilton DB
- Extracting a shared `ingestGuidelines()` Effect function from the duplicated logic in `run.ts`/`resume.ts`
- Refactoring `run.ts` and `resume.ts` to call the shared function

**Out of scope:**
- `hamilton memory ingest <path>` (manual file/URL ingestion) — deferred
- Content chunking pipeline (§5.1–5.2) — single atom per guideline, matching current Phase 1 behaviour
- Project-scoped memory stores — guidelines remain user-scoped, matching current Phase 1
- All other `hamilton memory` subcommands (list, show, edit, forget, daemon, etc.)

## 3. Architecture

```
src/memory/guidelines.ts
  └── ingestGuidelines(writer, db, guidelines): Effect<IngestSummary, IngestError>
        per-file detectChanges/tombstoneStale/writeToQmd/registerIngestedEvent → return summary

src/cli/commands/memory.ts
  └── memoryCommand: parent command (just shows help)

src/cli/commands/memory-ingest.ts
  └── ingestCommand: subcommand of memory, wraps ingestGuidelines()
        Option: --guidelines (boolean)
        calls Effect.exit(ingestGuidelines()), displays summary or error

src/cli/commands/run.ts    ┐
src/cli/commands/resume.ts ┘  call ingestGuidelines() instead of inline loops
```

### 3.1 Function Signature

```typescript
export interface IngestSummary {
  processed: number
  ingested: number
  skipped: number
  tombstoned: number
  atoms: Array<{ id: string; guidelineName: string; action: "created" | "skipped" }>
}

export class IngestError extends Data.TaggedError("IngestError")<{
  message: string
  guideline?: string
}> {}

export function ingestGuidelines(
  writer: MemoryWriter,
  db: Database,
  guidelines: LoadedGuideline[]
): Effect.Effect<IngestSummary, IngestError>
```

The caller manages the store lifecycle — creates it, passes the writer for ingestion, keeps the reader for context injection, closes when done. The CLI command creates its own store since it doesn't need a reader afterward.

### 3.2 Flow

```
For each guideline in the provided array:
  a. Compute sourcePath = `/guidelines/${guideline.name}.md`
  b. detectChanges(guideline, db, sourcePath)
  c. If hash matches → skip, count as "skipped"
  d. If hash differs:
     - If previously ingested → tombstoneStale(writer, db, sourcePath)
     - writeToQmd(writer, guideline, db, "guideline", sourcePath)
     - registerIngestedEvent(db, sourcePath, change.hash, 1)
     - count as "ingested"
Return IngestSummary
```
6. Return IngestSummary
```

Individual guideline failures do not abort the loop — the failed guideline is skipped and processing continues. A failure only surfaces at the outer level when the store or DB cannot be created at all.

## 4. CLI Interface

```
hamilton memory ingest --guidelines
```

- `--guidelines`: boolean flag (no value). Required — the command does nothing without it.
- No positional args, no scope flag, no other options.

### 4.1 Command Structure

```typescript
// memory.ts — parent
export const memoryCommand = Command.make("memory", {}, () =>
  Console.log("Use a subcommand: ingest\n\nUse --help for details")
).pipe(
  Command.withSubcommands([ingestCommand])
)

// memory-ingest.ts — ingest subcommand
const guidelinesFlag = Options.boolean("guidelines")

export const ingestCommand = Command.make("ingest", { guidelines: guidelinesFlag },
  ({ guidelines }) =>
    Effect.gen(function* () {
      if (!guidelines) {
        yield* Console.error("No ingest mode specified. Use --guidelines.")
        return
      }
      const loaded = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))
      const sorted = loaded.filter(g => g.instructions !== null)

      if (sorted.length === 0) {
        yield* Console.log("No matching guideline files found.")
        return
      }

      const store = yield* _(Effect.tryPromise(() => createUserMemoryStore(hamiltonHome())))
      yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))

      const db = new Database(dbPath())
      migrate(db)

      const summary = yield* _(ingestGuidelines(store.writer, db, sorted))
      db.close()

      yield* Console.log(formatSummary(summary))
    })
).pipe(Command.withDescription("Ingest content into the memory store"))
```

### 4.2 Output Format

```
Guideline ingestion complete
────────────────────────────
  Processed: 4
  Ingested:  2  (atoms created)
  Skipped:   1  (unchanged)
  Tombstoned: 1 (stale atoms replaced)

New atoms:
  AGENTS.md → w7k2m... (canonical)
  CLAUDE.md → x8n3p... (canonical)

Skipped:
  project-conventions.md: unchanged since last ingestion
```

If no guidelines match project files, output is:
```
Ingestion complete: 0 guidelines processed (no matching files)
```

## 5. Changes to Existing Files

### 5.1 `src/memory/guidelines.ts`

Add `ingestGuidelines(writer, db, guidelines)` Effect function that orchestrates the existing steps (`detectChanges`, `tombstoneStale`, `writeToQmd`, `registerIngestedEvent`). The existing functions are unchanged — only the orchestrator is added. Imports `MemoryWriter` from `./store.js` and `LoadedGuideline` from `../guidelines/types.js`.

### 5.2 `src/cli/commands/run.ts` (lines 91–117)

Replace the inline guideline loop with a call to `ingestGuidelines()`. The store lifecycle remains unchanged — `createUserMemoryStore` is still the caller's responsibility, so the `memoryReader` for context injection is still available:

```typescript
const store = yield* _(Effect.tryPromise(() => createUserMemoryStore(hamiltonHome())).pipe(
  Effect.orElseSucceed(() => null)
))
if (store) {
  memoryReader = store.reader
  yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))
  const ingestDb = new Database(dbPath())
  migrate(ingestDb)
  yield* _(Effect.promise(async () => {
    await ingestGuidelines(store.writer, ingestDb, loadedGuidelines)()
  }).pipe(Effect.orElseSucceed(() => undefined)))
  ingestDb.close()
}
```

### 5.3 `src/cli/commands/resume.ts`

Same refactor as `run.ts`.

### 5.4 `src/cli/main.ts`

Add `memoryCommand` to root subcommands:
```typescript
// existing imports
import { memoryCommand } from "./commands/memory.js"

const rootCommand = Command.make("hamilton", ...).pipe(
  Command.withSubcommands([
    setupCommand, doctorCommand, workflowCommand, mcpCommand, telemetryCommand,
    memoryCommand,  // added
  ])
)
```

## 6. Error Handling

| Failure | Behaviour |
|---------|-----------|
| `--guidelines` not passed | Print error, exit |
| `loadGuidelines()` returns empty list / none with instructions | Print "No matching guideline files found", exit 0 |
| `createUserMemoryStore` fails (qmd unavailable) | Effect.tryPromise fails, CLI prints error via default error handling |
| Single guideline's `writeToQmd` fails | Skip that guideline, continue with remaining (handled inside the function) |
| `ingestGuidelines` itself fails | Effect.tryPromise fails, CLI reports error |

## 7. Files

| File | Action |
|------|--------|
| `src/memory/guidelines.ts` | Add `ingestGuidelines()` orchestrator |
| `src/cli/commands/memory.ts` | Create — parent command |
| `src/cli/commands/memory-ingest.ts` | Create — `ingest` subcommand |
| `src/cli/commands/run.ts` | Replace inline ingestion loop with `ingestGuidelines()` call |
| `src/cli/commands/resume.ts` | Replace inline ingestion loop with `ingestGuidelines()` call |
| `src/cli/main.ts` | Register `memoryCommand` as subcommand |

## 8. Testing

- Unit tests for `ingestGuidelines()` in `tests/memory/guidelines.test.ts` — mock the qmd store and verify the orchestration (change detection, tombstone, write, register event)
- Integration tests for the CLI command — set up temp guidelines dir, run `hamilton memory ingest --guidelines`, verify output and DB state
- Tests for `run.ts` and `resume.ts` skip path (ingestGuidelines returns undefined on failure, run continues)
