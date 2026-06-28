# Design: Guideline Ingestion During Setup

## Problem

The `hamilton setup` command copies guideline files to `~/.hamilton/guidelines/` but never ingests them into the qmd memory store. This means after a fresh setup, the memory store has zero canonical atoms. No guidelines are injected into workflow prompts until the user runs `hamilton memory ingest --guidelines` manually or runs a workflow (which ingests lazily, filtered by project tech stack).

## Design

### New function: `ingestSetupGuidelines`

**Location:** `src/cli/commands/setup.ts`

**Signature:**
```ts
export function ingestSetupGuidelines(): Effect.Effect<void, never, never>
```

**Behavior:**
1. Creates a `UserMemoryStore` via `createUserMemoryStore(hamiltonHome())`
2. If store creation fails: logs a warning, returns void
3. Loads all guidelines via `loadAllGuidelines(guidelinesDir())` (no project filtering)
4. Opens `hamilton.db`, runs `migrate()`
5. Calls `ingestGuidelines(store.writer, db, loadedGuidelines)`
6. If ingestion throws: logs a warning with the error, returns void
7. Logs summary: `"Guideline memory primed: <N> ingested, <M> unchanged"`
8. Closes store and DB via finalizer

**Dependencies:**
- `createUserMemoryStore` from `src/memory/store.ts`
- `ingestGuidelines` from `src/memory/guidelines.ts`
- `loadAllGuidelines` from `src/guidelines/loader.ts`
- `guidelinesDir`, `hamiltonHome`, `dbPath` from `src/paths.ts`
- `Database` from `bun:sqlite`
- `migrate` from `src/db/migrations.ts`

### Placement in the setup flow

Inserted between result printing and doctor checks in the `setupCommand` handler:

```
1. Resolve model aliases
2. setupHamilton()        (copies guidelines to disk)
3. Print "setup complete"
4. ingestSetupGuidelines()  ← NEW
5. Doctor checks
```

## Error Handling

All failures are caught and logged as warnings. Setup always proceeds to doctor regardless of ingestion outcome:

- Store unavailable: `"Skipping guideline ingestion — memory store unavailable. Ingestion will run on first workflow execution."`
- Ingestion throws: `"Guideline ingestion failed: <error>. Will retry on next workflow run."`

This matches the existing pattern in `src/cli/commands/run.ts` where ingestion failures are silently swallowed.

## Testing

- Unit: mock store, verify `ingestGuidelines` is called with correct guidelines via `loadAllGuidelines`
- Integration: run setup in a temp home dir, verify `qmd.db` has documents after
- Failure: broken/corrupt `qmd.db` — setup still completes, doctor still runs

## Scope

Single-file change to `src/cli/commands/setup.ts`. No other files modified.
