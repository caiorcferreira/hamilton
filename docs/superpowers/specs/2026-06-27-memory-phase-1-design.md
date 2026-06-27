# Memory Phase 1 — Guideline Ingestion & Curator-Assisted Context Injection

| Field       | Value                                                |
|-------------|------------------------------------------------------|
| Created     | 2026-06-27                                           |
| Status      | Draft                                                |
| RFC         | [RFC-001](../../.superpowers/RFC-001-agent-long-term-memory.md) |
| Scope       | Guideline ingestion + curator-assisted memory injection only |

## 1. Scope

This spec covers the first phase of the long-term memory system. Only two pieces are implemented:

1. **Guideline ingestion** — guideline files are ingested as canonical atoms into qmd + Hamilton DB at workflow start.
2. **Curator-assisted context injection** — a curator determines task context filters, the memory store retrieves relevant canonical atoms, and the context is injected into the Pi session.

**Explicitly out of scope (deferred to later specs):**

- MCP server integration (memory tools)
- Autonomous memory pipeline (observation collection, Phase 2–5 extraction, daemon)
- Manual file-based ingestion (`hamilton memory ingest <path>`)
- CLI commands (`hmemory forget`, `hmemory promote`, `hmemory list`, `hmemory edit`, `hmemory resurrect`, `hmemory maintain`, `hmemory status`)
- `hmemory_record`, `hmemory_query`, `hmemory_get` tools
- Pi SDK memory extension
- Corrections, failures, facts, procedures, and preferences as atom kinds (created later)
- Salience model and demotion protocol
- Session summary folds
- EventBus refactoring to application scope

---

## 2. Module Structure

```
src/curator/
  llm-client.ts     — Shared LLMClient extracted from Pi executor
  curator.ts         — suggestMemoryFilters, findRelevantAtoms
  index.ts

src/memory/
  store.ts          — MemoryStore (qmd + Hamilton DB), createProjectMemoryStore, createUserMemoryStore
  guidelines.ts     — ingestGuidelines(store, db, guidelines)
  queries.ts        — Hamilton DB queries
  context.ts        — buildMemoryContext(atoms) → markdown string
  index.ts

src/db/
  migrations.ts     — +v8 (memory_atoms, memory_event_log tables)
  schema.ts         — +DDL
  subscribers.ts    — +memory event handlers
```

---

## 3. Integration Flow

Ingestion happens before `runWorkflow`; context injection happens inside it.

```
Caller (run.ts / resume.ts)
  |
  +-- 1. loadGuidelines()                              (existing, moved up)
  +-- 2. ingestGuidelines(store, db, guidelines)       (NEW)
  |      +-- hash check (memory_event_log) to skip unchanged files
  |      +-- tombstone old canonical atoms on change
  |      +-- write guideline to qmd + Hamilton DB
      |
      +-- 3. runWorkflow(spec, params, {
        guidelineRules,    (existing, extracted from loadedGuidelines)
        memoryReader       (NEW — MemoryReader, read-only interface)
      })
         |
         +-- (inside runner, per task):
              +-- curator.suggestMemoryFilters(taskPrompt, files)
              |     -> { tags, languages, filePaths }
              +-- atoms = reader.retrieveRelevant(filters, limit)
              +-- context = buildMemoryContext(atoms)
              +-- inject context into DefaultResourceLoader
```

Runner changes:
- Removes internal `loadGuidelines()` call — receives `guidelineRules` and `memoryReader` from caller.
- Raw guideline files no longer passed to `DefaultResourceLoader.agentsFilesOverride` — replaced by memory context string.
- Per-task: curator → retrieve → inject.

---

## 4. EventBus Generalization (Prerequisite Refactor)

The EventBus is currently scoped per-workflow-run: `EventBusLive` is provided via `Effect.provide(EventBusLive)` inside `runWorkflow`. This means no code outside the runner body can publish or subscribe to events — the guideline ingest pipeline and curator LLM calls operate without observability.

### 4.1 Target State

The EventBus must be lifted to **application scope** — a single bus that lives as long as the Hamilton CLI process. `EventBusLive` is provided at the CLI entry point (`src/cli/main.ts`) instead of inside `runWorkflow`. All downstream code (CLI commands, runWorkflow, guideline ingest, curator) resolves `EventBus` from the ambient context.

### 4.2 Changes

**`src/events/bus.ts`:**

