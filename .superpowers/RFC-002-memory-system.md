# RFC-002: Hamilton Memory System

| Field       | Value                                                                 |
|-------------|-----------------------------------------------------------------------|
| RFC Number  | 002                                                                   |
| Title       | Hamilton Memory System                                                |
| Status      | Draft                                                                 |
| Created     | 2026-07-10                                                            |
| Supersedes  | RFC-001 (Agent Long-Term Memory)                                      |
| Storage     | `@tobilu/qmd` (markdown content + hybrid search) + `bun:sqlite` (lifecycle metadata) |

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY in this document are
to be interpreted as described in RFC 2119.

---

## Table of Contents

1. [Summary](#1-summary)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [Current State](#3-current-state)
4. [Concepts and Taxonomy](#4-concepts-and-taxonomy)
5. [Architecture](#5-architecture)
6. [Data Model](#6-data-model)
7. [Ingestion — Guidelines](#7-ingestion--guidelines)
8. [Ingestion — Session Review Daemon](#8-ingestion--session-review-daemon)
9. [Retrieval and the MCP Surface](#9-retrieval-and-the-mcp-surface)
10. [Lifecycle — Retirement and Forgetting](#10-lifecycle--retirement-and-forgetting)
11. [Configuration](#11-configuration)
12. [CLI Surface](#12-cli-surface)
13. [Phasing](#13-phasing)
14. [Open Questions](#14-open-questions)
15. [Appendix: Divergences from Today's Code](#15-appendix-divergences-from-todays-code)

---

## 1. Summary

Hamilton and the other coding agents a developer uses (Claude Code, opencode)
begin every session with no durable knowledge of prior work: which technologies
the project has standardized on, what decisions were already made, which
mistakes were already corrected. This RFC defines a **memory system** that
captures that knowledge as small markdown files ("atoms"), indexes them for
retrieval, and serves them back to any agent through Hamilton's MCP server.

Memory enters the system through two ingestion paths:

- **Guidelines** — human-authored markdown describing canonical technology
  choices. They are ingested automatically and never retire.
- **Session review** — a background daemon reads completed sessions from Claude
  Code and opencode, proposes candidate atoms (corrections, decisions,
  patterns), and writes them as markdown.

All atoms — regardless of path — are indexed by **qmd**, which owns hybrid
full-text + vector search over the markdown files. Hamilton's SQLite database
owns lifecycle metadata: status, retrieval statistics, and an append-only audit
log. Retrieval serves two shapes on demand: **a list of atom file paths** (for a
consumer that will load them itself) or **a single combined markdown context**
(for direct injection into a prompt).

The system tracks how often each atom is retrieved so that unused,
autonomously-created memory is **retired** over time. Guidelines are exempt.
A human can **forget** any atom at any time.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- **G1** — Ingest guideline files as canonical memory automatically, with no
  manual step, and keep them in sync with their source.
- **G2** — Extract durable knowledge (corrections, decisions, patterns) from the
  sessions of external agents (Claude Code, opencode) without a human in the
  loop.
- **G3** — Serve memory to any coding agent through Hamilton's MCP server, in
  two shapes: file paths, or a combined markdown context.
- **G4** — Index every memory file with qmd so retrieval is relevance-ranked,
  not keyword-exact.
- **G5** — Retire autonomously-created atoms that stop earning their retrieval,
  while guaranteeing guidelines never retire.
- **G6** — Let a human forget any atom, immediately and permanently.
- **G7** — Keep memory content human-readable, human-editable, and
  version-controllable (plain markdown files on disk).

### 2.2 Non-Goals

- **N1** — Intra-session memory (keeping an agent coherent *within* one run).
  That is the agent runtime's job, not this system's.
- **N2** — A hosted or multi-user memory service. Memory is local to the
  developer's machine under `~/.hamilton/`.
- **N3** — Reproducing qmd. Hamilton does not build its own search, ranking, or
  embedding — it delegates all of that to qmd.
- **N4** — Real-time extraction. Session review is asynchronous and best-effort;
  a run never blocks on memory writes.

---

## 3. Current State

The following is implemented today and is the foundation this RFC builds on:

- **Dual store bootstrap** (`src/memory/store.ts`): `createUserMemoryStore`
  opens a qmd store at `~/.hamilton/memory/user/qmd.db` with a single
  `canonical` collection, and writes atoms as markdown-with-frontmatter files.
- **Guideline ingestion** (`src/memory/guidelines.ts`): loads guideline
  instruction files, hashes their content (SHA-256), and ingests changed files
  as `canonical` atoms — tombstoning the prior version. Change detection keys
  off `ingested` events in `memory_event_log`.
- **Schema** (`src/db/migrations.ts`): `memory_atoms` and `memory_event_log`
  tables, including unused-but-present columns `salience`, `use_count`,
  `last_used_at`, `project_id`, `run_id`.
- **Retrieval + injection**: at task start the runner asks a `curator`
  (`src/curator/curator.ts`) for context filters, calls
  `MemoryReader.retrieveRelevant`, and `buildMemoryContext`
  (`src/memory/context.ts`) renders a markdown block injected into the system
  prompt by the Pi executor.
- **CLI**: `hamilton memory ingest --guidelines`.

Not yet implemented, and specified by this RFC: the session-review daemon,
memory tools on the MCP server, project scope, the correction/decision/pattern
kinds, retrieval-rate retirement, and the forget command. See
[§15](#15-appendix-divergences-from-todays-code) for the concrete deltas.

---

## 4. Concepts and Taxonomy

### 4.1 Atom

An **atom** is the unit of memory: one markdown file with a YAML frontmatter
header and a markdown body. The body is the knowledge; the frontmatter is the
metadata qmd needs to index and filter it. Atoms are immutable in content once
written by the autonomous pipeline — a change produces a new atom that
supersedes the old one (§8.4). Humans MAY edit an atom in place (§10.3).

### 4.2 Kinds

An atom has exactly one **kind**. Kinds partition memory by *what the knowledge
is* and drive retrieval priority and retirement eligibility.

| Kind         | What it captures                                                        | Source       | Retires? |
|--------------|-------------------------------------------------------------------------|--------------|----------|
| `guideline`  | A canonical technology choice or convention, authored by a human.       | Guideline ingest | **No** |
| `correction` | A mistake an agent made, paired with the correct answer.                | Session review | Yes    |
| `decision`   | A high-level, project-scoped architectural decision and its rationale.  | Session review | Yes    |
| `pattern`    | A reusable way to solve a recurring class of problem.                   | Session review | Yes    |

`guideline` is the canonical kind: it is the source of ground truth, is always
eligible for injection, and is never subject to automatic retirement. The three
autonomous kinds are proposals distilled from observed work and are subject to
the retirement lifecycle in §10.

> **Note.** The taxonomy is deliberately small. Today's schema `CHECK`
> constraint permits `correction | failure | preference | fact | procedure |
> canonical`; this RFC narrows the vocabulary to the four kinds above and treats
> the migration as an open decision (§14, [§15](#15-appendix-divergences-from-todays-code)).
> `canonical` is renamed to `guideline` to match the concept's name; a
> `failure`-like negative example is folded into `correction`.

### 4.3 Scope

An atom has exactly one **scope**:

- `project` — knowledge tied to one codebase. Injected only in sessions for that
  project. Applies to `decision`, `correction`, and `pattern` atoms that were
  learned about a specific project.
- `user` — knowledge that travels across projects (e.g. a cross-cutting
  guideline or a personal pattern). Injected in every session.

`project_id` is resolved at session start as the git repository root
(`git rev-parse --show-toplevel`), falling back to the working directory.
External agents declare `project_id` in their session metadata (§8.2).

### 4.4 Status

An atom is in exactly one **status**, forming a strict lifecycle:

```
active ──(retirement)──▶ demoted ──(retirement)──▶ tombstoned
  ▲                          │
  └──────(human resurrect)───┘
active/demoted ─────(human forget)────▶ tombstoned
```

- `active` — eligible for retrieval and injection.
- `demoted` — retained and searchable on demand, but excluded from automatic
  injection. A grace state before retirement.
- `tombstoned` — retired. Excluded from all retrieval; the markdown file is
  removed from qmd's index but the DB row is kept for audit.

A fourth status, `pending`, exists only as a transient write-time state (§5.4)
and is not part of the conceptual lifecycle: a row is `pending` between its
`INSERT` and the moment its file is indexed and it becomes `active`. A crash can
strand a row in `pending`; the maintenance pass reconciles it.

---

## 5. Architecture

### 5.1 Component Overview

```
        SOURCES                 INGESTION                 STORE                 CONSUMERS
 ┌──────────────────┐   ┌────────────────────────┐   ┌───────────────┐   ┌────────────────────┐
 │ Guideline files  │──▶│ Guideline Ingester     │──▶│               │   │ Hamilton runner    │
 │ (.md, canonical) │   │ (deterministic, hash)  │   │  MemoryStore  │◀──│ (prompt injection) │
 └──────────────────┘   └────────────────────────┘   │  ┌─────────┐  │   └────────────────────┘
                                                      │  │  qmd    │  │
 ┌──────────────────┐   ┌────────────────────────┐   │  │ content │  │   ┌────────────────────┐
 │ Claude Code /    │──▶│ Session Review Daemon  │──▶│  │ +search │  │◀──│ External agents    │
 │ opencode sessions│   │ (LLM extract+validate) │   │  ├─────────┤  │   │ (via Hamilton MCP) │
 └──────────────────┘   └────────────────────────┘   │  │ sqlite  │  │   └────────────────────┘
                                                      │  │ metadata│  │
 ┌──────────────────┐   ┌────────────────────────┐   │  └─────────┘  │
 │ Human (CLI)      │──▶│ Lifecycle Manager      │──▶│               │
 │                  │   │ (retire, forget, edit) │   └───────────────┘
 └──────────────────┘   └────────────────────────┘
```

Four responsibilities, cleanly separated (ports-and-adapters):

- **Sources** produce raw material. They do not know how atoms are stored.
- **Ingestion** turns raw material into atoms. Two independent ingesters share
  one write path — the `MemoryStore` port (§5.3).
- **Store** is the single port to persistence. It has two adapters — qmd for
  content+search, SQLite for metadata — hidden behind one interface. No consumer
  reaches past it.
- **Consumers** read atoms. They do not know whether the answer came from qmd,
  SQLite, or both.

### 5.2 Why Two Storage Layers

Content and lifecycle metadata have different access patterns and different
sources of truth, so they live in different stores:

| Concern                | Owner            | Source of truth | Rationale                                              |
|------------------------|------------------|-----------------|--------------------------------------------------------|
| Atom content           | markdown files   | **files**       | Human-readable, git-friendly, editable outside Hamilton.|
| Search index           | qmd (`qmd.db`)   | derived         | Rebuildable from files; qmd owns BM25 + vectors + RRF.  |
| Status, stats, audit   | Hamilton SQLite  | **`hamilton.db`** | Transactional lifecycle that changes without content changing (e.g. `use_count`). |

The markdown file is the source of truth for *what an atom says*. The SQLite row
is the source of truth for *how the atom is doing* (status, retrieval activity).
The qmd index is a derived artifact that can be rebuilt from the files at any
time. Storing volatile metadata like `use_count` in frontmatter would rewrite
files on every read and defeat the git-friendliness goal — so it lives only in
SQLite.

### 5.3 The MemoryStore Port

All ingestion and retrieval flow through one interface, so consumers never
couple to qmd or SQLite directly:

```typescript
interface MemoryStore {
  // Retrieval
  search(query: MemoryQuery): Promise<AtomHit[]>          // ranked hits (id, path, score, metadata)
  getById(id: string): Promise<Atom | null>               // full atom by id
  getByIds(ids: string[]): Promise<Atom[]>                // bulk fetch (e.g. all guidelines)

  // Writes (used only by ingesters and the lifecycle manager)
  write(atom: NewAtom): Promise<AtomRef>                  // file + qmd index + sqlite row
  setStatus(id: string, status: Status, reason: string): Promise<void>

  // Stats (used by retrieval to record retrieval activity)
  recordRetrieval(ids: string[]): Promise<void>           // increments use_count, sets last_used_at
}
```

`recordRetrieval` is what makes retirement possible (§10.1): every time an atom
is surfaced by `search`, its retrieval activity is recorded.

### 5.4 Write Consistency

A write touches three things — a file, the qmd index, and a SQLite row — that
cannot share one transaction (qmd and Hamilton use separate SQLite databases).
SQLite is the commit point; the file and index are derived and are made
consistent on a recovery pass:

1. `INSERT` the SQLite row with `status = 'pending'`. This is the commit.
2. Write the markdown file to disk.
3. Ask qmd to index the file (`store.update()` + `store.embed()`).
4. `UPDATE` the row to `status = 'active'`.

If the process dies between steps, the lifecycle manager's maintenance pass
(§10) reconciles: a `pending` row whose file exists is re-indexed and activated;
a `pending` row whose file is missing is tombstoned. This is the one place the
system tolerates temporary inconsistency, and it is self-healing.

---

## 6. Data Model

### 6.1 Atom File

```
~/.hamilton/memory/user/<kind>/<slug>-<id>.md
~/.hamilton/memory/projects/<project_id>/<kind>/<slug>-<id>.md
```

```markdown
---
id: <nanoid, 21 chars, immutable>
title: <short human-readable title>
kind: guideline | correction | decision | pattern
scope: user | project
source: guideline | claude-code | opencode | human
source_ref: <origin: guideline source_path, or session id>
project_id: <string or null>
tags: [<free-form>, ...]
created_at: <ISO 8601>
updated_at: <ISO 8601>
supersedes: [<atom id>, ...]     # atoms this one replaces; empty for new knowledge
---

<markdown body — the knowledge>
```

Notes:

- `confidence` and `salience` from earlier drafts are intentionally omitted from
  frontmatter. Retrieval relevance is qmd's job; retirement is driven by
  observed retrieval activity (§10), not a stored score. This keeps the atom
  file stable and avoids a number nobody can calibrate.
- A `correction` body MUST state both the mistake and the correct answer. A
  `decision` body SHOULD state the decision and its rationale. A `pattern` body
  SHOULD state the problem it solves and the shape of the solution.

### 6.2 SQLite Tables

`memory_atoms` — one row per atom, the system of record for lifecycle:

```sql
CREATE TABLE memory_atoms (
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL,              -- relative path to the .md file
  kind         TEXT NOT NULL CHECK (kind IN ('guideline','correction','decision','pattern')),
  scope        TEXT NOT NULL CHECK (scope IN ('project','user')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','demoted','tombstoned')),
  project_id   TEXT,
  source       TEXT NOT NULL,              -- guideline | claude-code | opencode | human
  use_count    INTEGER NOT NULL DEFAULT 0, -- times surfaced by search
  last_used_at TEXT,                       -- last retrieval, ISO 8601
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  demoted_at   TEXT,
  tombstoned_at TEXT
);
CREATE INDEX idx_memory_atoms_retrieval ON memory_atoms (scope, kind, status, project_id);
```

`memory_event_log` — append-only audit trail (unchanged from today):

```sql
CREATE TABLE memory_event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  atom_id    TEXT,
  event_type TEXT NOT NULL,   -- ingested | created | demoted | tombstoned | resurrected | forgotten | superseded
  actor      TEXT NOT NULL CHECK (actor IN ('system','human')),
  reason     TEXT,
  metadata   TEXT NOT NULL DEFAULT '{}',
  timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Every status transition and every ingestion MUST emit an event. The log is
append-only: rows are never updated or deleted. This gives a complete, auditable
history of why any atom is in its current state — essential when a human is
deciding whether to trust or forget a memory.

---

## 7. Ingestion — Guidelines

Guidelines are the canonical layer: human-authored markdown that states the
project's technology choices and conventions. They are ingested automatically
and kept in sync deterministically — no LLM involved.

### 7.1 Trigger

Guideline ingestion runs:

- automatically before a workflow run, and
- on demand via `hamilton memory ingest --guidelines`.

### 7.2 Change Detection and Sync

For each guideline instruction file:

1. Normalize line endings and compute `sha256(content)`.
2. Look up the most recent `ingested` event for this `source_ref` in
   `memory_event_log` and read its stored `file_hash`.
3. If **no prior hash** → new file: write a `guideline` atom, emit `ingested`.
4. If **hash differs** → changed file: tombstone the prior atom(s) for this
   `source_ref`, write a new atom, emit `ingested` and `superseded`.
5. If **hash matches** → unchanged: skip.

This is idempotent: re-running ingestion over unchanged guidelines is a no-op,
and editing a guideline replaces exactly its atom. This mechanism exists in
`src/memory/guidelines.ts` today and is retained as-is, with the only change
being `kind: canonical` → `kind: guideline`.

### 7.3 Guarantees

- Guideline atoms are `kind: guideline` and are **never** retired by the
  lifecycle manager (§10.1).
- Guideline atoms are always eligible for injection (§9.2, Step 1).
- Guideline atoms are only ever removed by (a) their source file changing
  (supersede) or (b) an explicit human forget.

---

## 8. Ingestion — Session Review Daemon

The daemon is the autonomous path: it reads what agents actually did and distills
durable knowledge from it. It runs independently of any workflow — a Hamilton
run MUST NOT block on it.

### 8.1 Responsibilities

```
   discover new sessions ─▶ extract candidates ─▶ validate & dedupe ─▶ write atoms ─▶ mark session processed
   (Claude Code, opencode)   (fast model)          (strong model,        (MemoryWriter)
                                                     qmd dedupe)
```

The daemon is a long-running process (`hamilton memory daemon start`) that wakes
periodically, discovers sessions it has not yet processed, and runs the pipeline
per session. It also runs the maintenance pass in §10.

### 8.2 Source Adapters

Each external agent stores session transcripts in its own on-disk format. A
`SessionSource` adapter normalizes them into a common shape so the extraction
pipeline is agent-agnostic:

```typescript
interface SessionSource {
  name: "claude-code" | "opencode"
  discover(since: Date): Promise<SessionRef[]>   // new/updated sessions
  read(ref: SessionRef): Promise<NormalizedSession>
}

interface NormalizedSession {
  sessionId: string
  agent: string
  projectId: string        // resolved from the session's cwd / repo root
  startedAt: string
  endedAt: string
  task: string             // the initiating prompt / goal
  events: SessionEvent[]   // ordered: user turns, agent turns, tool calls+results, errors
}
```

Adding a third agent later is one new adapter — the pipeline downstream does not
change. The set of processed sessions is tracked in SQLite (an
`ingested`-style event per session id) so discovery is incremental and a session
is never processed twice.

### 8.3 Extraction — Two Stages

Extraction is deliberately two-stage to control both cost and quality:

**Stage 1 — Candidate extraction (fast model).** Given one normalized session,
propose draft atoms. The fast model sees only the session, never the existing
store, so it cannot merely echo what is already stored. It emits a JSON array:

```json
{ "kind": "correction|decision|pattern", "scope": "project|user",
  "title": "<short>", "content": "<markdown>", "tags": ["..."] }
```

It SHOULD prefer a few high-signal candidates over many weak ones, and it MUST
NOT propose `guideline` atoms (those come only from §7).

**Stage 2 — Validation and deduplication (strong model).** For each candidate,
retrieve the top-K existing atoms of the same kind/scope from qmd (semantic
search on the candidate's content) and decide:

- **accept** — novel and useful → write a new atom.
- **reject** — vague, trivial, or already covered → drop, log the reason.
- **supersede** — refines or contradicts an existing atom → write the new atom
  with `supersedes: [<old id>]` and tombstone the old one.

`correction` candidates carry the highest signal (an agent was demonstrably
wrong) and SHOULD clear a lower acceptance bar than `decision` or `pattern`.

### 8.4 Writing

Accepted candidates are written through the `MemoryStore` write path (§5.3)
using the write-consistency protocol in §5.4, with `source` set to the
originating agent. Supersede writes
tombstone the old atom in the same pass and emit `superseded`. Each written atom
emits a `created` event recording the session it came from, so every autonomous
memory is traceable to its origin.

### 8.5 Degradation

The daemon MUST degrade gracefully: if the strong model is unavailable it holds
candidates for the next pass rather than accepting them unvalidated; if qmd is
unavailable it retries with backoff; a single malformed session is quarantined
and skipped, never failing the batch.

---

## 9. Retrieval and the MCP Surface

Retrieval is the read side. It has exactly two output shapes, per the core
requirement: **atom file paths**, or **one combined markdown context**.

### 9.1 Two Return Shapes

```typescript
type RetrievalMode = "paths" | "context"
```

- **`paths`** — returns `[{ id, title, path, kind, score }]`. The caller loads
  the files itself, when and if it needs them. This is the low-token shape for
  agents that manage their own context window (external agents via MCP typically
  prefer this).
- **`context`** — returns a single markdown string that concatenates the full
  body of every retrieved atom under typed section headers (guidelines first,
  then corrections, decisions, patterns), ready to paste into a system prompt.
  This is the shape Hamilton's own runner injects.

Both shapes come from the same underlying query; only the serialization differs.
Whenever atoms are surfaced, `recordRetrieval` is called for their ids so
retirement (§10) reflects true usage.

### 9.2 Retrieval Strategy

For a given session (task prompt, `project_id`, detected languages/tags):

1. **Guidelines first.** All `active` `guideline` atoms in scope MUST be
   eligible; they are the canonical layer. In `context` mode they head the
   output.
2. **Corrections.** All `active` `correction` atoms for the project SHOULD be
   included — repeating a known mistake is the failure mode memory exists to
   prevent.
3. **Semantic recall.** `decision` and `pattern` atoms are retrieved by qmd
   hybrid search against the task prompt, top-K by score.
4. **Cap.** If `context` mode would exceed a configured token budget, trim from
   the lowest-scoring `decision`/`pattern` atoms first. Guidelines and
   corrections are never trimmed. Trimmed atoms remain reachable via `paths` /
   `search`.

### 9.3 MCP Tools

Hamilton's MCP server (`src/mcp/server.ts`) exposes the memory read surface so
any coding agent can consume it. All tools call the same `MemoryStore` behind
the scenes.

| Tool               | Purpose                                                        | Returns |
|--------------------|----------------------------------------------------------------|---------|
| `memory_search`    | Relevance search over active atoms.                            | `mode="paths"` → hits; `mode="context"` → markdown string |
| `memory_get`       | Fetch one atom's full content by id.                           | atom    |
| `memory_forget`    | Tombstone an atom by id (see §10.2).                           | ack     |

`memory_search` inputs: `query: string`, `mode: "paths" | "context"` (default
`paths`), `scope?`, `kind?`, `project_id?`, `limit?`. This single tool satisfies
the "return only the file path, or a combined markdown context" requirement via
its `mode` parameter — no duplicate tools.

Hamilton's own runner does not go through MCP; it calls `MemoryStore.search`
directly and injects the `context` output, exactly as it injects
`buildMemoryContext` today.

---

## 10. Lifecycle — Retirement and Forgetting

### 10.1 Retirement by Retrieval Activity

Autonomously-created atoms that stop being retrieved are retired so the store
stays relevant. Retirement is driven by observed **retrieval activity**, not a
stored quality score.

Every time `search` surfaces an atom, `recordRetrieval` increments its
`use_count` and sets `last_used_at`. The lifecycle manager's maintenance pass
(run by the daemon on a schedule, default every 6 hours) applies a two-stage
decay:

**Stage 1 — active → demoted.** An atom is demoted when all hold:

- `kind ≠ guideline` (guidelines are exempt), and
- `status = active`, and
- `age > MIN_AGE` (default 30 days — do not judge new atoms), and
- it has not been retrieved recently: `last_used_at` is null or older than
  `STALE_WINDOW` (default 45 days).

Demotion excludes the atom from injection but keeps it searchable on demand, so
a demotion is recoverable if the atom turns out to matter after all (retrieving
it refreshes `last_used_at`).

**Stage 2 — demoted → tombstoned.** A demoted atom is retired when
`now − demoted_at > GRACE_WINDOW` (default 45 days) and it was not retrieved
during the grace period. Tombstoning removes the file from qmd's index; the
SQLite row and audit trail are retained.

**Guideline exemption is absolute.** No `guideline` atom is ever demoted or
tombstoned by this pass — only by a source change (§7.2) or a human forget.

> The thresholds above are the retirement policy's only knobs and are all
> configurable (§11). "Retrieval rate" is realized here as recency-of-use
> (`last_used_at`) plus `use_count`; a stricter offered-vs-surfaced ratio is
> possible later but is deliberately not required for v1 — recency is sufficient
> to retire dead weight and is cheap to track.

### 10.2 Forgetting

A human MUST be able to forget any atom immediately:

```
hamilton memory forget <atom-id>          # CLI
memory_forget(id)                          # MCP tool
```

Forgetting tombstones the atom regardless of kind or status — including
guidelines — sets `tombstoned_at`, removes it from qmd's index, and emits a
`forgotten` event with `actor: human`. The atom is excluded from all retrieval
on the next query. Forget is the human's absolute override; it is the one action
that can retire a guideline.

### 10.3 Human Overrides

Beyond forget, humans retain last-resort control:

- `hamilton memory list [--kind --scope --status]` — inspect the store from
  SQLite metadata.
- `hamilton memory show <id>` — print an atom's content from qmd.
- `hamilton memory edit <id>` — edit an atom's body/tags in place; sets
  `source: human`, re-indexes, emits `updated`.
- `hamilton memory resurrect <id>` — return a demoted/tombstoned atom to
  `active`, re-index, emit `resurrected`.

Every human action emits an audit event. The store is agent-managed by default
but human-governed at the edges.

---

## 11. Configuration

Memory settings live under a `memory` key in Hamilton's settings, all with
defaults so the system works out of the box:

```yaml
memory:
  enabled: true
  daemon:
    interval_minutes: 360           # maintenance + session review cadence
    sources: [claude-code, opencode]
  models:
    fast: default                   # Stage 1 candidate extraction
    strong: default                 # Stage 2 validation
  retrieval:
    context_token_budget: 4000      # cap for `context` mode
    semantic_limit: 5               # top-K for decision/pattern recall
  retirement:
    min_age_days: 30
    stale_window_days: 45
    grace_window_days: 45
```

If memory is disabled or the store is unavailable, agents run without memory
context — degradation is graceful, matching today's behavior.

---

## 12. CLI Surface

```
hamilton memory
├── ingest --guidelines            # ingest/sync guideline files (exists today)
├── daemon start|stop|status       # session-review + maintenance daemon
├── search <query> [--mode ...]    # inspect retrieval as an agent would see it
├── list [--kind --scope --status] # metadata listing from SQLite
├── show <id>                      # print atom content
├── edit <id> [--content --tags]   # human edit
├── forget <id>                    # tombstone (any kind)
└── resurrect <id>                 # restore a demoted/tombstoned atom
```

---

## 13. Phasing

| Phase | Deliverable                                                                                  | Status |
|-------|----------------------------------------------------------------------------------------------|--------|
| 1     | Guideline → canonical ingestion, dual store, retrieval + prompt injection.                   | **Done** |
| 2     | Taxonomy migration (`canonical`→`guideline`, drop unused kinds); project scope.              | Planned |
| 3     | `MemoryStore` port consolidation; `memory_search`/`memory_get`/`memory_forget` MCP tools; `context`/`paths` modes. | Planned |
| 4     | Session-review daemon: opencode + Claude Code adapters, two-stage extraction, write path.    | Planned |
| 5     | Retrieval-activity tracking + two-stage retirement + forget/resurrect CLI.                   | Planned |

Phases 3, 4, and 5 are independent once Phase 2 lands: the MCP surface, the
daemon, and the lifecycle manager each depend only on the `MemoryStore` port,
not on each other.

---

## 14. Open Questions

1. **Taxonomy migration.** Today's `CHECK` constraint allows six kinds. Do we
   migrate existing rows (`canonical`→`guideline`, collapse `failure` into
   `correction`, drop `fact`/`procedure`/`preference`), or keep them permitted
   and merely stop producing them? Recommendation: migrate — a small, clean
   vocabulary is worth a one-time migration while the store is still small.
2. **`failure` as a distinct kind.** This RFC folds failures into `correction`.
   If "what *not* to do, and why" proves to need different retrieval treatment
   than "what was wrong and the fix," `failure` may warrant reinstatement.
3. **Retrieval rate precision.** v1 uses recency-of-use. Is a true
   offered-vs-surfaced ratio (requiring logging of every candidate set) worth
   the extra bookkeeping later?
4. **Session discovery contract.** What exactly do Claude Code and opencode
   write to disk, and where, that a `SessionSource` adapter reads? This needs a
   concrete survey of both tools' transcript formats before Phase 4.
5. **Project store fan-out.** One qmd store per project vs. one store with a
   `project_id` filter. Per-project stores isolate cleanly but multiply
   `qmd.db` files; a single store centralizes but leans on filtering. Lean
   toward a single store unless qmd's per-collection ergonomics push otherwise.

---

## 15. Appendix: Divergences from Today's Code

Concrete deltas between this RFC and the implementation, to scope the work:

| Area              | Today                                                            | This RFC                                              |
|-------------------|-----------------------------------------------------------------|-------------------------------------------------------|
| Kinds             | `canonical` produced; schema allows 6                           | `guideline` produced; schema allows 4                 |
| Confidence        | Hardcoded `1.0` in frontmatter; `confidence` column present     | Removed from frontmatter; column dropped              |
| Scope             | `user` only (`createUserMemoryStore`)                           | `user` + `project`                                    |
| Store interface   | `MemoryReader`/`MemoryWriter`, user/canonical only              | Unified `MemoryStore` port; project + all kinds       |
| Retrieval output  | `buildMemoryContext` (context only)                             | `context` **and** `paths` modes                       |
| MCP               | No memory tools                                                 | `memory_search`, `memory_get`, `memory_forget`        |
| Autonomous ingest | None                                                            | Session-review daemon (Claude Code, opencode)         |
| Retirement        | `salience`/`use_count`/`last_used_at` columns unused            | Retrieval-activity two-stage retirement               |
| Forget            | `tombstone` exists on writer; no CLI/tool                       | `hamilton memory forget` + `memory_forget` MCP tool   |
| Curator           | Suggests retrieval filters (tags/langs) at task start           | Retained for retrieval filtering; extraction is separate two-stage pipeline |
```
