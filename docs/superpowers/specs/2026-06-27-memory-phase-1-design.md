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
        memoryStore        (NEW)
      })
         |
         +-- (inside runner, per task):
              +-- curator.suggestMemoryFilters(taskPrompt, files)
              |     -> { tags, languages, filePaths }
              +-- atoms = store.retrieveRelevant(filters, limit)
              +-- context = buildMemoryContext(atoms)
              +-- inject context into DefaultResourceLoader
```

Runner changes:
- Removes internal `loadGuidelines()` call — receives `guidelineRules` and `memoryStore` from caller.
- Raw guideline files no longer passed to `DefaultResourceLoader.agentsFilesOverride` — replaced by memory context string.
- Per-task: curator → retrieve → inject.

---

## 4. Curator Package

The curator is a standalone package (`src/curator/`) that owns LLM operations. Memory is just one of its future responsibilities.

### 4.1 LLMClient

Extracted from `src/executors/pi/pi-executor.ts`. A single-flight prompt→completion wrapper around `@earendil-works/pi-ai`.

```typescript
function createLLMClient(config?: {
  modelsJsonPath?: string
  onTokenUsage?: (usage: TokenUsage) => void
}): {
  complete(provider: string, modelId: string, context: Context): Promise<Completion>
}
```

Uses `AuthStorage`, `ModelRegistry`, and `getModel` from `@earendil-works/pi-ai`. No agent loop. Called by the curator for structured JSON output.

### 4.2 Curator

```typescript
interface Curator {
  suggestMemoryFilters(taskPrompt: string, files: string[]): Promise<MemoryFilters>
  findRelevantAtoms(store: MemoryStore, filePath: string, tags: string[]): Promise<MemoryAtom[]>
}

interface MemoryFilters {
  tags: string[]
  languages: string[]
  filePaths: string[]
}
```

`suggestMemoryFilters` calls the fast model via `LLMClient` with structured JSON output. Returns tags, languages, and file paths relevant to the task. These are passed as `intent` to qmd search.

`findRelevantAtoms` delegates to `store.retrieveRelevant()` — thin method for now, gains logic later.

---

## 5. MemoryStore

```typescript
interface MemoryStore {
  retrieveRelevant(filters: MemoryFilters, limit: number): Promise<MemoryAtom[]>
  writeAtom(atom: NewMemoryAtom): Promise<{ id: string; path: string }>
  getAtom(id: string): Promise<MemoryAtom | null>
  tombstone(id: string): Promise<void>
  close(): Promise<void>
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
- `createProjectMemoryStore(dbPath: string, storePath: string): Promise<MemoryStore>`
- `createUserMemoryStore(hamiltonHome: string): Promise<MemoryStore>`

In this phase only `createUserMemoryStore` is used — guidelines are user-scoped.

`retrieveRelevant()` is a single abstract method encapsulating all retrieval logic. Currently searches the `canonical` collection via qmd with a default limit of 5 (`canonical_top_k` from settings). When more atom kinds arrive, the implementation grows internally — callers never change.

---

## 6. Guideline Ingest Pipeline

`ingestGuidelines(store: MemoryStore, db: Database, guidelines: LoadedGuideline[]): Promise<IngestResult>`

For each guideline:

1. **Change detection** — compute SHA-256 of the guideline content. Query `memory_event_log` for the most recent `ingested` event with matching `source_path`. Hash matches → skip. Hash differs → proceed.
2. **Tombstone old** — if a previous version exists, mark all canonical atoms with matching `source_path` as `status: tombstoned` in Hamilton DB and update their `.md` frontmatter.
3. **Write** — copy the guideline file to `~/.hamilton/memory/user/canonical/<name>.md` with YAML frontmatter: `kind: canonical`, `source: guideline`, `scope: user`, `confidence: 1.0`, `source_path`. Single file per guideline — qmd handles chunking and embedding internally.
4. **Index** — `store.update()` + `store.embed()` against the user store directory.
5. **Register** — INSERT into `memory_atoms` in Hamilton DB. INSERT `ingested` event into `memory_event_log` with hash, source_path, and atom count.

For the guideline system to work, the user must have run `hamilton setup` with qmd models downloaded. Without models, `store.embed()` fails and ingestion is skipped.

---

## 7. Context Injection

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

## 8. DB Changes — Migration v8

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

## 9. Paths

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

## 10. Error Handling

| Failure | Behaviour |
|---------|-----------|
| `createUserMemoryStore` fails (qmd unavailable) | Log warning. Skip memory entirely. Agent runs without memory context. |
| Guideline ingest fails for one file | Log warning. Skip that file. Continue with remaining guidelines. |
| `curator.suggestMemoryFilters` fails (LLM error) | Return empty filters. `retrieveRelevant` falls back to untargeted search (query-only, no intent). |
| `store.retrieveRelevant` fails | `buildMemoryContext([])` → empty string. No memory injected. |
| `qmd embed` fails during ingest | Skip the file. Leave no `pending` rows (write comes after embed). |

---

## 11. Implementation Files

| File | Purpose |
|------|---------|
| `src/curator/llm-client.ts` | LLMClient extracted from Pi executor auth/model resolution |
| `src/curator/curator.ts` | suggestMemoryFilters, findRelevantAtoms |
| `src/curator/index.ts` | Public exports |
| `src/memory/store.ts` | MemoryStore with qmd + Hamilton DB, createProjectMemoryStore, createUserMemoryStore |
| `src/memory/guidelines.ts` | ingestGuidelines — hash check, tombstone old, write, embed, register |
| `src/memory/queries.ts` | Hamilton DB queries for memory_atoms, memory_event_log |
| `src/memory/context.ts` | buildMemoryContext — pure formatter |
| `src/memory/index.ts` | Public exports |
| `src/db/schema.ts` | Add memory_atoms, memory_event_log DDL |
| `src/db/migrations.ts` | Add migration v8 |
| `src/db/subscribers.ts` | Extend DbWriter for memory events |
| `src/paths.ts` | Add memoryDir, userMemoryDir, userMemoryDBPath |
| `src/cli/commands/run.ts` | Call ingestGuidelines before runWorkflow |
| `src/cli/commands/resume.ts` | Call ingestGuidelines before runWorkflow |
| `src/workflow/runner.ts` | Remove internal loadGuidelines, accept memoryStore, per-task curator + context injection |
| `package.json` | Add @tobilu/qmd dependency |