- `runId` and `taskId` become optional on all event types. Events that fire outside a run (e.g. `TokenUsage` from the curator during guideline ingest) set them to `undefined`.
- Event type union updated to mark `runId?: string; taskId?: string` on every variant.
- `EventBusLive` layer definition unchanged — only the provision site moves.

**`src/cli/main.ts`:**

- Provides `EventBusLive` in the root Effect layer alongside other application-scoped services.
- `runWorkflow` and all CLI commands inherit the bus from the outer scope.

**`src/workflow/runner.ts`:**

- Removes `EventBus` from the `runWorkflow` Effect signature (`EventBus | Scope.Scope` → `Scope.Scope`).
- No longer provides `EventBusLive` — it is already in scope.

**`src/observability/subscribers.ts` / `src/db/subscribers.ts`:**

- Subscribers that reference `runId` or `taskId` handle `undefined` gracefully (skip or log `null`).

**`src/cli/commands/run.ts` / `src/cli/commands/resume.ts`:**

- Guideine ingest and curator calls now run within the same EventBus scope as the workflow, so `TokenUsage` events from `LLMClient` are captured.

### 4.3 Impact on Phase 1

- `LLMClient` receives the EventBus at construction time and publishes `TokenUsage` events on every completion — both during guideline ingest (pre-runner) and curator calls (inside runner).
- `DbWriter` subscriber persists `TokenUsage` to `token_events` table regardless of origin.
- `TaskLogger` subscriber skips events with no `taskId`.

---

## 5. Curator Package

The curator is a standalone package (`src/curator/`) that owns LLM operations. Memory is just one of its future responsibilities.

### 5.1 LLMClient

Extracted from `src/executors/pi/pi-executor.ts`. A single-flight prompt→completion wrapper around `@earendil-works/pi-ai`.

```typescript
function createLLMClient(config?: {
  modelsJsonPath?: string
  bus?: EventBusService
}): {
  complete(provider: string, modelId: string, context: Context): Promise<Completion>
}
```

Uses `AuthStorage`, `ModelRegistry`, and `getModel` from `@earendil-works/pi-ai`. No agent loop. Called by the curator for structured JSON output.

When an `EventBusService` is provided, the client publishes `TokenUsage` events on every completion. The existing observability layer (`TaskLogger`, `DbWriter` subscribers) handles persistence — no additional wiring needed. When no bus is provided (pre-runner phase), token usage is silently skipped.

### 5.2 Curator

```typescript
interface Curator {
  suggestMemoryFilters(taskPrompt: string, files: string[]): Promise<MemoryFilters>
  findRelevantAtoms(reader: MemoryReader, filePath: string, tags: string[]): Promise<MemoryAtom[]>
}

interface MemoryFilters {
  tags: string[]
  languages: string[]
  filePaths: string[]
}
```

`suggestMemoryFilters` calls the fast model via `LLMClient` with structured JSON output. Returns tags, languages, and file paths relevant to the task. These are passed as `intent` to qmd search.

`findRelevantAtoms` delegates to `reader.retrieveRelevant()` — thin method for now, gains logic later.

---

## 6. MemoryStore

Consumers that need only read or only write see segregated interfaces. A single concrete implementation satisfies both.

```typescript
interface MemoryReader {
  retrieveRelevant(filters: MemoryFilters, limit: number): Promise<MemoryAtom[]>
  getAtom(id: string): Promise<MemoryAtom | null>
}

interface MemoryWriter {
  writeAtom(atom: NewMemoryAtom): Promise<{ id: string; path: string }>
  tombstone(id: string): Promise<void>
  updateStatus(id: string, status: string): Promise<void>
}

interface MemoryAtom {
  id: string
  title: string
  kind: "canonical" | "correction" | "failure" | "fact" | "procedure" | "preference"
  scope: "project" | "user"
  confidence: number
  content: string
  tags: string[]
}
```

Two factory functions:
- `createProjectMemoryStore(dbPath: string, storePath: string): Promise<{ reader: MemoryReader; writer: MemoryWriter; close(): Promise<void> }>`
- `createUserMemoryStore(hamiltonHome: string): Promise<{ reader: MemoryReader; writer: MemoryWriter; close(): Promise<void> }>`

In this phase only `createUserMemoryStore` is used — guidelines are user-scoped. The runner receives only the `MemoryReader`; `ingestGuidelines` receives only the `MemoryWriter`.

