# RFC-001: Hamilton Agent Long-Term Memory

| Field        | Value                                                              |
|-------------|--------------------------------------------------------------------|
| RFC Number  | 001                                                                |
| Title       | Hamilton Agent Long-Term Memory                                    |
| Status      | Draft                                                              |
| Created     | 2026-06-26                                                         |
| Authors     | Agent Memory Working Group                                         |
| Storage     | `@tobilu/qmd` (content + hybrid search) + Hamilton `bun:sqlite` DB (metadata) |

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Motivation](#2-motivation)
3. [Memory Taxonomy](#3-memory-taxonomy)
4. [Autonomous Memory Pipeline](#4-autonomous-memory-pipeline)
5. [Content Ingest Pipeline](#5-content-ingest-pipeline)
6. [Context Injection](#6-context-injection)
7. [Salience Model & Demotion Protocol](#7-salience-model--demotion-protocol)
8. [Corrections & Failures as First-Class Memory](#8-corrections--failures-as-first-class-memory)
9. [Human Override & Editing](#9-human-override--editing)
10. [qmd + Hamilton DB Integration](#10-qmd--hamilton-db-integration)
11. [Observation Collection — Dual Source](#11-observation-collection--dual-source)
12. [The Memory Daemon](#12-the-memory-daemon)
13. [LLM Client & The Curator](#13-llm-client--the-curator)
14. [CLI Commands](#14-cli-commands)
15. [Open Questions](#15-open-questions)
16. [Appendix](#16-appendix)

---

## 1. Abstract

Hamilton workflows execute across multiple runs, but each run begins with zero durable knowledge of past failures, established conventions, or user preferences. This RFC proposes a structured long-term memory system that persists knowledge across runs, surfaces the right facts at the right time, and gives corrections and failures privileged treatment.

The system is organised around **atoms** — typed, versioned, confidence-scored memory units — stored in two layers: **qmd** (`@tobilu/qmd`) manages markdown files with YAML frontmatter and provides hybrid full-text + vector search; **Hamilton's existing `bun:sqlite` database** (`~/.hamilton/hamilton.db`) manages atom metadata (salience, use counts, status). Atom content lives in qmd; administrative state lives in Hamilton's DB.

Observations are collected from two sources: Hamilton's own runs (via the EventBus and `on_workflow_completed` hook) and external coding agents (via a shared inbox at `~/.hamilton/memory/inbox/`). A **memory daemon** watches the inbox and runs the autonomous extraction pipeline — Phases 2 through 5 — independently of any active run.

Context injection uses Hamilton's Pi SDK `DefaultResourceLoader` to feed memory atoms into the agent's system prompt at the start of each task. Memory tools (`hmemory_query`, `hmemory_get`, `hmemory_record`, `hmemory_relevant`) are exposed both as MCP tools in Hamilton's MCP server and as Pi SDK extensions for Hamilton's own agents.

---

## 2. Motivation

### 2.1 The Three Failure Time-Scales

Coding agent failures manifest at three distinct time-scales, each requiring a different mitigation strategy:

**Time-scale 1 — Single Tool Call (microseconds to seconds)**
A single tool call fails or returns unexpected output. The agent SHOULD retry with adjusted parameters, read the error message, and adapt within the same context window. This is the easiest failure mode to handle because all relevant context is immediately visible.

**Time-scale 2 — Intra-Run Drift (minutes to hours)**
Over the course of a long run, the agent loses track of earlier decisions, starts contradicting its own work, or forgets user corrections given thirty messages ago. Hamilton's per-task `TodoListUpdated` events and structured task outputs partially address this, but no mechanism prevents cross-task amnesia within a run.

**Time-scale 3 — Cross-Run Amnesia (hours to days to forever)**
The agent completes a run, the Pi session is disposed, and all learned knowledge vanishes. In the next run the agent repeats the same mistakes, asks the same questions, violates the same conventions, and ignores the same user preferences. **This is the hardest failure mode** because there is no in-context signal that anything was ever known. The agent does not know what it does not remember.

Cross-run amnesia is particularly damaging in Hamilton's workflow context because:

- Multi-step workflows (plan → implement → review) accrue knowledge across tasks that is lost between runs.
- Code style preferences are enforced across every file touched, in every task.
- Repeated mistakes waste user trust at a compounding rate.
- Failure patterns from tool calls (e.g. a specific API always requires a header the agent keeps forgetting) never improve without memory.

### 2.2 Why Flat MEMORY.md Files Do Not Scale

A naive solution is to maintain a single `MEMORY.md` file that the agent appends to at run end and reads at run start. This approach fails at scale for several reasons:

1. **Context consumption.** A `MEMORY.md` file injected wholesale into the system prompt grows linearly with agent age. After dozens of runs it consumes a significant fraction of the context budget, leaving less room for the actual task.

2. **No retrieval selectivity.** All remembered facts are equally visible regardless of relevance. A fact about project A's database schema should not consume context tokens during project B's frontend work.

3. **No confidence or quality tracking.** There is no mechanism to distinguish a well-validated fact from a speculative hypothesis the agent once wrote down. Over time, low-quality entries pollute the store.

4. **No deduplication.** The same fact gets appended multiple times across runs, inflating the file without adding information.

5. **Brittle to corruption.** A single malformed append can corrupt the entire file's utility.

6. **No audit trail.** When the agent acts on a wrong memory, there is no way to trace where that memory came from or when it was written.

### 2.3 Why Corrections and Failures Must Be First-Class

When a user corrects the agent — "you used the wrong config file format; we always use TOML not JSON" — that correction represents the highest-signal fact available: the agent was definitively wrong, and the user supplied the correct answer. This signal MUST survive every pruning, demotion, and summarisation pass. Treating corrections as ordinary facts (equally subject to salience decay) guarantees they will eventually be forgotten, restoring the failure mode they were meant to prevent.

Failures — failed tool call patterns, incorrect assumption sequences, loops the agent fell into — are the negative complement of corrections. Recording why an approach failed, not just what the correct answer is, gives the agent the ability to reason about its own error modes rather than simply substituting one rote answer for another.

### 2.4 Why Both Hamilton and Non-Hamilton Agents Need Memory

Hamilton is one agent among several that a developer might use. A developer may run Hamilton workflows but also use Claude Code, Copilot, or Cursor. Corrections learned in one agent (e.g. "this project uses TOML, not JSON" learned in Cursor) should benefit all agents, including Hamilton. Conversely, facts learned during a Hamilton run should be available when the developer switches to Claude Code.

The memory system MUST accept observations from any coding agent that writes to a shared inbox (`~/.hamilton/memory/inbox/`). Hamilton's own runs are one source among many. The daemon that processes observations is agent-agnostic — it does not care which tool produced the observations, only that they conform to the observation schema.

---

## 3. Memory Taxonomy

### 3.1 Scopes

Every atom belongs to exactly one of two scopes:

**Project-level scope (`project`)**
Facts tied to a specific codebase: patterns used in that codebase, known bugs in that system, architectural decisions, corrections made during work on that project, project-specific conventions. Project-scope atoms are stored in a per-project qmd store keyed by `project_id`. They are irrelevant to other projects and MUST NOT be injected in sessions for different projects.

In Hamilton, `project_id` is resolved at run start:
1. If a git repository is detected, `project_id` = the repository root path (from `git rev-parse --show-toplevel`).
2. If no git repository, `project_id` = the current working directory.
3. For external agents, `project_id` is specified in the observation log metadata by the agent that produced it.

**User-level scope (`user`)**
Facts that travel across projects: the user's style preferences, preferred tooling, interaction patterns, general recurring mistakes the agent makes with this user, cross-project procedures the agent has mastered. User-scope atoms are stored in a single shared qmd store at `~/.hamilton/memory/user/`. They SHOULD be injected in all sessions regardless of project.

### 3.2 Memory Kinds

The following kinds are defined. Each is a first-class type with distinct injection priority, demotion rules, and validation requirements.

| Kind         | Description                                                                          | Scope          | Auto-prune? | Injection Priority |
|--------------|--------------------------------------------------------------------------------------|----------------|-------------|-------------------|
| `correction` | A mistake the agent made plus the correct answer. Ground-truth signal.               | project / user | No          | 1 (highest)       |
| `failure`    | A failed approach, tool call pattern, or reasoning loop. Companion to correction.    | project / user | No          | 2                 |
| `canonical`  | Ground-truth ingested from a human-authored file. Never auto-modified.               | project / user | No          | 3 (search-ranked) |
| `procedure`  | A repeatable procedure or multi-step workflow the agent has mastered.                | project / user | Yes         | 4                 |
| `fact`       | A project architectural or domain fact (schema shape, API endpoint, env var name).   | project        | Yes         | 5                 |
| `preference` | User style or tooling preference (indentation, commit message format, tool choice).  | user           | Yes         | 6                 |

### 3.3 Atom Schema — Dual Layer

Each memory atom exists in two storage layers simultaneously:

**qmd Layer (content — source of truth for search)**
Atoms are stored as markdown files with YAML frontmatter, queried by qmd. The frontmatter contains all fields visible to qmd's hybrid search. Atom files follow the directory structure:

```
~/.hamilton/memory/projects/<project_id>/<kind>/<slugified-title>-<id>.md
~/.hamilton/memory/user/<kind>/<slugified-title>-<id>.md
```

**Frontmatter:**

```
id          : string   — nanoid (21-character URL-safe string). Immutable after creation.
title       : string   — Short human-readable title. Generated by Phase 3 strong model.
kind        : enum     — One of: correction, failure, preference, fact, procedure, canonical
scope       : enum     — One of: project | user
source      : enum     — How this atom was created:
                           autonomous — created by the daemon extraction pipeline (Phase 2-5)
                           human      — created via `hmemory_record`, `hamilton memory ingest <path>`, or human edit
                           guideline  — ingested by the guideline pipeline (automatic at workflow start or via `hamilton memory ingest --guidelines`)
confidence  : float    — [0.0, 1.0]. Estimate of atom accuracy.
                          canonical: always 1.0.
                          correction/failure: only lowered by human action or
                            a contradicting correction atom (see §8).
status      : enum     — One of: active | demoted | tombstoned
created_at  : datetime — ISO 8601 with timezone. Set at creation; immutable.
updated_at  : datetime — ISO 8601 with timezone. Updated on every write.
project_id  : string   — The project this atom belongs to. NULL for user-scope atoms.
tags        : string[] — Free-form tags for filtering and grouping.
demoted_at     : datetime — Timestamp when status was set to demoted. NULL if never.
tombstoned_at  : datetime — Timestamp when status was set to tombstoned. NULL if never.
contradicts    : string[] — List of atom IDs this atom contradicts or supersedes.
```

**Hamilton Database Layer (metadata — administrative state)**

Hamilton's `bun:sqlite` database (`~/.hamilton/hamilton.db`) tracks a `memory_atoms` table for lifecycle management, use tracking, and salience computation. This table does NOT store atom content — content lives exclusively in qmd's markdown files. The `path` column links to the qmd-managed .md file.

```sql
CREATE TABLE memory_atoms (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,                    -- qmd:// URI to the .md file (e.g. qmd://projects/<id>/corrections/<slug>-<id>.md)
  kind TEXT NOT NULL CHECK (kind IN ('correction','failure','preference','fact','procedure','canonical')),
  scope TEXT NOT NULL CHECK (scope IN ('project','user')),
  confidence REAL NOT NULL DEFAULT 0.5,
  salience REAL,                         -- computed by daemon; NULL until first maintenance pass
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

The `memory_atoms` and `memory_event_log` tables are added via Hamilton's existing migration system (`src/db/migrations.ts`) as migration v8.

**Rationale for dual-layer storage:** qmd provides hybrid search (BM25 + vector + RRF fusion) and LLM reranking — a query engine Hamilton should not rebuild. Hamilton's DB provides lifecycle management (use tracking, salience, status transitions) that integrates naturally with the existing subscriber pattern (`src/db/subscribers.ts`). Queries that need both search and metadata join across layers: search in qmd, enrich from Hamilton DB by atom ID.

### 3.4 Markdown Body

Content: The memory's substance, written in markdown. For `correction`: includes both the mistake and the fix. For `failure`: includes the failed pattern and (if known) the cause.

---

## 4. Autonomous Memory Pipeline

The autonomous pipeline processes observations and produces atoms. It is triggered when the memory daemon detects new observation files in the inbox (`~/.hamilton/memory/inbox/`). The daemon runs asynchronously — Hamilton runs MUST NOT block waiting for memory writes to complete.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                       AUTONOMOUS MEMORY PIPELINE                               │
│                                                                                │
│  Inbox observation files                                                       │
│         │                                                                      │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 1    │  Observation files written by agents                         │
│  │  (external) │  Hamilton: on_workflow_completed hook → inbox/<runId>.jsonl  │
│  │             │  External agents: any tool → inbox/<agent>/<timestamp>.jsonl │
│  └──────┬──────┘                                                               │
│         │ daemon detects new file in inbox                                    │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 2    │  Candidate Extraction (Fast Model)                            │
│  │  Fast LLM   │  Proposes draft atoms from observation log                   │
│  └──────┬──────┘                                                               │
│         │ draft atoms (JSON array)                                           │
│         ▼                                                                      │
│  ┌─────────────┐   ◄── qmd hybrid search on each candidate                    │
│  │  Phase 3    │                                                               │
│  │  Strong LLM │  Validation & Deduplication                                  │
│  └──────┬──────┘                                                               │
│         │ validated atoms + rejected list                                    │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 4    │  Hamilton DB insert (pending) → file writes → batch qmd embed → active │
│  │  Dual write │  Markdown file (Hamilton writes) → qmd embed → memory_atoms row│
│  └──────┬──────┘                                                               │
│         │ accepted atoms                                                     │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 5    │  Session Summary Fold                                         │
│  │  Audit      │  Append to ~/.hamilton/memory/sessions/<project_id>/YYYY-MM.md│
│  └─────────────┘                                                               │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Phase 1 — Observation Writing (External to Pipeline)

Observations are written to `~/.hamilton/memory/inbox/` by agents. The daemon does not produce observations — it consumes them.

**For Hamilton runs:**

Hamilton is an autonomous agent — it starts with a goal and runs independently. It does not receive user corrections or feedback mid-run. Hamilton produces observations from two sources:

*Guideline ingestion (canonical memory):*

Hamilton's guideline system (`src/guidelines/`) loads project-specific instruction files at workflow start. These files are authoritative reference material. A dedicated **guideline pipeline** — built on top of the curator (§13) and the content ingest pipeline (§5) — runs as a step before the workflow runner. It handles change detection, re-ingestion, and canonical atom lifecycle:

1. Load guideline files via `src/guidelines/loader.ts`.
2. For each file, compute the SHA-256 hash and query `memory_event_log` for the most recent `ingested` event: `SELECT metadata FROM memory_event_log WHERE event_type = 'ingested' AND json_extract(metadata, '$.source') = 'guideline' AND json_extract(metadata, '$.source_path') = ? ORDER BY timestamp DESC LIMIT 1`.
3. If absent → new file, run content ingest (§5) with `source: guideline`.
4. If hash differs → file changed, tombstone old canonical atoms for this source_path, re-ingest.
5. If hash matches → skip.
6. After ingestion: INSERT an `ingested` event into `memory_event_log` with metadata: `{"source": "guideline", "source_path": "<path>", "file_hash": "<sha256>", "scope": "project"}`.

This ensures guideline files are always present as canonical memory atoms without manual `hamilton memory ingest` commands. The guideline pipeline is implemented at `src/memory/guidelines.ts` — the workflow runner calls into it, it does not own the logic.

*Run-time observations (EventBus):*
During a workflow run, a new `ObservationCollector` subscriber on Hamilton's EventBus (`src/events/bus.ts`) buffers observations in memory. On `on_workflow_completed`, the subscriber serializes the buffer to `~/.hamilton/memory/inbox/hamilton/<runId>.jsonl` using the standard observation schema below.

Observation mapping from Hamilton events:

| Observation kind    | Collected from Hamilton event(s)                                                   |
|---------------------|------------------------------------------------------------------------------------|
| `tool_call`         | `ToolCall` + `ToolResult` events — tool_name, arguments (summary), result (summary, truncated), success (ToolResult.isError inverted), duration_ms. |
| `error_encountered` | `TaskFailed` events and `ToolResult` with `isError: true` — error_type, error_message, context. |
| `pattern_repeated`  | Count repeated `ToolCall` events with same tool_name + similar arguments within a single task. Threshold: N=3. |
| `decision_made`     | `LlmMessage` content analysis for architectural or implementation decisions containing rationale or trade-off discussion. Detected via keyword patterns (e.g. "I'll use", "the approach is", "we should"). |

**For external agents:**
Any coding agent writes a JSONL file to `~/.hamilton/memory/inbox/<agent-name>/<timestamp>.jsonl` using the same observation schema. External agents MAY also include `user_correction` and `user_feedback` observations (which Hamilton does not produce).

**Observation log format (standard JSONL):**

Each observation is a JSON object on its own line. The file begins with a header object containing session metadata.

```jsonl
{"type":"header","session_id":"<uuid or hamilton-run-id>","project_id":"<path or slug>","agent_name":"hamilton|claude|copilot|...","started_at":"<ISO 8601>","ended_at":"<ISO 8601>","task_description":"<initial task prompt>"}
{"type":"tool_call","tool_name":"bash","arguments":"npm test","result":"Tests passed...","success":true,"duration_ms":3420}
{"type":"tool_call","tool_name":"write","arguments":"src/app.ts (content omitted)","result":"File written","success":true,"duration_ms":12}
{"type":"user_correction","agent_statement":"I'll write the config as JSON.","correction_text":"No, we use TOML for all config files.","turn_index":4}
{"type":"error_encountered","error_type":"ToolResultError","error_message":"ENOENT: no such file or directory","context":"Reading output.json after write_task_output"}
{"type":"pattern_repeated","tool_name":"bash","pattern_description":"npm test without npm install","repeat_count":3}
{"type":"decision_made","decision_text":"Using Effect-TS for error handling across the codebase.","rationale":"Already used in the project; provides typed errors and retry.","alternatives_considered":"try/catch, neverthrow"}
```

### 4.2 Phase 2 — Candidate Extraction (Fast Model)

A lightweight language model receives the observation log and MUST produce a JSON array of draft atoms. The fast model has NO access to the existing memory store — it only sees the observations. This isolation prevents the fast model from producing biased candidates that simply echo what is already stored.

**Fast model prompt contract:**

The prompt MUST include:
- The observation log (as formatted text)
- The task description
- The atom schema definition
- Instructions to propose candidates only for observations that represent durable, reusable knowledge

The fast model MUST output a JSON array. Each element MUST conform to:

```json
{
  "kind": "<correction|failure|preference|fact|procedure>",
  "scope": "<project|user>",
  "content": "<markdown text>",
  "confidence": <float 0.0–1.0>,
  "tags": ["<tag>", ...],
  "source_observation_indices": [<int>, ...]
}
```

Notes:
- `canonical` kind MUST NOT be proposed by the fast model (canonical atoms come only from the guideline pipeline).
- The fast model SHOULD be instructed to prefer fewer high-confidence candidates over many low-confidence ones.
- `confidence` at this stage is a coarse estimate; Phase 3 adjusts it.
- `source_observation_indices` links each candidate back to the observation(s) that motivated it, for audit purposes.

**Quantity limits:** The fast model MUST NOT propose more than 20 candidates per session. If the observation log suggests more than 20 candidates, the model MUST prioritise by kind: all `correction` and `failure` candidates first, then others ranked by estimated confidence.

### 4.3 Phase 3 — Validation & Deduplication (Strong Model)

A stronger language model receives the draft candidates from Phase 2 and MUST validate, deduplicate, and finalise them before any write occurs.

**Inputs to the strong model:**

1. The full list of draft candidates from Phase 2.
2. For each candidate: the top-5 existing atoms retrieved from qmd via hybrid search on the candidate's `content`. This retrieval MUST use `store.search()` with the candidate content as query, filtered to the appropriate scope and kind.
3. The session metadata (session_id, project_id, task_description).

**Strong model responsibilities:**

For each candidate the strong model MUST make one of the following decisions:

- **`accept`** — The candidate is valid, novel, and useful. Write it as a new atom.
- **`reject`** — The candidate is invalid, trivially obvious, too vague, or already well-covered by an existing atom. Do not write.
- **`merge`** — The candidate is a near-duplicate or refinement of an existing atom. The strong model MUST generate a new `title` and new nanoid `id` for the merged atom (reflecting the combined knowledge). The merged atom supersedes the old atom: the old atom is tombstoned with reason `merged`, and a new atom is created. The existing atom's `id` MUST be referenced in `merge_target_id`.
- **`supersede`** — The candidate contradicts an existing atom (especially relevant for `correction` and `failure`). Accept the new candidate, tombstone the old atom, and add the old atom's ID to the new atom's `contradicts` list.

**Acceptance criteria for each kind:**

| Kind         | Acceptance bar                                                                           |
|--------------|------------------------------------------------------------------------------------------|
| `correction` | MUST be accepted unless the strong model can provide explicit written justification for rejection. Candidate must reference a specific agent mistake. |
| `failure`    | Same as correction. High bar for rejection. Failure pattern must be specific and reproducible. |
| `fact`       | Must be verifiably derivable from the session observations. Vague or speculative facts MUST be rejected. |
| `procedure`  | Must describe a complete, repeatable procedure. Partial workflows MUST be rejected.       |
| `preference` | Must be grounded in an explicit user statement or repeated demonstrated behaviour.        |

**Confidence adjustment:**

The strong model MUST adjust confidence based on:
- Strength of the supporting evidence in the observation log
- Consistency with existing atoms (supporting evidence → +confidence; contradiction → −confidence)
- Specificity of the content (more specific → higher confidence)
- Whether the candidate is a `correction` or `failure` (these start at minimum 0.75 unless evidence is weak)

**Output format:**

```json
{
  "validated": [
    {
      "decision": "accept|merge|supersede",
      "draft_index": <int>,
      "title": "<short human-readable title for this atom>",
      "kind": "...",
      "scope": "...",
      "content": "<possibly revised markdown>",
      "confidence": <float>,
      "tags": [...],
      "merge_target_id": "<nanoid or null>",
      "contradicts": ["<atom_id>", ...],
      "justification": "<required for correction/failure rejections; optional otherwise>"
    }
  ],
  "rejected": [
    {
      "draft_index": <int>,
      "reason": "<why this candidate was rejected>"
    }
  ]
}
```

### 4.4 Phase 4 — Dual Write (Hamilton writes + batch qmd embed)

After Phase 3 produces the validated list, the pipeline writes all accepted atoms to both stores. The order is transactional with Hamilton DB as the commit point:

**Step A — Hamilton DB insert (commit point):**
1. BEGIN TRANSACTION in Hamilton DB.
2. For each accepted atom: generate a nanoid as `id` (21-character URL-safe string), use the `title` from Phase 3 (slugify for filename), determine the absolute `path` (`<kind>/<slugified-title>-<id>.md`). INSERT into `memory_atoms` with `status = 'pending'`, all metadata columns (`kind`, `scope`, `confidence = NULL`, `project_id`, `run_id`, `created_at`, `updated_at`). `salience` is set to NULL initially.
3. COMMIT. If this fails, abort the entire Phase 4 — nothing is on disk yet.

**Step B — Hamilton writes all .md files:**
4. Populate all required frontmatter fields for each atom. Set `source: autonomous`, `status: active`, `created_at: now`, `updated_at: now`.
5. Hamilton writes each atom markdown file to its `path` within the appropriate qmd store directory. If any individual file write fails, skip that atom (the DB row stays `pending` for recovery).

**Step C — Batch qmd embed:**
6. After all files are written, trigger `qmd embed` once against the store directory to index all new files into the hybrid search engine (BM25 + vectors). A single embed pass is faster than per-file invocations.

**Step D — Finalize:**
7. UPDATE `memory_atoms` SET `status = 'active'` WHERE `status = 'pending'` AND `run_id = ?` for the current run.
8. Emit `MemoryAtomCreated` audit events for each atom via the EventBus. The `DbWriter` subscriber persists them to `memory_event_log`.

**For `merge` decisions:**
1. Generate new `title`, `id`, and `path` for the merged atom.
2. INSERT new row in `memory_atoms` with `status = 'pending'` (Step A).
3. Tombstone the old atom: UPDATE old row to `status = 'tombstoned'`, `tombstoned_at = now`. Load the old .md file, update frontmatter with `status: tombstoned`, `tombstoned_at`.
4. Hamilton writes the new .md file; updates the old .md file (Step B).
5. Batch `qmd embed` picks up both files (new = active, old = tombstoned/excluded) (Step C).
6. Finalize: UPDATE new row to `active` (Step D).
7. Emit `MemoryAtomMerged` audit event referencing both IDs.

**For `supersede` decisions:**
1. Accept the new candidate as per Steps A-D above, populating `contradicts` with the old atom's ID.
2. Tombstone the old atom: UPDATE old row to `status = 'tombstoned'`, update old .md frontmatter, batch `qmd embed`.
3. Emit `MemoryAtomCreated` (new) and `MemoryAtomTombstoned` (old) audit events.

**For `reject` decisions:**
1. No file is written. No DB row is inserted.
2. Emit a `MemoryAtomRejected` audit event including the rejection reason from Phase 3.

**Recovery from `pending` rows:**
During the daemon's maintenance cycle, detect stuck `pending` rows:

```sql
SELECT id, path FROM memory_atoms
WHERE status = 'pending'
  AND created_at < datetime('now', '-5 minutes')
```

For each row:
- If the .md file **exists at `path`**: write succeeded but embed or finalize didn't — re-trigger `qmd embed`, then UPDATE to `status = 'active'`.
- If the .md file is **missing**: file write failed, the atom is lost — tombstone the row: UPDATE `status = 'tombstoned'`, `tombstoned_at = now`, `reason = 'recovery: file missing after crash'`.

### 4.5 Phase 5 — Session Summary Fold

After all writes are complete, the daemon appends a compact structured markdown block to the rolling session fold file at:

```
~/.hamilton/memory/sessions/<project_id>/YYYY-MM.md
```

For user-scope sessions (no project_id), the path is `~/.hamilton/memory/sessions/user/YYYY-MM.md`.

The fold block has the following structure:

```markdown
## <session_id> — <YYYY-MM-DD HH:MM UTC>

**Task:** <task_description, first 200 chars>
**Agent:** <agent_name (hamilton | claude | copilot | ...)>
**Duration:** <session duration>
**Atoms created:** <count>
**Atoms updated:** <count>
**Atoms rejected:** <count>

### New knowledge
- [correction] <brief summary of each accepted correction>
- [failure]    <brief summary of each accepted failure>
- [fact]       <brief summary of each accepted fact>
- [procedure] <brief summary of each accepted procedure>
- [preference] <brief summary of each accepted preference>

### Rejections
- <brief reason for each rejected candidate>
```

The session fold file is NOT a memory store. It MUST NOT be injected into the context window and MUST NOT be searched by the retrieval pipeline. It is a human-readable audit trail of what was learned and when.

---

## 5. Content Ingest Pipeline

The content ingest pipeline ingests external material into the memory store. It is triggered via CLI or by the guideline pipeline:

```
hamilton memory ingest <path> [--scope project|user]   # file or URL
hamilton memory ingest --guidelines                     # all guideline files
```

Two ingestion paths share the same chunking and deduplication logic but produce different atom kinds:

- **Manual ingest** (`hamilton memory ingest <path>`): produces atoms with `source: human`. The atom `kind` (fact, procedure, preference, etc.) is set by the fast model, not `canonical`. These are regular atoms — they decay with salience and may be demoted.
- **Guideline ingest** (`hamilton memory ingest --guidelines` or automatic at workflow start): produces atoms with `source: guideline`, `kind: canonical`, `confidence: 1.0`. Canonical atoms are exempt from salience decay and demotion (§7). The `canonical` kind is only produced by the guideline pipeline.

The chunking, deduplication, and dual-write phases are identical for both paths — only the frontmatter fields differ.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                       CONTENT INGEST PIPELINE                                   │
│                                                                                │
│  Input: file path / URL / raw text                                             │
│         │                                                                      │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 1    │  Parse & Chunk                                                │
│  │             │  ~900 tokens, AST-aware breakpoints                           │
│  └──────┬──────┘                                                               │
│         │ chunk list                                                           │
│         ▼                                                                      │
│  ┌─────────────┐   ◄── qmd vector search per chunk                            │
│  │  Phase 2    │                                                               │
│  │             │  Semantic Deduplication                                       │
│  └──────┬──────┘                                                               │
│         │ deduplicated chunks                                                  │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 3    │  Dual Write (Hamilton writes + qmd embed + Hamilton DB)         │
│  │             │  atoms written and indexed                                     │
│  └──────┬──────┘                                                               │
│         │                                                                      │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 4    │  Confirmation report to user                                 │
│  └─────────────┘                                                               │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Phase 1 — Parse & Chunk

The input source is loaded and chunked:

- Target chunk size: ~900 tokens.
- Overlap: ~15%.
- Smart breakpoints: split at markdown structural boundaries — headings, paragraph boundaries, list item boundaries, fenced code block boundaries. MUST NOT split inside a code fence.
- AST-aware splitting: parse the markdown AST, prefer cuts at heading boundaries.

Each chunk is assigned a zero-indexed `chunk_offset` and a `chunk_hash` (SHA-256 of chunk content).

### 5.2 Phase 2 — Semantic Deduplication

Before writing, each candidate chunk MUST be compared against the existing qmd store using vector similarity search (`store.searchVector()`). qmd handles deduplication internally — Hamilton does not store chunk hashes.

**Deduplication rule:** If any existing canonical atom has cosine similarity ≥ 0.92 with the candidate chunk, the candidate is skipped.

Additionally, before any chunking begins, the ingest pipeline queries `memory_event_log` for the most recent `ingested` event matching the source and source_path and compares the stored `file_hash`. If the hash matches, the file is unchanged and all chunks are skipped.

### 5.3 Phase 3 — Dual Write

Each non-duplicate candidate is written to both stores. Same `pending` → `active` pattern as §4.4. The frontmatter `source` is set to `human` for manual ingest calls, or `guideline` for the guideline pipeline. The atom `kind` follows the path: manual ingest uses the kind determined by the fast model; guideline pipeline always uses `kind: canonical`.

**Hamilton DB insert (commit point):**
1. BEGIN TRANSACTION. INSERT into `memory_atoms` with `status = 'pending'` for all chunks. COMMIT.

**File write + batch qmd embed:**
2. Hamilton writes each chunk as a .md file to `<kind>/<slugified-title>-<id>.md` within the appropriate qmd store directory (e.g. `facts/` for manual ingest, `canonical/` for guidelines).
3. Trigger `qmd embed` once against the store directory to index all new atoms.

**Finalize:**
4. UPDATE `memory_atoms` SET `status = 'active'` WHERE `status = 'pending'`.
5. INSERT an `ingested` event into `memory_event_log` for the ingestion session with metadata: `{"source": "file|url|guideline", "source_path": "<path or URL>", "file_hash": "<sha256>", "scope": "project|user"}`. This serves as the change detection key for future ingestions of the same source.

Recovery for stuck `pending` rows follows the same pattern as §4.4.

### 5.4 Phase 4 — Confirmation

```
Ingest complete.
  Source: docs/code-style-guide.md
  Chunks ingested:  14
  Chunks skipped (near-duplicate): 2
  Atom IDs: [list of created IDs, or first 5 + "... and N more"]
```

---

## 6. Context Injection

At the start of each Hamilton task, the engine MUST retrieve a curated set of atoms and inject them into the agent's context via Pi SDK's `DefaultResourceLoader`. This primes the agent with the most relevant durable knowledge for the current task.

For external agents (via MCP), the same retrieval logic serves `hmemory_relevant` and `hmemory_query` tools.

### 6.1 Retrieval Strategy

The retrieval strategy is applied in order. Steps are not mutually exclusive; the same atom MUST NOT be injected twice.

**Step 1 — Mandatory correction and failure injection**
Query Hamilton DB:
```sql
SELECT id FROM memory_atoms
WHERE kind IN ('correction', 'failure')
  AND status = 'active'
  AND project_id = ?
```
Then call `store.multiGet(ids)` on qmd with the resulting ID list to retrieve full content. There is NO cap on this set — every active correction and failure for the project MUST be injected.

For user-scope, query `WHERE scope = 'user' AND kind IN ('correction', 'failure') AND status = 'active'`.

**Step 2 — Canonical retrieval**
Use `store.search()` on the `canonical` collection with the current task prompt as the query. Retrieve top **K=5** results by hybrid score. Only `active` atoms are considered.

**Step 3 — Fact and procedure retrieval**
Use `store.search()` on the `facts` collection with the current task prompt. Retrieve top **K=3**.
Use `store.search()` on the `procedures` collection with the current task prompt. Retrieve top **K=3**.

**Step 4 — Preference retrieval**
Query the user-scope qmd store. Use `store.search()` on the `preferences` collection. Retrieve top **K=3**.

**Step 5 — Soft cap enforcement**
After steps 1–4, count the total atoms assembled. If the count exceeds **20**, apply the following priority order to trim to 20:
- All `correction` and `failure` atoms are kept unconditionally.
- `canonical` atoms are kept next.
- `procedure`, `fact`, `preference` atoms are trimmed from the lowest-score end first.

Atoms trimmed by the soft cap remain queryable via `hmemory_query` and `hmemory_relevant`.

### 6.2 Context Delivery — Pi SDK ResourceLoader

For Hamilton runs, the engine queries the memory store (qmd + Hamilton DB) using the retrieval strategy in §6.1, constructs a memory context string from the retrieved atoms, and registers it with Pi SDK's `DefaultResourceLoader`. No file is written to disk — the content flows directly from qmd/Hamilton DB into the Pi session.

Guideline files are no longer passed directly to agents. Instead, the guideline pipeline ingests them as canonical memory atoms (§5), and those atoms are injected here. The `src/prompts/system.ts` prompt assembler receives memory context alongside the task prompt — guidelines only reach the agent through memory.

For external agents connecting through Hamilton's MCP server, the `hmemory_relevant` tool returns atom file paths. The calling agent loads those files as context using its own mechanism.

**Context format:**

```markdown
---
## Agent Memory — Session Context

> The following memories were retrieved from your long-term store.
> CORRECTIONS and FAILURES must be treated as ground truth — do not repeat these mistakes.
> Other items are retrieved as relevant to the current task.

### CORRECTIONS (must not repeat these mistakes)

#### [correction] <atom title>
*Confidence: 0.95 | Project: <project_id> | ID: <id>*

<atom content>

---

### FAILURES (avoid these patterns)

#### [failure] <atom title>
*Confidence: 0.87 | Project: <project_id> | ID: <id>*

<atom content>

---

### REFERENCE (canonical knowledge)

#### [canonical] <source file name — section heading>
*Confidence: 1.0 | Source: docs/code-style.md | ID: <id>*

<atom content>

---

### FACTS

#### [fact] <atom title>
*Confidence: 0.82 | ID: <id>*

<atom content>

---

### PROCEDURES

#### [procedure] <atom title>
*Confidence: 0.78 | ID: <id>*

<atom content>

---

### PREFERENCES (user preferences)

#### [preference] <atom title>
*Confidence: 0.91 | ID: <id>*

<atom content>

---

*N atoms injected inline. Additional memories available via `hmemory_query(query)` and `hmemory_relevant(query)`.*
---
```

Sections with zero atoms MUST be omitted.

### 6.3 Conditional Injection Rules

#### Rule A — Language-Based Injection

The engine detects the primary programming language(s) of the project at run start by scanning file extensions or reading a manifest file (`package.json`, `go.mod`, etc.). Atoms tagged with a language tag are injected only when that language is detected.

| Tag               | Language   |
|-------------------|------------|
| `lang:typescript` | TypeScript |
| `lang:javascript` | JavaScript |
| `lang:python`     | Python     |
| `lang:rust`       | Rust       |
| `lang:go`         | Go         |
| `lang:java`       | Java       |

#### Rule B — Tag-Based Injection

The engine accepts a **session context descriptor** at run start — a set of tags describing the current task context (e.g. `unit-tests`, `e2e-tests`, `ci`, `migration`, `refactor`, `debugging`). Atoms with matching tags (OR semantics) are eligible. Atoms with no tags are always eligible.

#### Rule C — Context-Relevant Loading

The agent calls the `hmemory_relevant` Pi extension tool (or MCP tool for external agents) with the current file path and relevant tags. The tool returns `{ id, title, path, kind, score }` results for atoms most relevant to the current context. The agent loads the atoms at those paths as additional context.

This mechanism enables scenarios such as:
- Before editing `database.py`, calling `hmemory_relevant(file_path="src/database.py", tags=["python", "database"])` to get schema facts and past failures.
- Before working on auth, calling `hmemory_relevant(file_path="src/auth.ts", tags=["typescript", "auth"])`.
- Before running tests, calling `hmemory_relevant(file_path="tests/", tags=["testing"])`.

### 6.4 Tool Surface

The memory system exposes tools through two surfaces: Hamilton's MCP server (`src/mcp/server.ts`) and a Pi SDK extension (`src/executors/pi/extensions/memory-extension.ts`). Both call the same underlying qmd + Hamilton DB logic.

**qmd relationship:** Hamilton owns atom file writing. When a tool needs to persist an atom, Hamilton writes the markdown file to the qmd store directory, then triggers `qmd embed` to index it into the hybrid search engine. qmd is strictly a query + embed engine — it never writes markdown files directly.

#### `hmemory_query` (MCP + Pi Extension)

- **Purpose:** Query the atom store with a natural-language or keyword query.
- **Inputs:**
  - `query: string`
  - `scope?: "project" | "user" | "all"` — defaults to `"all"`
  - `kind?: enum` — filter by atom kind
  - `limit?: integer` — defaults to 5, capped at 20
  - `include_demoted?: boolean` — defaults to `false`
- **Returns:** Array of `{ id, title, kind, scope, confidence, content, tags, score }`
- **Backed by:** qmd `store.query()` with typed sub-queries (lex/vec/hyde), combined via RRF + reranking. Adds Hamilton DB enrichment (use_count, last_used_at).
- **Use tracking:** Increments `use_count` and updates `last_used_at` in Hamilton DB for each returned atom.

#### `hmemory_get` (MCP + Pi Extension)

- **Purpose:** Retrieve full content of a specific atom by ID.
- **Inputs:** `id: string` — the atom nanoid
- **Returns:** Full atom `{ id, title, kind, scope, confidence, status, content, tags, created_at, updated_at }`
- **Backed by:** qmd `store.get(id)` for content + Hamilton DB `SELECT * FROM memory_atoms WHERE id = ?` for metadata

#### `hmemory_record` (MCP + Pi Extension)

- **Purpose:** Record a new atom mid-session without waiting for the daemon pipeline. Used for high-confidence, time-sensitive observations.
- **Inputs:**
  - `kind: enum` — `fact`, `preference`, `correction`, `failure`, or `procedure`.
  - `content: string` — markdown content
  - `scope?: "project" | "user"` — defaults to `"project"`
  - `tags?: string[]`
  - `confidence?: float` — defaults to `0.6`
- **Behavior:** Generates nanoid and title (fast model), writes atom .md file to the qmd store directory, triggers `qmd embed` to index, INSERTs into Hamilton DB. Emits `MemoryAtomCreated` audit event.
- **Returns:** `{ id, title, path }`
- **Note:** Mid-session records bypass Phase 2/3 validation. They SHOULD be reviewed by the next daemon pipeline run.

#### `hmemory_relevant` (MCP + Pi Extension)

- **Purpose:** Find atoms relevant to the current context (file being edited, tool being used). Returns atom file paths for the agent to load as additional context.
- **Inputs:**
  - `file_path: string` — the file or directory being worked on
  - `scope?: "project" | "user" | "all"` — defaults to `"all"`
  - `tags?: string[]` — explicit tags like `python`, `react`, `testing`, etc.
  - `limit?: integer` — defaults to 5
- **Returns:** Array of `{ id, title, path, kind, score }` — the `path` field points to the atom's .md file
- **Backed by:** qmd `store.search()` using `file_path` as the query and `tags` as `intent` for additional context hints

---

## 7. Salience Model & Demotion Protocol

### 7.1 Salience Formula

Salience is a scalar value in [0.0, 1.0] computed for each non-`canonical`, non-`correction`, non-`failure` atom. `canonical` atoms are exempt. `correction` and `failure` atoms have special protection rules (see §8).

```
salience = w_conf   * confidence
         + w_recency * recency_score(updated_at)
         + w_use     * use_score(use_count, last_used_at)
         + w_kind    * kind_weight(kind)
```

**Weights** (MUST sum to 1.0):

| Weight       | Symbol     | Value |
|--------------|------------|-------|
| `w_conf`     | confidence | 0.35  |
| `w_recency`  | recency    | 0.25  |
| `w_use`      | use        | 0.25  |
| `w_kind`     | kind       | 0.15  |

**`recency_score(updated_at)`** — exponential decay, half-life 30 days:

```
recency_score(t) = exp(−λ_r * age_days(t))
where λ_r = ln(2) / 30
```

**`use_score(use_count, last_used_at)`** — log-scaled use count weighted by recency:

```
use_score = log(1 + use_count) / log(1 + USE_SCALE)
          * exp(−λ_u * age_days(last_used_at))
where USE_SCALE = 20, λ_u = ln(2) / 14
```

If `last_used_at` is NULL (never used), `use_score = 0`. If `use_count = 0`, `use_score = 0`.

**`kind_weight(kind)`**:

| Kind         | Weight |
|--------------|--------|
| `correction` | 1.0    |
| `failure`    | 0.9    |
| `procedure`  | 0.8    |
| `fact`       | 0.7    |
| `preference` | 0.6    |
| `canonical`  | exempt |

### 7.2 Salience Computation Schedule

Salience is stored in `memory_atoms.salience` in Hamilton's DB (not in the atom frontmatter — it would become stale). It is:
1. Recomputed for all active non-exempt atoms during each daemon maintenance cycle.
2. Recomputed on-demand for individual atoms when retrieved (for ranking).
3. Triggered manually via `hamilton memory maintain`.

The daemon runs maintenance at startup and periodically (default: every 6 hours, configurable in `settings.yaml`).

### 7.3 Demotion Protocol

The demotion protocol runs as part of the daemon's maintenance cycle. It MUST be applied in the following order:

**Step 1 — Compute salience for all active non-exempt atoms**
For every row in `memory_atoms` with `status = 'active'` AND `kind NOT IN ('correction', 'failure', 'canonical')`: compute salience using the formula in §7.1. UPDATE the `salience` column in Hamilton DB.

**Step 2 — Active → Demoted transition**
For each atom where `salience < 0.25` AND `confidence < 0.4`:
- Set `status = 'demoted'`, `demoted_at = now` in Hamilton DB.
- Update the atom's frontmatter in the .md file (qmd) to match.
- Re-index in qmd with demoted status.
- Emit `MemoryAtomDemoted` audit event.

**Step 3 — Demoted → Tombstoned transition**
For each atom where `status = 'demoted'` AND `now - demoted_at > 90 days` AND `confidence < 0.2`:
- Set `status = 'tombstoned'`, `tombstoned_at = now` in Hamilton DB.
- Update the atom's frontmatter in the .md file.
- Re-index in qmd.
- Emit `MemoryAtomTombstoned` audit event.

**Step 4 — Correction and failure protection**
The demotion protocol MUST NEVER demote or tombstone an atom with `kind IN ('correction', 'failure')` via the salience pathway. These atoms are only ever demoted or tombstoned by explicit human action (§9) or by a superseding `correction` atom (§4.4, supersede decision).

### 7.4 Audit Event Schema

Every state transition is recorded as an audit event. Audit events are emitted through two paths:

**Path A — In-process (daemon running within Hamilton context):**
Publish to Hamilton's EventBus (`src/events/bus.ts`) using new tagged event types. The `DbWriter` subscriber (`src/db/subscribers.ts`) persists them to `memory_event_log`.

**Path B — Standalone (daemon running independently):**
INSERT directly into `memory_event_log` in Hamilton's database.

**New EventBus event types to add to `src/events/bus.ts`:**

```typescript
MemoryAtomCreated     = { _tag: "MemoryAtomCreated";     atomId: string; kind: string; scope: string; confidence: number; sourceObservationIndices: number[]; phase3Justification?: string; runId?: string }
MemoryAtomUpdated     = { _tag: "MemoryAtomUpdated";     atomId: string; reason: string; runId?: string }
MemoryAtomRejected    = { _tag: "MemoryAtomRejected";    draftKind: string; draftContentPreview: string; rejectionReason: string; runId?: string }
MemoryAtomDemoted     = { _tag: "MemoryAtomDemoted";     atomId: string; computedSalience: number; salienceComponents: Record<string, number>; confidenceAtDemotion: number }
MemoryAtomTombstoned  = { _tag: "MemoryAtomTombstoned";  atomId: string; daysSinceDemotion?: number; confidenceAtTombstone?: number }
MemoryAtomResurrected = { _tag: "MemoryAtomResurrected"; atomId: string; reason: string }
MemoryAtomMerged      = { _tag: "MemoryAtomMerged";      oldAtomId: string; newAtomId: string; runId?: string }
MemoryAtomForgotten   = { _tag: "MemoryAtomForgotten";   atomId: string }
```

The `ingested` event (for canonical source ingestion tracking) is written directly to `memory_event_log`, not through the EventBus:

```json
{
  "event_type": "ingested",
  "run_id": "<runId or null>",
  "timestamp": "<ISO 8601>",
  "actor": "system",
  "metadata": {
    "source": "file|url|guideline",
    "source_path": "<path or URL>",
    "file_hash": "<sha256>",
    "scope": "project|user",
    "chunk_count": 14
  }
}
```

**`memory_event_log` row format:**

```json
{
  "event_type": "<string>",
  "atom_id": "<nanoid or null>",
  "run_id": "<runId or null>",
  "timestamp": "<ISO 8601>",
  "actor": "<agent|system|human>",
  "reason": "<human-readable explanation>",
  "metadata": { }
}
```

---

## 8. Corrections & Failures as First-Class Memory

### 8.1 Why They Deserve Special Treatment

Corrections and failures represent the most reliable signal available about the agent's actual, demonstrated failure modes. Unlike `fact` or `preference` atoms — which are derived from the agent's interpretation of session events — corrections are direct user testimony: "you did X wrong; Y is correct." They are not inferences; they are ground truth provided by the authoritative party (the user).

Failures are the negative-space companion: they record what does not work and why, giving the agent something no amount of in-context reasoning can substitute for — a concrete record of its own blind spots.

The cost of losing a correction is higher than the cost of retaining a low-quality `fact`. An agent that forgets a correction will repeat the same mistake in the next run, degrading user trust linearly with time. An agent that retains an outdated `fact` might simply retrieve slightly stale information. The asymmetry is significant.

### 8.2 Confidence Immutability for Corrections

A `correction` atom's `confidence` field obeys the following invariant:

```
confidence(correction) can only be DECREASED by:
  (a) An explicit human action setting a new confidence value (actor: human)
  (b) A superseding correction atom that contradicts this one (actor: agent,
      decision: supersede in Phase 3). The superseding atom's `contradicts` frontmatter
      field lists the ID of the atom being superseded.

confidence(correction) MUST NOT be decreased by:
  - The salience decay formula
  - The demotion protocol
  - The Phase 3 validation model acting on a non-correction candidate
  - Any automated process other than (b) above
```

The same invariant applies to `failure` atoms.

### 8.3 Failure Atom Structure

A `failure` atom MUST document three aspects in its `content` field:

1. **The failed action or pattern** — What did the agent do? Be specific.
2. **The context in which it failed** — When does this failure occur? What preconditions trigger it?
3. **Why it failed (if known)** — The root cause.

If the root cause is not known at creation time, mark it as unknown: "Root cause: not yet determined."

### 8.4 Guaranteed Run-Start Injection

At run start (§6.1, Step 1), ALL active `correction` and `failure` atoms for the current project MUST be injected into the agent's context via Pi SDK's `DefaultResourceLoader`. This is a hard rule with no cap.

### 8.5 Strict Validation Bar in Phase 3

The Phase 3 strong model applies a higher bar for rejecting `correction` and `failure` candidates:

- MUST accept any `correction` candidate that references a specific agent mistake and a specific correction, unless it can provide written justification (minimum 2 sentences) for rejection.
- MUST accept any `failure` candidate that describes a specific, non-trivial failure pattern with at least the first two elements (failed action + context), unless it provides written justification.
- "Too similar to an existing atom" is a valid rejection reason only if the existing atom covers the same specific failure mode. Approximate similarity is NOT sufficient.

---

## 9. Human Override & Editing

The memory store is primarily agent-managed, but humans retain unconditional last-resort control over all atoms via CLI commands. The following operations are available:

### 9.1 Edit (`hamilton memory edit`)

```
hamilton memory edit <atom-id> [--content "<text>"] [--confidence <0.0-1.0>] [--tags "tag1,tag2"]
```

1. Updates the atom's frontmatter in the .md file (qmd).
2. Updates `memory_atoms.updated_at` in Hamilton DB.
3. Sets `source: human` on the modified atom.
4. Emits `MemoryAtomUpdated` audit event with `actor: human`.
5. Re-indexes the updated atom in qmd.

Humans MAY lower the `confidence` of a `correction` or `failure` atom.

### 9.2 Forget (`hamilton memory forget`)

```
hamilton memory forget <atom-id>
```

Immediately tombstones any atom, regardless of kind, status, or confidence:
1. Sets `status: tombstoned`, `tombstoned_at: now` in both stores.
2. Emits `MemoryAtomForgotten` audit event with `actor: human`.
3. Atom is immediately excluded from all retrieval and injection.

### 9.3 Resurrect (`hamilton memory resurrect`)

```
hamilton memory resurrect <atom-id> [--confidence <0.0-1.0>]
```

1. Sets `status: active`, clears `tombstoned_at` and `demoted_at` in both stores.
2. Resets `confidence` to specified value (defaults to 0.5).
3. Sets `source: human`.
4. Emits `MemoryAtomResurrected` audit event.
5. Re-indexes in qmd.

### 9.4 Promote to Canonical (`hamilton memory promote`)

```
hamilton memory promote <atom-id>
```

Changes any atom's `kind` to `canonical`, permanently exempting it from salience-based demotion:
1. Sets `kind: canonical`, `source: human`, `confidence: 1.0`.
2. Moves atom file to `canonical/` directory in qmd store.
3. Updates Hamilton DB row.
4. Emits `MemoryAtomUpdated` audit event.

### 9.5 Canonical Atom Special Rules

`canonical` atoms MAY NOT be modified, demoted, tombstoned, or deleted by the autonomous pipeline under any circumstances. All changes to canonical atoms MUST be initiated by a human action.

### 9.6 Listing and Inspection (`hamilton memory list` / `hamilton memory show`)

```
hamilton memory list [--kind correction|failure|fact|procedure|preference|canonical]
                     [--scope project|user]
                     [--status active|demoted|tombstoned]
                     [--project <id>]
                     [--limit <n>]

hamilton memory show <atom-id>
```

`list` queries Hamilton DB for metadata. `show` retrieves full content from qmd and displays it.

### 9.7 Audit Completeness

Every human action MUST emit a corresponding audit event. The `memory_event_log` table is append-only and immutable — entries cannot be edited or deleted.

---

## 10. qmd + Hamilton DB Integration

### 10.1 Architecture

```
┌─────────────────────────────────────────────────────┐
│  qmd (@tobilu/qmd)                                  │
│  ─────────────────                                  │
│  ~/.hamilton/memory/projects/<id>/qmd.db (SQLite)   │
│    - FTS5 index (BM25 lexical search)               │
│    - sqlite-vec (vector embeddings)                 │
│    - RRF fusion                                     │
│    - LLM reranking                                  │
│                                                     │
│  ~/.hamilton/memory/projects/<id>/corrections/*.md  │
│  ~/.hamilton/memory/projects/<id>/failures/*.md     │
│  ~/.hamilton/memory/projects/<id>/facts/*.md        │
│  ~/.hamilton/memory/projects/<id>/procedures/*.md    │
│  ~/.hamilton/memory/projects/<id>/canonical/*.md    │
│                                                     │
│  ~/.hamilton/memory/user/qmd.db                     │
│  ~/.hamilton/memory/user/corrections/*.md           │
│  ~/.hamilton/memory/user/failures/*.md              │
│  ~/.hamilton/memory/user/preferences/*.md           │
│  ~/.hamilton/memory/user/procedures/*.md             │
│  ~/.hamilton/memory/user/canonical/*.md             │
└─────────────────────────────────────────────────────┘
                         ↕  (linked by atom id + path)
┌─────────────────────────────────────────────────────┐
│  Hamilton DB (bun:sqlite)                           │
│  ───────────────────────                            │
│  ~/.hamilton/hamilton.db                            │
│    - memory_atoms (metadata, salience, use tracking)│
│    - memory_event_log (audit trail)                 │
│    - runs, tasks, turns, tool_calls, ... (existing) │
└─────────────────────────────────────────────────────┘
```

The qmd layer and Hamilton DB layer are linked by the atom's nanoid `id` and the `qmd://` URI stored in Hamilton's `memory_atoms.path` column (e.g. `qmd://projects/<id>/corrections/<slug>-<id>.md`). qmd's SQLite database and Hamilton's SQLite database are separate files with separate connections (qmd uses `better-sqlite3` native addon; Hamilton uses `bun:sqlite`). They do not share a connection or transaction scope.

### 10.2 Installation & Model Download

qmd is installed as a dependency via `bun install` (`@tobilu/qmd` in `package.json`). However, qmd requires embedding models for vector search. These models must be downloaded before the memory system can function.

`hamilton setup` triggers model download:

```ts
pullModels(models, options) // qmd/src/llm.ts
```

qmd stores models in its own cache directory (managed by qmd, not Hamilton). This step is idempotent — subsequent `setup` runs skip already-cached models.

**TLS inspection environments:** Some corporate networks intercept TLS connections, causing model downloads to fail with certificate errors. Hamilton supports disabling TLS verification during model download via the `NODE_TLS_REJECT_UNAUTHORIZED` environment variable:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 hamilton setup
```

This variable is forwarded to qmd's download process. It MUST be set explicitly by the user — Hamilton does not disable TLS by default. The `setup` command logs a warning when TLS verification is disabled.

### 10.3 Store Layout

**Project store** (`~/.hamilton/memory/projects/<project_id>/`):
```
  qmd.db                     ← qmd SQLite (FTS5 + vectors)
  corrections/               ← .md files (kind=correction)
  failures/                  ← .md files (kind=failure)
  facts/                     ← .md files (kind=fact)
  procedures/               ← .md files (kind=procedure)
  canonical/                 ← .md files (kind=canonical)
```

**User store** (`~/.hamilton/memory/user/`):
```
  qmd.db
  corrections/
  failures/
  preferences/
  procedures/
  canonical/
```

### 10.4 Store Initialisation

```typescript
import { createStore } from '@tobilu/qmd';

const projectStore = await createStore({
  dbPath: `${hamiltonHome}/memory/projects/${projectId}/qmd.db`
});

const userStore = await createStore({
  dbPath: `${hamiltonHome}/memory/user/qmd.db`
});
```

Collections are registered on first use via `store.addCollection()`:

```typescript
await store.addCollection({
  name: 'corrections',
  description: 'Mistakes the agent made and their corrections. Highest-priority memory. Always injected at run start. Treat as ground truth.',
  basePath: `${hamiltonHome}/memory/projects/${projectId}/corrections`
});
// ... repeat for failures, facts, procedures, canonical, preferences (user scope only)
```

### 10.5 Core Operations

**`qmd embed` — Batch indexing after file writes:**
After Hamilton writes all markdown files for a pipeline run, `qmd embed` indexes them all in a single pass. Called once per Phase 4 batch, not per-file.

```ts
// Re-index collections by scanning the filesystem
const result = await store.update({
  collections: ["canonical"],  // optional — defaults to all
  onProgress: ({ collection, file, current, total }) => {
    console.log(`[${collection}] ${current}/${total} ${file}`)
  },
})
// => { collections, indexed, updated, unchanged, removed, needsEmbedding }

// Generate vector embeddings
const embedResult = await store.embed({
  force: false,           // true to re-embed everything
  chunkStrategy: "auto",  // "regex" (default) or "auto" (AST for code files)
  onProgress: ({ current, total, collection }) => {
    console.log(`Embedding ${current}/${total}`)
  },
})
```

**Query with typed sub-queries** — used by `hmemory_query` and context injection:

```typescript
const results = await store.query({
  query: taskPrompt,
  collections: ['facts', 'procedures'],
  subQueries: ['lex', 'vec', 'hyde'],  // typed: lexical, vector, HyDE
  status: 'active',
  limit: 5,
  rerank: true
});
```

**Search (for context-relevant lookup)** — used by `hmemory_relevant`:

```typescript
const results = await store.search({
  query: filePath,
  intent: tags?.join(', '),
  collections: ['facts', 'corrections', 'failures', 'procedures'],
  limit,
  minScore: 0.3,
});
```

**Bulk fetch by ID** — used for mandatory correction/failure injection:

```typescript
const ids = db.query("SELECT id FROM memory_atoms WHERE kind IN ('correction','failure') AND status = 'active' AND project_id = ?").all(projectId);
const atoms = await store.multiGet({ ids: ids.map(r => r.id) });
```

**Single fetch** — used by `hmemory_get`:

```typescript
const atom = await store.get({ id: atomId });
const metadata = db.query("SELECT * FROM memory_atoms WHERE id = ?").get(atomId);
```

**Vector search** — used in content ingest deduplication:

```typescript
const results = await store.searchVector({
  query: chunkContent,
  collections: ['canonical'],
  limit: 5
});
```

### 10.6 Dual-Write Consistency

Hamilton DB is the commit point. The `.md` files and qmd index are derived artifacts that can be reconstructed or cleaned up on recovery. Write order:

```
 ┌─ Hamilton DB transaction ──────────────────────┐
 │  INSERT memory_atoms (status = 'pending')       │
 │  for all accepted atoms in the pipeline batch.  │
 └─ COMMIT ───────────────────────────────────────┘
         │
         ▼
 Hamilton writes all .md files to disk
 (individual failures → skip, leave row 'pending')
         │
         ▼
 qmd embed (single batch invocation against store dir)
         │
         ▼
 UPDATE memory_atoms SET status = 'active'
 WHERE status = 'pending' AND run_id = ?
```

**Recovery** (daemon maintenance pass, runs at startup and every 6 hours):
```sql
SELECT id, path FROM memory_atoms
WHERE status = 'pending'
  AND created_at < datetime('now', '-5 minutes')
```

For each stuck `pending` row:
- **File exists at `path`**: write + embed succeeded but finalize didn't. Re-trigger `qmd embed`, UPDATE to `status = 'active'`.
- **File missing at `path`**: file write failed, atom content is lost. Tombstone: UPDATE `status = 'tombstoned'`, `tombstoned_at = now`. Emit `MemoryAtomTombstoned` with reason `'recovery: file missing after crash'`.
- **Orphan files** (on disk, no DB row): qmd embed already indexes based on filesystem content, so these would appear in search results with unknown metadata. The maintenance pass detects them by comparing qmd index entries against `memory_atoms` rows and deletes orphaned files + re-runs `qmd embed`.

### 10.6 ID Index for Corrections and Failures

Because corrections and failures must be bulk-fetched at every run start (§6.1, Step 1), the Hamilton DB query `SELECT id FROM memory_atoms WHERE kind IN ('correction','failure') AND status = 'active' AND project_id = ?` serves as the index. With proper indexing on `(project_id, kind, status)`, this query is efficient for the expected number of corrections/failures per project (typically < 100). No separate JSON index file is needed.

---

## 11. Observation Collection — Dual Source

### 11.1 Architecture

```
┌──────────────────────┐       ┌──────────────────────┐
│  Hamilton Run        │       │  External Agent      │
│  ────────────        │       │  ──────────────      │
│  EventBus subscriber │       │  Claude Code         │
│  buffers events      │       │  Copilot             │
│       │              │       │  Cursor              │
│  on_workflow_        │       │       │              │
│  completed hook      │       │  writes JSONL        │
│       │              │       │       │              │
│       ▼              │       │       ▼              │
│  ~/.hamilton/memory/ │       │  ~/.hamilton/memory/ │
│  inbox/hamilton/     │       │  inbox/<agent-name>/ │
│  <runId>.jsonl       │       │  <timestamp>.jsonl   │
└──────────┬───────────┘       └──────────┬───────────┘
           │                              │
           └──────────┬───────────────────┘
                      │
                      ▼
           ┌─────────────────────┐
           │  Memory Daemon      │
           │  ─────────────      │
           │  Watches inbox/     │
           │  Runs Phases 2-5    │
           └─────────────────────┘
```

### 11.2 Hamilton Integration — Guideline Pipeline + EventBus Subscriber

Hamilton integrates with the memory system through two mechanisms: a dedicated guideline pipeline that manages canonical memory, and run-time observation collection via the EventBus.

**Guideline pipeline:**
The guideline pipeline (`src/memory/guidelines.ts`) wraps Hamilton's guideline loader (`src/guidelines/loader.ts`) with the content ingest pipeline (§5) and curator (§13). It runs as a step before the workflow runner.

At workflow start, the guideline pipeline:

1. Loads guideline files via `src/guidelines/loader.ts`.
2. For each file, computes SHA-256 and queries `memory_event_log` for the most recent `ingested` event with `metadata.source = 'guideline'` matching this source_path.
3. If absent or hash differs: runs content ingest (§5) with `source: guideline`. Tombs old atoms if content changed. If hash matches: skips.
4. After ingestion: INSERTs an `ingested` event with `metadata: {"source": "guideline", "source_path": "...", "file_hash": "...", "scope": "project"}`.
5. Returns the guideline rules (tool-call blocking patterns from `src/guidelines/rule-engine.ts`) for the runner to install as extensions. Guideline instructions no longer pass directly to agents — they reach the agent exclusively through memory injection (§6.2).

The user can also trigger re-ingestion manually:
```
hamilton memory ingest --guidelines   # Re-ingest all active guideline files
```

**Run-time observation collection:**
A new `ObservationCollector` class subscribes to Hamilton's EventBus during workflow execution (`src/workflow/runner.ts`). It buffers observations in memory throughout the run. On `on_workflow_completed`, it serializes the buffer to `~/.hamilton/memory/inbox/hamilton/<runId>.jsonl`.

The collector maps Hamilton events to the standard observation schema:

| Hamilton Event              | Observation Type    | Fields Populated                                        |
|-----------------------------|---------------------|--------------------------------------------------------|
| `ToolCall` + `ToolResult`   | `tool_call`         | tool_name, arguments (from ToolCall.input summary), result (from ToolResult summary), success, duration_ms |
| `TaskFailed`                | `error_encountered` | error_type, error_message, context                    |
| Repeated ToolCall detection | `pattern_repeated`  | tool_name, pattern_description, repeat_count          |
| `LlmMessage` analysis       | `decision_made`     | decision_text, rationale, alternatives_considered     |

Hamilton does NOT produce `user_correction` or `user_feedback` observations — it runs autonomously after receiving the initial task prompt.

The collector is registered as part of the run setup in `src/workflow/runner.ts:runWorkflow` and disposed at run end.

### 11.3 External Agent Integration — Inbox Contract

Any coding agent can write observations to `~/.hamilton/memory/inbox/<agent-name>/<timestamp>.jsonl` using the standard JSONL format defined in §4.1. The filename convention is:
- `<agent-name>` — identifies the source tool (e.g. `claude`, `copilot`, `cursor`, `aider`).
- `<timestamp>` — ISO 8601 compact format (e.g. `2026-06-27T14-30-00Z`).

The daemon watches `~/.hamilton/memory/inbox/` (recursively) and processes any new `.jsonl` file. After successful processing, the file is moved to `~/.hamilton/memory/inbox/processed/`.

### 11.4 Observation Schema (Standard JSONL Contract)

```jsonl
{"type":"header","session_id":"<string>","project_id":"<string>","agent_name":"<string>","started_at":"<ISO 8601>","ended_at":"<ISO 8601>","task_description":"<string>"}
{"type":"tool_call","tool_name":"<string>","arguments":"<summary>","result":"<summary>","success":<bool>,"duration_ms":<int>,"error_message":"<string|null>"}
{"type":"user_correction","agent_statement":"<string>","correction_text":"<string>","turn_index":<int>}
{"type":"user_feedback","sentiment":"positive|negative|neutral","text":"<string>","turn_index":<int>}
{"type":"error_encountered","error_type":"<string>","error_message":"<string>","context":"<string>","stack_trace":"<string|null>"}
{"type":"pattern_repeated","tool_name":"<string>","pattern_description":"<string>","repeat_count":<int>}
{"type":"decision_made","decision_text":"<string>","rationale":"<string>","alternatives_considered":"<string>"}
```

### 11.5 `project_id` Resolution

For Hamilton runs, `project_id` is resolved at run start in this priority order:
1. If a git repository is detected, `project_id` = the absolute path of the repository root (from `git rev-parse --show-toplevel`).
2. If no git repository, `project_id` = the current working directory.

For external agents, the agent specifies `project_id` in the observation header. Recommended: use the git repository root path when available.

This value is stored in both the observation header and in `memory_atoms.project_id`. It is used to partition the qmd project stores and to filter retrieval to the correct project.

---

## 12. The Memory Daemon

The memory daemon is a long-running process that consumes observation files and maintains the atom store. It runs independently of any active Hamilton workflow.

### 12.1 Lifecycle

```
hamilton memory daemon start     # Start as background process
hamilton memory daemon stop      # Gracefully shut down
hamilton memory daemon status    # Check if running (pid, uptime, last processed)
hamilton memory daemon restart   # Stop + start
```

The daemon is started by `hamilton setup` and managed as a launchd service on macOS (or systemd on Linux). It writes a PID file to `~/.hamilton/memory/daemon.pid`.

### 12.2 Main Loop

```
1. Compute salience for all active atoms (maintenance pass).
2. Apply demotion protocol.
3. Watch ~/.hamilton/memory/inbox/ for new .jsonl files.
4. For each new file:
   a. Read and parse the observation log.
   b. Run Phase 2 (fast model — candidate extraction).
   c. Run Phase 3 (strong model — validation & deduplication).
   d. Run Phase 4 (dual write — qmd + Hamilton DB).
   e. Run Phase 5 (session fold).
   f. Move file to inbox/processed/.
5. Sleep. Check again.
6. Periodic maintenance: every 6 hours, recompute salience + apply demotion.
```

### 12.3 LLM Provider Configuration

The daemon uses the same LLM provider configuration as Hamilton's Pi executor — model aliases are resolved from `~/.hamilton/executors/pi/agent/settings.json` (or Hamilton's `settings.yaml`). The daemon requires two models:

- **Fast model** (Phase 2): A smaller, cheaper model optimized for structured JSON extraction. Maps to `memory.fast_model` in `settings.yaml`, falls back to the default model.
- **Strong model** (Phase 3): A more capable model for validation and deduplication. Maps to `memory.strong_model` in `settings.yaml`, falls back to the default model.

### 12.4 Graceful Degradation

The daemon MUST degrade gracefully when components fail:

| Failure                                    | Degraded behaviour                                                                                    |
|--------------------------------------------|-------------------------------------------------------------------------------------------------------|
| qmd store unavailable at daemon start      | Log error. Retry at next maintenance interval.                                                        |
| Phase 2 (fast model) fails                 | Skip extraction for this file. Move file to `inbox/failed/`. Log warning.                             |
| Phase 3 (strong model) fails               | Fall back to accepting all Phase 2 candidates with confidence capped at 0.5. Log warning.             |
| Phase 4 (qmd write) fails                  | Retry with backoff. If all retries fail, save candidates to a pending queue.                          |
| Phase 4 (Hamilton DB write) fails          | Log error. Retry. If qmd write succeeded but DB write failed, detect orphan in maintenance.           |
| Hamilton DB unavailable                    | Queue writes. All memory tools return empty results (graceful).                                       |
| Salience computation fails                 | Skip demotion for affected atoms. Do not demote based on partial data.                                |

### 12.5 Implementation

The daemon is implemented as a TypeScript module at `src/memory/daemon.ts`. It uses the same `bun:sqlite` connection to Hamilton's DB (for `memory_atoms` queries) and creates qmd store instances for content operations. It publishes audit events to the EventBus when available (post-refactoring); until the EventBus is lifted to application scope, it writes directly to `memory_event_log`.

When started via `hamilton memory daemon start`, Hamilton spawns the daemon using `Bun.spawn` with `detached: true` and writes the PID. The daemon's stdout/stderr are logged to `~/.hamilton/memory/daemon.log`.

---

## 13. LLM Client & The Curator

The memory system requires LLM calls in multiple contexts: the daemon's autonomous pipeline (Phases 2 and 3), content ingest chunking, title generation for `hmemory_record`, and context-relevant atom retrieval for `hmemory_relevant`. These are NOT full agent sessions — they are single-flight prompt → completion calls with no tool loop.

To support this uniformly, Hamilton extracts a shared `LLMClient` from the model resolution logic currently embedded in `src/executors/pi/pi-executor.ts`. The curator is a thin orchestration layer built on top of this client.

### 13.1 LLMClient

A lightweight wrapper around `@earendil-works/pi-ai` that handles auth loading, model resolution, and token tracking. All memory-related LLM calls flow through this client.

```typescript
import { complete, type Context } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

interface TokenUsage {
  provider: string;
  modelId: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

function createLLMClient(config?: {
  modelsJsonPath?: string;
  onTokenUsage?: (usage: TokenUsage) => void;
}) {
  const registry = config?.modelsJsonPath
    ? ModelRegistry.create(authStorage, config.modelsJsonPath)
    : modelRegistry;

  return {
    complete: async (
      provider: string,
      modelId: string,
      context: Context,
    ) => {
      const model = registry.find(provider, modelId);
      if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

      const auth = await registry.getApiKeyAndHeaders(model);
      if (!auth.ok) throw new Error(auth.error);

      const startedAt = performance.now();
      const response = await complete(model, context, {
        apiKey: auth.apiKey,
        headers: auth.headers,
      });
      const latencyMs = performance.now() - startedAt;

      config?.onTokenUsage?.({
        provider,
        modelId,
        tokensIn: response.usage?.input_tokens ?? 0,
        tokensOut: response.usage?.output_tokens ?? 0,
        latencyMs: Math.round(latencyMs),
      });

      return response;
    },
  };
}
```

The `onTokenUsage` callback publishes `TokenUsage` events to Hamilton's EventBus. The `DbWriter` subscriber persists them alongside agent token usage. Curator and daemon events carry `runId: null` — subscribers handle null gracefully.

**EventBus refactoring dependency:** Hamilton's EventBus is currently scoped to individual workflow runs (`src/events/bus.ts` provides `EventBus` via `Effect.provide(EventBusLive)` inside `runWorkflow`). The memory system requires the EventBus to be lifted to **application scope** — a single bus that lives as long as the Hamilton CLI process, not per-workflow. This makes `runId` and `taskId` optional on all event types. Until this refactoring is complete, the daemon and curator write directly to `memory_event_log` as a fallback path.

The `LLMClient` resolves models using the same `models.json` and `auth.json` as Hamilton's Pi executor — no separate credential store. It supports both built-in Pi models and custom models defined in the user's configuration.

### 13.2 The Curator

The curator is not a full agent. It is a stateless function that executes targeted LLM calls for specific memory operations. It holds an `LLMClient` instance and exposes methods for each use case.

**Interface:**

```typescript
interface Curator {
  extractCandidates(observationLog: ObservationLog): Promise<DraftCandidate[]>;
  validateCandidates(candidates: DraftCandidate[], existingAtoms: Atom[]): Promise<ValidationResult>;
  generateTitle(content: string): Promise<string>;
  findRelevantAtoms(filePath: string, tags: string[]): Promise<RelevantAtom[]>;
  suggestTags(taskPrompt: string, filePaths: string[]): Promise<string[]>;
}
```

**Callers:**

| Method | Called by | When |
|---|---|---|
| `extractCandidates` | Daemon pipeline Phase 2 | After observations land in the inbox |
| `validateCandidates` | Daemon pipeline Phase 3 | After candidate extraction |
| `generateTitle` | `hmemory_record` tool | Mid-session atom recording |
| `findRelevantAtoms` | `hmemory_relevant` tool | Context-relevant atom lookup |
| `suggestTags` | Workflow runner | At task start — determines tags for conditional injection (Rule B in §6.3) |

### 13.3 suggestTags — Task-Aware Injection

When a Hamilton workflow task starts, the curator's `suggestTags` method receives the task prompt and the list of files the task is expected to touch (from workflow input). It returns a set of tags like `["lang:typescript", "testing", "database"]` that feed into the conditional injection rules in §6.3. The task does NOT need to know what memory exists — the curator determines relevance and the injection engine fetches matching atoms.

This replaces the manual tag specification described in Rule B of §6.3. Tags are derived automatically by the curator unless the user overrides them.

### 13.4 Model Selection

The curator uses two model tiers matching the daemon's requirements:

- **Fast model** (Phase 2, `generateTitle`, `suggestTags`): Lower cost, optimized for structured JSON output. Configured via `memory.models.fast_model` in `settings.yaml`.
- **Strong model** (Phase 3, `findRelevantAtoms`): Higher capability for validation, deduplication, and relevance ranking. Configured via `memory.models.strong_model` in `settings.yaml`.

Both resolve through the same `LLMClient` — the separation is configuration, not code.

---

## 14. CLI Commands

### 14.1 Command Tree

```
hamilton memory
├── daemon
│   ├── start       — Start the memory daemon
│   ├── stop        — Stop the memory daemon
│   ├── status      — Check daemon status
│   └── restart     — Restart the daemon
├── ingest          — Ingest content as canonical atoms
│   <path> [--scope project|user]    # file or URL
│   --guidelines                     # all active guideline files
├── list            — List atoms
│   [--kind correction|failure|fact|procedure|preference|canonical]
│   [--scope project|user]
│   [--status active|demoted|tombstoned]
│   [--project <id>]
│   [--limit <n>]
├── show            — Show full atom content
│   <atom-id>
├── edit            — Edit an atom
│   <atom-id> [--content "<text>"] [--confidence <0.0-1.0>]
│   [--tags "tag1,tag2"]
├── forget          — Tombstone an atom
│   <atom-id>
├── resurrect       — Restore a tombstoned atom
│   <atom-id> [--confidence <0.0-1.0>]
├── promote         — Promote an atom to canonical
│   <atom-id>
├── maintain        — Trigger salience computation + demotion pass
└── status          — Show memory store statistics
    [--project <id>]
```

### 13.2 Command Implementation

Each command is a Hamilton `@effect/cli` Command in `src/cli/commands/` — following the same pattern as existing commands (export the Command + the underlying Effect function for testability). A new `src/cli/commands/memory.ts` uses `Command.withSubcommands([])` to compose the subcommands.

Commands that modify atoms (`ingest`, `edit`, `forget`, `resurrect`, `promote`) emit audit events. Commands that read atoms (`list`, `show`, `status`) query Hamilton DB and qmd.

### 13.3 `hamilton memory status` Output

```
Memory Store Status
───────────────────
Project: /Users/caio/my-project

  Corrections:  3 active, 0 demoted, 0 tombstoned
  Failures:     2 active, 0 demoted, 0 tombstoned
  Facts:        12 active, 1 demoted, 0 tombstoned
  Procedures:   2 active, 0 demoted, 0 tombstoned
  Canonical:    45 active (from 3 source files)

User Scope:
  Preferences:  4 active, 0 demoted, 0 tombstoned
  Corrections:  1 active
  Failures:     0
  Procedures:   1 active
  Canonical:    0

Total: 71 atoms (68 active, 1 demoted, 0 tombstoned)
Daemon: running (pid 84321, uptime 3h 22m, last processed 2m ago)
```

---

## 14. Open Questions

**Q1: Multi-agent conflict resolution**
When multiple agent instances operate on the same project simultaneously (e.g. parallel Hamilton runs + Claude Code session), concurrent writes to the qmd database may conflict. SQLite's WAL mode handles single-process concurrency, but multi-process writes to the qmd.db require coordination. An advisory lock file or write queue MAY suffice.

**Q2: Memory migration across project renames and moves**
When a project directory is renamed or moved, the `project_id` (based on git root path) changes. All project-scope atoms now reference a stale `project_id`. A `hamilton memory migrate <old-id> <new-id>` command is anticipated but not specified.

**Q3: Privacy and PII in user-scope memories**
User-scope atoms may capture personally identifying information. The current design has no PII-scrubbing step in the extraction pipeline.

**Q4: Cross-project procedure promotion**
A `procedure` atom learned in project A may be generally applicable and worth promoting to user-scope. A `hamilton memory promote-scope <atom-id>` command is anticipated but not specified.

**Q5: Embedding model versioning and re-indexing**
The vector index in qmd depends on the embedding model used at ingest time. If the embedding model is upgraded, existing embeddings become incompatible. A `hamilton memory reindex` command is anticipated.

**Q6: Adversarial memory injection**
If an agent can be prompted to create atoms autonomously, a malicious prompt could cause the agent to write false corrections or facts that persist across runs. The Phase 3 validation provides some defence, but it is not a security boundary. Hardened environments MAY require human approval for all new `correction` and `fact` atoms.

**Q7: Observation format versioning**
The observation JSONL schema (§11.4) is a contract between agents and the daemon. Version changes to this schema need a migration path so the daemon can continue processing older observation files.

---

## 15. Appendix

### A. Atom File Format

All atom files are stored as markdown with YAML frontmatter in the appropriate qmd store directory. The frontmatter contains all structured metadata visible to qmd search; the markdown body contains the human-readable `content`.

```markdown
---
id: "7f3a2b1c-8e4d-4f5a-9b6c-0d1e2f3a4b5c"
title: "Config file format must be TOML, not JSON"
kind: correction
scope: project
source: autonomous
confidence: 0.92
status: active
created_at: "2026-06-15T14:23:11Z"
updated_at: "2026-06-15T14:23:11Z"
project_id: "/Users/caio/acme-api"
tags:
  - lang:typescript
  - config
  - toml
demoted_at: null
tombstoned_at: null
contradicts: []
---

# Config file format must be TOML, not JSON

## Mistake

The agent wrote project configuration files as JSON (e.g. `project.config.json`)
using the standard `JSON.parse` / `JSON.stringify` pattern.

## Correction

All configuration files in this project MUST use TOML format.
The configuration loader only accepts `.toml` files.
JSON configuration files will be silently ignored by the loader.

## Correct approach

```toml
# project.config.toml
[server]
port = 3000
host = "localhost"
```

Use `@iarna/toml` to read and write TOML.
```

### B. Audit Event JSONL Example (from `memory_event_log`)

```jsonl
{"event_type":"atom.created","atom_id":"7f3a2b1c-8e4d-4f5a-9b6c-0d1e2f3a4b5c","run_id":"feature-dev-x7k2m","timestamp":"2026-06-15T14:23:11Z","actor":"agent","reason":"Accepted by Phase 3 validation. Correction references specific user statement.","metadata":{"kind":"correction","scope":"project","confidence":0.92,"source_observation_indices":[4,7],"phase3_justification":"User explicitly corrected agent's use of JSON config files."}}
{"event_type":"atom.created","atom_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","run_id":"feature-dev-x7k2m","timestamp":"2026-06-15T14:23:12Z","actor":"agent","reason":"Accepted failure atom. Pattern repeated 4 times within run.","metadata":{"kind":"failure","scope":"project","confidence":0.87,"source_observation_indices":[2,5,8,11]}}
{"event_type":"atom.rejected","atom_id":null,"run_id":"feature-dev-x7k2m","timestamp":"2026-06-15T14:23:13Z","actor":"agent","reason":"Candidate fact too vague to be actionable.","metadata":{"draft_kind":"fact","draft_content_preview":"The project uses a database.","rejection_reason":"Content is too generic."}}
{"event_type":"atom.demoted","atom_id":"deadbeef-dead-beef-dead-beefdeadbeef","run_id":null,"timestamp":"2026-09-14T02:00:00Z","actor":"system","reason":"Salience below threshold (0.17 < 0.25) and confidence below threshold (0.31 < 0.40).","metadata":{"computed_salience":0.17,"salience_components":{"confidence_term":0.109,"recency_term":0.044,"use_term":0.000,"kind_term":0.105},"confidence_at_demotion":0.31}}
{"event_type":"atom.tombstoned","atom_id":"deadbeef-dead-beef-dead-beefdeadbeef","run_id":null,"timestamp":"2026-12-14T02:00:00Z","actor":"system","reason":"Atom demoted for more than 90 days with confidence below 0.20.","metadata":{"days_since_demotion":91,"confidence_at_tombstone":0.18}}
{"event_type":"atom.resurrected","atom_id":"deadbeef-dead-beef-dead-beefdeadbeef","run_id":null,"timestamp":"2026-12-15T11:30:00Z","actor":"human","reason":"User confirmed this fact is still accurate.","metadata":{"reason":"Reviewed content; still accurate."}}
```

### C. Settings Configuration (`settings.yaml` additions)

```yaml
# Memory system configuration (added to ~/.hamilton/settings.yaml)
memory:
  enabled: true

  daemon:
    auto_start: true                   # Start daemon with hamilton setup
    maintenance_interval_hours: 6      # Salience recomputation interval

  models:
    fast_model:                        # Phase 2 — candidate extraction
      provider: default
      model_id: default
    strong_model:                      # Phase 3 — validation
      provider: default
      model_id: default

  injection:
    canonical_top_k: 5
    fact_top_k: 3
    procedure_top_k: 3
    preference_top_k: 3
    soft_cap: 20

  search:
    default_limit: 5
    max_limit: 20
    context_default_limit: 5
    context_rerank: true

  salience:
    w_conf: 0.35
    w_recency: 0.25
    w_use: 0.25
    w_kind: 0.15
    half_life_recency_days: 30
    half_life_use_days: 14
    use_scale: 20
    demotion_salience_threshold: 0.25
    demotion_confidence_threshold: 0.40
    tombstone_days_threshold: 90
    tombstone_confidence_threshold: 0.20

  pipeline:
    max_candidates_per_session: 20
    phase2_retry_max: 3
    phase3_retry_max: 2
    phase2_retry_backoff_seconds: [5, 15, 45]

  language_detection:
    enabled: true

  tag_filter_mode: or
```

### D. Atom Lifecycle State Machine

```
                     ┌─────────────────────────────┐
                     │                             │
                     │         (created)           │
                     │            │                │
                     │            ▼                │
                     │  ┌──────────────────┐       │
              ┌──────┼──│     ACTIVE       │       │
              │      │  └──────────────────┘       │
              │      │    │             │           │
              │      │    │ daemon      │ human     │
              │      │    │ maintenance │ forget    │
              │      │    ▼             │           │
              │      │  ┌──────────────┐│           │
              │      │  │   DEMOTED    ││           │
              │      │  └──────────────┘│           │
              │      │    │             │           │
              │      │    │ >90 days    │           │
              │      │    │ + low conf  │           │
              │      │    ▼             ▼           │
              │      │  ┌────────────────────────┐  │
              │      │  │      TOMBSTONED        │  │
              │      │  └────────────────────────┘  │
              │      │            │                │
  supersede   │      │            │ human          │
  (new        │      │            │ resurrect      │
  correction) │      │            └────────────────┘
              │      │              (back to ACTIVE)
              │      │
              └──────┘
                (old atom tombstoned when new superseding atom is created)

Legend:
  ACTIVE     — Retrieved in searches and injected at run start
  DEMOTED    — Excluded from injection and default search; retained on disk
  TOMBSTONED — Excluded from all retrieval; retained on disk for audit/resurrection
```

| From         | To           | Triggered by                                                          |
|--------------|--------------|-----------------------------------------------------------------------|
| (created)    | ACTIVE       | Phase 4 dual write (autonomous or content ingest)                   |
| ACTIVE       | DEMOTED      | Daemon maintenance (salience + confidence thresholds)                 |
| ACTIVE       | TOMBSTONED   | Human `forget` or Phase 4 supersede decision                          |
| DEMOTED      | TOMBSTONED   | Daemon maintenance (>90 days demoted + confidence < 0.20)             |
| DEMOTED      | ACTIVE       | Human `resurrect`                                                     |
| TOMBSTONED   | ACTIVE       | Human `resurrect`                                                     |
| ACTIVE       | ACTIVE       | Phase 4 merge (content/confidence update), human edit, use tracking   |

### E. Implementation Files

| File | Purpose |
|------|---------|
| `src/memory/daemon.ts` | Memory daemon — watches inbox, runs pipeline, computes salience |
| `src/memory/collector.ts` | ObservationCollector — EventBus subscriber for Hamilton runs |
| `src/memory/tools.ts` | Shared tool logic — `hmemory_query`, `hmemory_get`, `hmemory_record`, `hmemory_relevant` |
| `src/memory/pipeline.ts` | Phases 2-5 of the autonomous pipeline |
| `src/memory/canonical.ts` | Canonical ingest pipeline (chunk, dedup, write) |
| `src/memory/queries.ts` | Hamilton DB queries for `memory_atoms` and `memory_event_log` |
| `src/memory/salience.ts` | Salience formula and demotion protocol |
| `src/events/bus.ts` | Lift EventBus to application scope (runId/taskId become optional); add MemoryAtomCreated, MemoryAtomDemoted, etc. event types |
| `src/db/schema.ts` | Add `memory_atoms`, `memory_event_log` DDL |
| `src/db/migrations.ts` | Add migration v8 for memory tables |
| `src/db/subscribers.ts` | Extend DbWriter to persist memory events to `memory_event_log` |
| `src/executors/pi/extensions/memory-extension.ts` | Pi SDK extension registering memory tools |
| `src/mcp/server.ts` | Add `hmemory_query`, `hmemory_get`, `hmemory_record`, `hmemory_relevant` MCP tools |
| `src/cli/commands/memory.ts` | CLI commands for memory management |
| `src/cli/main.ts` | Register `memory` as a subcommand of root |
| `src/memory/guidelines.ts` | Guideline pipeline — wraps guideline loader with canonical ingest, uses curator and memory abstractions |
| `src/workflow/runner.ts` | Call guideline pipeline before execution (returns rules, not instructions); register ObservationCollector subscriber |
| `src/prompts/system.ts` | Inject memory context via Pi SDK DefaultResourceLoader; guidelines reach agents through memory, not directly |
| `settings.yaml` | Add `memory:` configuration block |

---

*End of RFC-001 — Hamilton Agent Long-Term Memory*

*This document is a living draft. Major revisions will increment the RFC number. Minor revisions will be tracked in the audit log of the document itself.*