`retrieveRelevant()` is a single abstract method encapsulating all retrieval logic. Currently searches the `canonical` collection via qmd with a default limit of 5 (`canonical_top_k` from settings). When more atom kinds arrive, the implementation grows internally — callers never change.

---

## 7. Guideline Ingest Pipeline

The pipeline is composed of independently testable steps. The top-level function orchestrates them.

### 7.1 Steps

```
detectChanges(guideline, db) → ChangeResult
if changed:
  tombstoneStale(writer, db, sourcePath)
  writeToQmd(writer, guideline) → { id, path }
  embed(writer, path)
  finalizeAtom(writer, id)
registerIngestedEvent(db, sourcePath, hash)
```

### 7.2 Step Details

**`detectChanges(guideline, db)`**

Normalize line endings before hashing — `\r\n` and `\r` are replaced with `\n`. SHA-256 the normalized content. Query `memory_event_log` for the most recent `ingested` event with matching `source_path`. Return `{ changed: true/false, hash }`.

**`tombstoneStale(writer, db, sourcePath)`**

Mark all canonical atoms with matching `source_path` as `status: tombstoned` in Hamilton DB and update their `.md` frontmatter.

**`writeToQmd(writer, guideline)`**

Copy the guideline file to `~/.hamilton/memory/user/canonical/<name>.md` with YAML frontmatter: `kind: canonical`, `source: guideline`, `scope: user`, `confidence: 1.0`, `source_path`. Single file per guideline — qmd handles chunking internally. INSERT into `memory_atoms` with `status: pending`. Returns `{ id, path }`.

**`embed(writer, path)`**

Call `store.update()` + `store.embed()` against the user store directory to index the new file into qmd's hybrid search engine.

**`finalizeAtom(writer, id)`**

UPDATE `memory_atoms` SET `status = 'active'` WHERE `id = ?`. Only called after embed succeeds.

**`registerIngestedEvent(db, sourcePath, hash)`**

INSERT `ingested` event into `memory_event_log` with hash, source_path, and atom count.

### 7.3 Transaction Safety

Hamilton DB and qmd are separate SQLite files with no shared transaction scope. The `pending` status pattern provides a recovery boundary:

```
                                Hamilton DB              qmd (filesystem + embed)
writeToQmd: INSERT pending  →  row: pending              .md file exists
embed: fs already has file  →  row: pending              vector index built
finalizeAtom: UPDATE active →  row: active               already indexed
```

If `embed` fails after `writeToQmd`: Hamilton DB has a `pending` row, no vector index. The next maintenance pass detects `pending` rows older than 5 minutes, re-triggers embed, and finalizes to `active`. If the `.md` file is missing → tombstone the row.

If `finalizeAtom` fails after embed: qmd has indexed content, Hamilton DB shows `pending`. Same recovery as above — maintenance pass re-runs embed (idempotent) and finalizes.

### 7.4 Orchestrator

```typescript
function ingestGuidelines(
  writer: MemoryWriter,
  db: Database,
  guidelines: LoadedGuideline[]
): Promise<IngestResult>
```

Loops over guidelines, calls the steps above, accumulates results. For the guideline system to work, the user must have run `hamilton setup` with qmd models downloaded. Without models, `embed()` fails and ingestion is skipped.

---

## 8. Context Injection

`buildMemoryContext(atoms: MemoryAtom[]): string`

Pure formatting function. Assembles a markdown context block from the retrieved atoms:

```markdown
---
## Agent Memory — Session Context

> The following memories were retrieved from your long-term store.
> These are authoritative guidelines ingested from project instruction files.

### REFERENCE (canonical knowledge)

#### [canonical] <atom title>
*Confidence: 1.0 | Source: <source_path> | ID: <id>*

<atom content>

---

*N atoms injected inline.*
---
```

In this phase only the `REFERENCE` section exists. More sections are added when other atom kinds are implemented.

The context string is appended to the system prompt via `DefaultResourceLoader.agentsFilesOverride`, replacing the raw guideline files that were previously passed directly.

---

## 9. DB Changes — Migration v8

```sql
CREATE TABLE memory_atoms (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('correction','failure','preference','fact','procedure','canonical')),
  scope TEXT NOT NULL CHECK (scope IN ('project','user')),
  confidence REAL NOT NULL DEFAULT 0.5,
  salience REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','demoted','tombstoned')),
  project_id TEXT,
  run_id TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  demoted_at TEXT,
  tombstoned_at TEXT
);

CREATE TABLE memory_event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  atom_id TEXT,
  run_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('agent','system','human')),
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`source_path` is stored in the qmd frontmatter, not in `memory_atoms` — that table tracks lifecycle metadata only.

---

## 10. Paths

`src/paths.ts` additions:

```typescript
export function memoryDir(): string {
  return Path.join(hamiltonHome(), "memory")
}

export function userMemoryDir(): string {
  return Path.join(memoryDir(), "user")
}

export function userMemoryDBPath(): string {
  return Path.join(userMemoryDir(), "qmd.db")
}
```

`ensureHamiltonHome()` must also create `~/.hamilton/memory/user/canonical/`.

On-disk layout in this phase:

```
~/.hamilton/memory/
  user/
    qmd.db              ← qmd SQLite (FTS5 + vectors)
    canonical/          ← .md files (kind=canonical, source=guideline)
```

---

## 11. Error Handling

| Failure | Behaviour |
|---------|-----------|
| `createUserMemoryStore` fails (qmd unavailable) | Log warning. Skip memory entirely. Agent runs without memory context. |
| Guideline ingest fails for one file | Log warning. Skip that file. Continue with remaining guidelines. |
| `curator.suggestMemoryFilters` fails (LLM error) | Return empty filters. `retrieveRelevant` falls back to untargeted search (query-only, no intent). |
| `reader.retrieveRelevant` fails | `buildMemoryContext([])` → empty string. No memory injected. |
| `embed` fails after `writeToQmd` | Atom left as `pending` in Hamilton DB. Maintenance pass recovers: re-triggers embed → finalizes to `active`. |
| `finalizeAtom` fails after `embed` | Atom stays `pending` in Hamilton DB. Maintenance pass re-runs embed (idempotent) → finalizes. |
| `.md` file missing for `pending` row | Maintenance pass tombstones the row — file write failed, atom is unrecoverable. |
| Hash match (no change) | Skip all steps for that guideline. No writes, no events. |

---

## 12. Implementation Files

| File | Purpose |
|------|---------|
| `src/events/bus.ts` | Make runId/taskId optional, generalize event types for application scope |
| `src/curator/llm-client.ts` | LLMClient extracted from Pi executor auth/model resolution, publishes TokenUsage via EventBus |
| `src/curator/curator.ts` | suggestMemoryFilters, findRelevantAtoms |
| `src/curator/index.ts` | Public exports |
| `src/memory/store.ts` | MemoryReader + MemoryWriter interfaces, MemoryStore concrete impl, createProjectMemoryStore, createUserMemoryStore |
| `src/memory/guidelines.ts` | detectChanges, tombstoneStale, writeToQmd, embed, finalizeAtom, registerIngestedEvent + ingestGuidelines orchestrator |
| `src/memory/queries.ts` | Hamilton DB queries for memory_atoms, memory_event_log |
| `src/memory/context.ts` | buildMemoryContext — pure formatter |
| `src/memory/index.ts` | Public exports |
| `src/db/schema.ts` | Add memory_atoms, memory_event_log DDL |
| `src/db/migrations.ts` | Add migration v8 |
| `src/db/subscribers.ts` | Extend DbWriter for memory events |
| `src/paths.ts` | Add memoryDir, userMemoryDir, userMemoryDBPath |
| `src/cli/main.ts` | Provide EventBusLive at application scope |
| `src/cli/commands/run.ts` | Call ingestGuidelines before runWorkflow |
| `src/cli/commands/resume.ts` | Call ingestGuidelines before runWorkflow |
| `src/workflow/runner.ts` | Remove internal loadGuidelines, accept memoryStore, per-task curator + context injection |
| `package.json` | Add @tobilu/qmd dependency |

---

## 13. Documentation Updates

**`AGENTS.md`:**

| Update | Detail |
|--------|--------|
| Add `@tobilu/qmd` to essential commands | `bun install` already covers it; note that `hamilton setup` must download embedding models |
| Add `~/.hamilton/memory/` to directory structure | New runtime directory: `memory/user/qmd.db`, `memory/user/canonical/` |
| Add `hamilton setup` model download note | Required for memory to function; failure is graceful (skip, no crash) |
| Add `src/curator/`, `src/memory/` to source tree | New top-level modules |
| EventBus note | EventBus is now application-scoped (provided at `main.ts`), not per-run |
