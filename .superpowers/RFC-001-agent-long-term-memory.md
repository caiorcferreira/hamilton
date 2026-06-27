# RFC-001: Coding Agent Long-Term Memory

| Field        | Value                                  |
|-------------|----------------------------------------|
| RFC Number  | 001                                    |
| Title       | Coding Agent Long-Term Memory          |
| Status      | Draft                                  |
| Created     | 2026-06-26                             |
| Authors     | Agent Memory Working Group             |
| Storage     | `@tobilu/qmd` (SQLite + hybrid search) |

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Motivation](#2-motivation)
3. [Memory Taxonomy](#3-memory-taxonomy)
4. [Autonomous Memory Pipeline](#4-autonomous-memory-pipeline)
5. [Canonical Ingest Pipeline](#5-canonical-ingest-pipeline)
6. [Context Injection](#6-context-injection)
7. [Salience Model & Demotion Protocol](#7-salience-model--demotion-protocol)
8. [Corrections & Failures as First-Class Memory](#8-corrections--failures-as-first-class-memory)
9. [Human Override & Editing](#9-human-override--editing)
10. [qmd Integration Details](#10-qmd-integration-details)
11. [Open Questions](#11-open-questions)
12. [Appendix](#12-appendix)

---

## 1. Abstract

Coding agents operating across multiple sessions suffer from a fundamental amnesia problem: each session begins with zero durable knowledge of past failures, established conventions, or user preferences. This RFC proposes a structured long-term memory system for coding agents that persists knowledge across sessions, surfaces the right facts at the right time, and gives corrections and failures privileged treatment.

The system is organised around **atoms** — typed, versioned, confidence-scored memory units — stored in a hybrid full-text and vector search backend (`@tobilu/qmd`, hereafter "qmd"). An autonomous multi-phase pipeline extracts, validates, and indexes atoms from session observations. A separate canonical ingest pipeline ingests human-authored reference material. At session start, a ranked subset of atoms is injected into the agent's context window; the remainder is queryable on demand via a `memory_search` tool.

The design is deliberately conservative: it prefers fewer high-confidence atoms over many low-quality ones, treats corrections and failures as ground truth, and gives humans unconditional last-resort control over the store.

---

## 2. Motivation

### 2.1 The Three Failure Time-Scales

Coding agent failures manifest at three distinct time-scales, each requiring a different mitigation strategy:

**Time-scale 1 — Single Tool Call (microseconds to seconds)**
A single tool call fails or returns unexpected output. The agent SHOULD retry with adjusted parameters, read the error message, and adapt within the same context window. This is the easiest failure mode to handle because all relevant context is immediately visible.

**Time-scale 2 — Intra-Session Drift (minutes to hours)**
Over the course of a long session, the agent loses track of earlier decisions, starts contradicting its own work, or forgets user corrections given thirty messages ago. Context-window management — summarisation, attention sinks, truncation — partially addresses this, but none of these mechanisms are perfect. The agent SHOULD maintain a running structured observation log within the session to anchor state.

**Time-scale 3 — Cross-Session Amnesia (hours to days to forever)**
The agent completes a session, the context window is cleared, and all learned knowledge vanishes. In the next session the agent repeats the same mistakes, asks the same questions, violates the same conventions, and ignores the same user preferences. **This is the hardest failure mode** because there is no in-context signal that anything was ever known. The agent does not know what it does not remember.

Cross-session amnesia is particularly damaging in coding contexts because:

- Architectural decisions accrue over months, not hours.
- Code style preferences are enforced across every file touched.
- Repeated mistakes waste user trust at a compounding rate.
- Failure patterns from tool calls (e.g. a specific API always requires a header the agent keeps forgetting) never improve without memory.

### 2.2 Why Flat MEMORY.md Files Do Not Scale

A naive solution is to maintain a single `MEMORY.md` file that the agent appends to at session end and reads at session start. This approach fails at scale for several reasons:

1. **Context consumption.** A `MEMORY.md` file injected wholesale into the system prompt grows linearly with agent age. After dozens of sessions it consumes a significant fraction of the context budget, leaving less room for the actual task.

2. **No retrieval selectivity.** All remembered facts are equally visible regardless of relevance. A fact about project A's database schema should not consume context tokens during project B's frontend work.

3. **No confidence or quality tracking.** There is no mechanism to distinguish a well-validated fact from a speculative hypothesis the agent once wrote down. Over time, low-quality entries pollute the store.

4. **No deduplication.** The same fact gets appended multiple times across sessions, inflating the file without adding information.

5. **Brittle to corruption.** A single malformed append can corrupt the entire file's utility.

6. **No audit trail.** When the agent acts on a wrong memory, there is no way to trace where that memory came from or when it was written.

### 2.3 Why Corrections and Failures Must Be First-Class

When a user corrects the agent — "you used the wrong config file format; we always use TOML not JSON" — that correction represents the highest-signal fact available: the agent was definitively wrong, and the user supplied the correct answer. This signal MUST survive every pruning, demotion, and summarisation pass. Treating corrections as ordinary facts (equally subject to salience decay) guarantees they will eventually be forgotten, restoring the failure mode they were meant to prevent.

Failures — failed tool call patterns, incorrect assumption sequences, loops the agent fell into — are the negative complement of corrections. Recording why an approach failed, not just what the correct answer is, gives the agent the ability to reason about its own error modes rather than simply substituting one rote answer for another.

---

## 3. Memory Taxonomy

### 3.1 Scopes

Every atom belongs to exactly one of two scopes:

**Project-level scope (`project`)**
Facts tied to a specific codebase or project: patterns used in that codebase, known bugs in that system, architectural decisions, corrections made during work on that project, project-specific conventions. Project-scope atoms are stored in a per-project qmd store keyed by `project_id`. They are irrelevant to other projects and MUST NOT be injected in sessions for different projects.

**User-level scope (`user`)**
Facts that travel across projects: the user's style preferences, preferred tooling, interaction patterns, general recurring mistakes the agent makes with this user, cross-project skills the agent has mastered. User-scope atoms are stored in a single shared qmd store. They SHOULD be injected in all sessions regardless of project.

### 3.2 Memory Kinds

The following kinds are defined. Each is a first-class type with distinct injection priority, demotion rules, and validation requirements.

| Kind         | Description                                                                          | Scope          | Auto-prune? | Injection Priority |
|--------------|--------------------------------------------------------------------------------------|----------------|-------------|-------------------|
| `correction` | A mistake the agent made plus the correct answer. Ground-truth signal.               | project / user | No          | 1 (highest)       |
| `failure`    | A failed approach, tool call pattern, or reasoning loop. Companion to correction.    | project / user | No          | 2                 |
| `canonical`  | Ground-truth ingested from a human-authored file. Never auto-modified. Can be project-scope or user-scope. | project / user | No          | 3 (search-ranked) |
| `skill`      | A repeatable procedure or multi-step workflow the agent has mastered.                | project / user | Yes         | 4                 |
| `fact`       | A project architectural or domain fact (schema shape, API endpoint, env var name).   | project        | Yes         | 5                 |
| `preference` | User style or tooling preference (indentation, commit message format, tool choice).  | user           | Yes         | 6                 |

> **Note:** `canonical` is a **kind**, not a scope. Canonical atoms can have `scope: project` or `scope: user`. A user-scope canonical atom (e.g. from a personal coding style guide) is stored in the user-scope qmd store. A project-scope canonical atom (e.g. from a repo's CONTRIBUTING.md) is stored in the project-scope store.

### 3.3 Atom Schema

Each memory item — called an **atom** — is stored as a markdown file with YAML frontmatter. The schema is split into three parts: frontmatter (stored in the file), database (stored in Hamiltons's database), and the markdown body.

### Frontmatter

```
id          : string   — nanoid (21-character URL-safe string). Immutable after creation.
title       : string   — Short human-readable title for the atom. Generated by the Phase 3
                         strong model as part of its output. Required.
kind        : enum     — One of: correction, failure, preference, fact, skill, canonical
scope       : enum     — One of: project | user
source      : enum     — How this atom was created:
                           autonomous       — created by the extraction pipeline
                           canonical-ingest — created by the canonical ingest pipeline
                           human            — created or last-edited by a human
confidence  : float    — [0.0, 1.0]. Estimate of atom accuracy.
                         canonical: always 1.0.
                         correction/failure: can only be lowered by human action or
                           a contradicting correction atom (see §8).
status      : enum     — One of: active | demoted | tombstoned
created_at  : datetime — ISO 8601 with timezone. Set at creation; immutable.
updated_at  : datetime — ISO 8601 with timezone. Updated on every write.
project_id  : string   — The project this atom belongs to.
                         NULL for user-scope atoms.
session_id  : string   — ID of the session that created this atom.
tags        : string[] — Free-form tags for filtering and grouping.
demoted_at     : datetime — Timestamp when status was set to demoted. NULL if never demoted.
tombstoned_at  : datetime — Timestamp when status was set to tombstoned. NULL if never.
contradicts    : string[] — List of atom IDs this atom contradicts or supersedes.
```

### Hamilton Database

```
id          : string   — nanoid (21-character URL-safe string). Immutable after creation.
path        : string   — Absolute path to file.
kind        : enum     — One of: correction, failure, preference, fact, skill, canonical
scope       : enum     — One of: project | user
salience    : float    — [0.0, 1.0]. Computed score (see §7). Not stored in
                         frontmatter; recomputed at maintenance time.
status      : enum     — One of: active | demoted | tombstoned
created_at  : datetime — ISO 8601 with timezone. Set at creation; immutable.
updated_at  : datetime — ISO 8601 with timezone. Updated on every write.
project_id  : string   — The project this atom belongs to. NULL for user-scope atoms.
use_count      : integer  — Number of times this atom was retrieved and injected. Defaults to 0.
last_used_at   : datetime — Timestamp of most recent retrieval. NULL until first use.
```

### Markdown body

Content: The memory's substance, written in markdown. For `correction`: includes both the mistake and the fix. For `failure`: includes the failed pattern and (if known) the cause.
---

## 4. Autonomous Memory Pipeline

The autonomous pipeline is triggered at session end. It MAY also be triggered at mid-session checkpoints (e.g. after every N tool calls, or on explicit user request). The pipeline is fully asynchronous relative to the session; the session MUST NOT block waiting for memory writes to complete.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                       AUTONOMOUS MEMORY PIPELINE                               │
│                                                                                │
│  Session Observations                                                          │
│         │                                                                      │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 1    │  Observation Collection                                       │
│  │  Harness    │  Structured event log from the session                        │
│  └──────┬──────┘                                                               │
│         │ structured events (JSON)                                             │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 2    │  Candidate Extraction (Fast Model)                            │
│  │  Fast LLM   │  Proposes draft atoms from events                           │
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
│  │  Phase 4    │  Store Write & Embed                                          │
│  │  qmd writes │  Markdown files + qmd index update                            │
│  └──────┬──────┘                                                               │
│         │ accepted atoms                                                     │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 5    │  Session Summary Fold                                         │
│  │  Audit      │  Append to sessions/<project_id>/YYYY-MM.md                  │
│  └─────────────┘                                                               │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Phase 1 — Observation Collection

The harness (the runtime wrapping the agent) MUST record structured observations throughout the session. Each observation is a JSON event appended to a session-scoped event log. The log is flushed to disk at the end of the session.

Observation kinds:

```
tool_call         — A tool was invoked. Fields: tool_name, arguments, result, success (bool),
                    duration_ms, error_message (if failed).

user_correction   — The user explicitly corrected the agent. Fields: agent_statement,
                    correction_text, turn_index.

user_feedback     — Positive or negative feedback from the user. Fields: sentiment
                    (positive|negative|neutral), text, turn_index.

error_encountered — An exception, assertion failure, or unexpected API response occurred.
                    Fields: error_type, error_message, context, stack_trace.

pattern_repeated  — The same tool call or assertion was repeated N or more times within
                    the session (threshold: N=3). Fields: tool_name, pattern_description,
                    repeat_count.

decision_made     — The agent made a significant architectural or implementation decision.
                    Fields: decision_text, rationale, alternatives_considered.

```

The observation log MUST include session metadata:

```json
{
  "session_id": "<uuid>",
  "project_id": "<project-id or null>",
  "started_at": "<ISO 8601>",
  "ended_at": "<ISO 8601>",
  "task_description": "<user's initial task prompt>",
  "observations": [ ... ]
}
```

### 4.2 Phase 2 — Candidate Extraction (Fast Model)

A lightweight language model (e.g. a smaller/faster model appropriate for structured extraction) receives the session observation log and MUST produce a JSON array of draft atoms. The fast model has NO access to the existing memory store — it only sees the session observations. This isolation prevents the fast model from producing biased candidates that simply echo what is already stored.

**Fast model prompt contract:**

The prompt MUST include:
- The session observation log (as JSON or formatted text)
- The task description
- The atom schema definition
- Instructions to propose candidates only for observations that represent durable, reusable knowledge

The fast model MUST output a JSON array. Each element MUST conform to:

```json
{
  "kind": "<correction|failure|preference|fact|skill>",
  "scope": "<project|user>",
  "content": "<markdown text>",
  "confidence": <float 0.0–1.0>,
  "tags": ["<tag>", ...],
  "source_observation_indices": [<int>, ...]
}
```

Notes:
- `canonical` kind MUST NOT be proposed by the fast model (canonical atoms come only from the canonical ingest pipeline).
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
| `skill`      | Must describe a complete, repeatable procedure. Partial workflows MUST be rejected.       |
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

### 4.4 Phase 4 — Store Write & Embed

After Phase 3 produces the validated list, the pipeline writes each accepted atom to disk and indexes it into qmd.

**For `accept` decisions:**
1. Generate a nanoid as `id` (21-character URL-safe string, collision-resistant).
2. Use the `title` generated by Phase 3 for this atom. Slugify the title (lowercase, spaces replaced with hyphens, special characters stripped) to form the filename slug.
3. Populate all required atom fields with `source: autonomous`, `status: active`, `created_at: now`, `updated_at: now`.
4. Write the atom as a markdown file at `<kind>/<slugified-title>-<id>.md` with YAML frontmatter (see §12 for format).
5. Call `store.addContext()` to register the collection description if this is the first atom of this kind in this store.
6. Index the file into the appropriate qmd collection by calling `store.addCollection()` if the collection does not yet exist, then the store's index update path.
7. Emit an `atom.created` audit event (see §7.4).

**For `merge` decisions:**

When the strong model decides to MERGE a candidate with an existing atom, a new merged atom is created rather than updating in place:
1. Generate a new `title` for the merged atom (reflecting the combined knowledge), as provided by Phase 3 output.
2. Generate a new nanoid as `id` for the merged atom.
3. Slugify the new title to form the filename slug.
4. Create the new merged atom file at `<kind>/<slugified-new-title>-<new-id>.md` with `source: autonomous`, `status: active`, `created_at: now`, `updated_at: now`, and the merged `content`, `confidence`, and `tags` from Phase 3 output.
5. Tombstone the old atom: load the old atom file at its existing path, set `status: tombstoned`, `tombstoned_at: now`.
6. Re-index the new atom in qmd.
7. Re-index the tombstoned old atom in qmd (excluded from future retrieval by status filter).
8. Emit an `atom.merged` audit event referencing both the old atom id (`metadata.old_atom_id`) and the new atom id (`metadata.new_atom_id`).

The old atom file is NOT renamed — it is tombstoned in place. A new file is created with the new `<slugified-title>-<id>.md` name.

**For `supersede` decisions:**
1. Accept the new candidate as per the `accept` path above, including populating `contradicts` with the old atom's ID.
2. Load the old atom, set its `status: tombstoned`, `tombstoned_at: now`. The system MUST emit an `atom.tombstoned` audit event.
3. Re-index the tombstoned atom (it will be excluded from future retrieval by status filter).
4. Emit both `atom.created` (for the new atom) and `atom.tombstoned` (for the old one) audit events.

**For `reject` decisions:**
1. No file is written.
2. The system MUST emit an `atom.rejected` audit event including the rejection reason from Phase 3.

The system MUST emit an audit event for each of the above operations. How audit events are persisted is out of scope for this RFC and left to the implementation.

### 4.5 Phase 5 — Session Summary Fold

After all writes are complete, the pipeline appends a compact structured markdown block to the rolling session fold file at:

```
sessions/<project_id>/YYYY-MM.md
```

For user-scope sessions (no project_id), the path is `sessions/user/YYYY-MM.md`.

The fold block has the following structure:

```markdown
## <session_id> — <YYYY-MM-DD HH:MM UTC>

**Task:** <task_description, first 200 chars>
**Duration:** <session duration>
**Atoms created:** <count>
**Atoms updated:** <count>
**Atoms rejected:** <count>

### New knowledge
- [correction] <brief summary of each accepted correction>
- [failure]    <brief summary of each accepted failure>
- [fact]       <brief summary of each accepted fact>
- [skill]      <brief summary of each accepted skill>
- [preference] <brief summary of each accepted preference>

### Rejections
- <brief reason for each rejected candidate>
```

The session fold file is NOT a memory store. It MUST NOT be injected into the context window and MUST NOT be searched by the retrieval pipeline. It is a human-readable audit trail of what was learned and when. Its only operational use is as input to the `atom.rejected` audit event reconstruction if needed.

---

## 5. Canonical Ingest Pipeline

The canonical ingest pipeline is triggered explicitly by the user with a command such as:

```
memorize file: docs/code-style-guide.md           # scope defaults to project
memorize file: ~/my-coding-style.md scope:user    # user-scope canonical atom
memorize file: docs/architecture.md               # scope defaults to project
memorize url: https://internal.wiki/api-conventions
```

This pipeline ingests authoritative human-authored content and MUST NOT be triggered autonomously.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                       CANONICAL INGEST PIPELINE                                │
│                                                                                │
│  Input: file path / URL / raw text                                             │
│         │                                                                      │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 1    │  Parse & Chunk                                                │
│  │             │  ~900 tokens, smart breakpoints                               │
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
│  │  Phase 3    │  Store & Index                                                │
│  │  qmd writes │  canonical atoms written and indexed                        │
│  └──────┬──────┘                                                               │
│         │                                                                      │
│         ▼                                                                      │
│  ┌─────────────┐                                                               │
│  │  Phase 4    │  Confirmation report to user                                 │
│  └─────────────┘                                                               │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Phase 1 — Parse & Chunk

The input source is loaded and chunked using qmd's native chunking strategy:

- Target chunk size: ~900 tokens.
- Overlap: ~15% (approximately 135 tokens of shared content between adjacent chunks).
- Smart breakpoints: chunks MUST be split at markdown structural boundaries where possible — headings (`#`, `##`, `###`), paragraph boundaries, list item boundaries, fenced code block boundaries. The chunker MUST NOT split inside a code fence.
- AST-aware splitting: the chunker parses the markdown AST and prefers cuts at the same heading level or above, descending to paragraph level only when necessary to meet the token budget.

Each chunk is assigned a zero-indexed `chunk_offset` (ordinal within the source file) and a `chunk_hash` (SHA-256 of the chunk content) for deduplication.

**Supported input formats:**

| Format       | Handling                                              |
|--------------|-------------------------------------------------------|
| Markdown     | Direct AST-aware chunking as described above.         |
| Plain text   | Split by paragraph boundaries (double newline).       |
| PDF          | Text extracted; chunked by paragraph.                 |

Each chunk yields a candidate with:

```json
{
  "kind": "canonical",
  "source_file": "<path or URL>",
  "chunk_offset": <int>,
  "chunk_hash": "<sha256>",
  "content": "<chunk text>",
  "token_estimate": <int>
}
```

### 5.2 Phase 2 — Semantic Deduplication

Before writing, each candidate chunk MUST be compared against the existing qmd store using vector similarity search (`store.searchVector()`). The purpose is to avoid re-ingesting content that is already present, either from a previous ingest of the same file or from another source covering the same material.

**Deduplication rule:** If any existing canonical atom has a cosine similarity ≥ **0.92** with the candidate chunk, the candidate is classified as a near-duplicate and MUST be skipped. The 0.92 threshold is set deliberately high to avoid false positives — only near-identical content should be suppressed. Paraphrased or summarised versions of existing content MUST proceed to Phase 3.

The skipped candidate SHOULD be logged with the ID of the most similar existing atom for the Phase 4 report.

Additionally, the `chunk_hash` MUST be checked against a hash index of existing canonical atoms in the store. An exact hash match is always a skip regardless of the similarity threshold.

### 5.3 Phase 3 — Store & Index

Each non-duplicate candidate is written as a canonical atom:

1. Generate a nanoid as `id` (21-character URL-safe string, collision-resistant).
2. Set fields:
   - `kind: canonical`
   - `source: canonical-ingest`
   - `confidence: 1.0` (canonical atoms are treated as ground truth; this field MUST NOT be modified by any automated process)
   - `status: active`
   - `scope`: the scope specified by the user at ingest time (`project` or `user`). A user-scope canonical atom (e.g. from a personal coding style guide) is stored in the user-scope qmd store; a project-scope canonical atom (e.g. from a repo's CONTRIBUTING.md) is stored in the project-scope store. Defaults to `project` if a project context is active; `user` if not.
   - `tags`: automatically derived from the source file name and any explicit tags provided by the user
   - `created_at`, `updated_at`: now
   - `session_id`: the session in which the ingest was triggered
3. Slugify the title (derived from the source file name and chunk heading, or generated by the ingest pipeline) to form the filename slug. Write to `canonical/<slugified-title>-<id>.md` with YAML frontmatter.
4. Index into the `canonical` collection of the appropriate qmd store.
5. Emit a `canonical.ingested` audit event including: `source_file`, `chunk_offset`, `chunk_hash`, `token_estimate`.

The `canonical` collection MUST be registered with `store.addCollection()` if it does not exist. A context description SHOULD be registered via `store.addContext()`:

```
"canonical" collection context: "Ground-truth reference material ingested from
human-authored files. Treat these as authoritative specifications, style guides,
architectural documents, and API references."
```

### 5.4 Phase 4 — Confirmation

After all writes are complete, the agent MUST report to the user:

```
Canonical ingest complete.
  Source: docs/code-style-guide.md
  Chunks ingested:  14
  Chunks skipped (near-duplicate): 2
  Collection: project/<project_id>/canonical
  Atom IDs: [list of created IDs, or first 5 + "... and N more"]
```

If any chunks were skipped, the agent SHOULD briefly explain why (e.g. "2 chunks were near-identical to content ingested on 2026-05-10").

---

## 6. Context Injection

At the start of each session, the harness MUST retrieve a curated set of atoms and write them to context files that are registered with the agent at session start. This primes the agent with the most relevant durable knowledge for the current task.

### 6.1 Retrieval Strategy

The retrieval strategy is applied in order. Steps are not mutually exclusive; the same atom MUST NOT be injected twice.

**Step 1 — Mandatory correction and failure injection**
Retrieve ALL `active` atoms with `kind IN (correction, failure)` for the current `project_id`. This uses `store.multiGet()` with the full list of correction/failure atom IDs (obtained from an index or by querying the corrections/failures collections by status). There is NO cap on this set — every active correction and failure for the project MUST be injected. This is a hard rule.

For user-scope, retrieve ALL `active` `correction` and `failure` atoms from the user store as well (these are typically user-wide recurring mistakes).

**Step 2 — Canonical retrieval**
Use `store.search()` on the `canonical` collection with the current task prompt as the query. Retrieve the top **K=5** results by hybrid score (BM25 + vector + RRF fusion). Only `active` atoms are considered.

**Step 3 — Fact and skill retrieval**
Use `store.search()` on the `facts` collection with the current task prompt. Retrieve top **K=3** by hybrid score.
Use `store.search()` on the `skills` collection with the current task prompt. Retrieve top **K=3** by hybrid score.

**Step 4 — Preference retrieval**
Query the user-scope qmd store. Use `store.search()` on the `preferences` collection. Retrieve top **K=3** by hybrid score. Preferences are always user-scoped; the query MAY use the task prompt or simply retrieve the top-3 by salience if no good semantic match exists.

**Step 5 — Soft cap enforcement**
After steps 1–4, count the total atoms assembled. If the count exceeds **20**, apply the following priority order to trim to 20:
- All `correction` and `failure` atoms are kept unconditionally (they are never trimmed).
- `canonical` atoms are kept next.
- `skill`, `fact`, `preference` atoms are trimmed from the lowest-score end first.

Atoms trimmed by the soft cap are NOT lost — they remain queryable via `memory_search` and `memory_context` tools (see §6.4 — MCP Tool Surface).

### 6.2 Context File Delivery

The harness materializes the selected atoms into context files on disk. Context files are NOT injected into the system prompt; they are written to a well-known path and registered with the agent runtime using whatever context-file mechanism that runtime supports (e.g. `--context-file`, MCP resource, or a runtime-specific include directive such as `AGENTS.md`-style inclusion).

**Primary context file path:**

```
.agent/context/memory.md
```

This file contains the combined memory context for the session, rendered in the format described in §6.2.1. When atom counts justify separation, the harness MAY additionally write per-kind context files:

```
.agent/context/corrections.md
.agent/context/canonical.md
```

**Lifecycle requirements:**

- Context files MUST be regenerated at each session start. They are ephemeral — they MUST NOT be committed to version control.
- The harness registers the context file(s) with the agent by pointing the agent runtime to `.agent/context/memory.md` (and any per-kind files) at startup.
- The `.agent/context/` directory MUST be listed in `.gitignore` or equivalent.

#### 6.2.1 Context File Format

The atoms are rendered as a structured markdown block written to `.agent/context/memory.md`. The block uses the following format:

```markdown
---
## Agent Memory — Session Context

> The following memories were retrieved from your long-term store.
> CORRECTIONS and FAILURES must be treated as ground truth — do not repeat these mistakes.
> Other items are retrieved as relevant to the current task.

### CORRECTIONS (must not repeat these mistakes)

#### [correction] <atom title or first 80 chars of content>
*Confidence: 0.95 | Project: <project_id> | ID: <id>*

<atom content>

---

### FAILURES (avoid these patterns)

#### [failure] <atom title or first 80 chars of content>
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

### SKILLS

#### [skill] <atom title>
*Confidence: 0.78 | ID: <id>*

<atom content>

---

### PREFERENCES (user preferences)

#### [preference] <atom title>
*Confidence: 0.91 | ID: <id>*

<atom content>

---

*N atoms injected inline. Additional memories available via `memory_search(query)` and `memory_context(query)`.*
---
```

Sections with zero atoms MUST be omitted entirely (do not render an empty section header).

### 6.3 Conditional Injection Rules

Before writing the context file, the harness evaluates the following conditional injection rules to determine which atoms are eligible for materialization. These rules filter the candidate pool assembled by §6.1.

#### Rule A — Language-Based Injection

The harness MUST detect the primary programming language(s) of the project at session start by scanning file extensions or reading a manifest file. Supported manifests include: `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`.

Atoms tagged with a language tag are injected only when that language is detected in the repository. Atoms with no language tag are always eligible.

The harness MUST support at minimum the following language tags:

| Tag               | Language   |
|-------------------|------------|
| `lang:typescript` | TypeScript |
| `lang:javascript` | JavaScript |
| `lang:python`     | Python     |
| `lang:rust`       | Rust       |
| `lang:go`         | Go         |
| `lang:java`       | Java       |

Language detection MUST run once per session start and the result cached for the session lifetime.

#### Rule B — Tag-Based Injection

The harness accepts a **session context descriptor** at startup — a set of tags describing the current task context (e.g. `unit-tests`, `e2e-tests`, `ci`, `migration`, `refactor`, `debugging`). These tags MAY be provided by the user explicitly, inferred from the current working directory, or derived from the task description passed to the agent.

Atoms are eligible for injection if:
- They have no tags (always eligible), OR
- At least one of their tags matches a tag in the session context descriptor (**OR semantics** — an atom qualifies if it matches any one session tag)

Tag-filtered injection applies on top of language filtering: an atom must pass both Rule A and Rule B to be included.

The session context descriptor MUST be recorded in the session's observation log (Phase 1 of the autonomous pipeline) so that extracted atoms can be tagged appropriately.

#### Rule C — Query-Driven Context Loading

This rule operates differently from Rules A and B: rather than filtering atoms at session start, it gives the agent an **on-demand mechanism** to expand its context mid-session based on an arbitrary natural-language query.

The agent calls the `memory_context` MCP tool (defined in §6.4) with a query string. The tool returns a list of `{ id, title, path, kind, score }` results. The agent then loads the atom files at those paths as additional context — either by reading the file content directly or by registering the paths with the harness context loader.

This mechanism enables scenarios such as:
- "Load all atoms related to our database migration patterns"
- "Get context about how we handle authentication errors in this project"
- "What do I know about this user's preferences for error handling?"

Specification requirements for Rule C:

- The agent SHOULD call `memory_context` at the start of any subtask that has a well-defined domain (e.g. before editing auth code, query `"authentication error handling"`).
- The returned `path` values point to atom `.md` files that are self-contained and human-readable — the agent can read them with standard file tools or pass them to a context loader.
- Query-driven loading is **additive**: it does not replace the base context file written at session start; it supplements it.
- The `memory_context` tool uses qmd's hybrid search (BM25 + vector + optional LLM rerank) and SHOULD use `rerank: true` for query-driven loading, since precision matters more than latency in this context.

### 6.4 MCP Tool Surface

The memory system MUST expose the following MCP-compatible tools. These tools are available to the agent throughout the session for on-demand memory access and mid-session recording.

#### `memory_search`

- **Purpose:** Query the atom store with a natural-language or keyword query. Returns ranked atom content suitable for use as context.
- **Inputs:**
  - `query: string` — the search query
  - `scope?: "project" | "user" | "all"` — defaults to `"all"`
  - `kind?: enum` — filter by atom kind (`correction`, `failure`, `preference`, `fact`, `skill`, `canonical`)
  - `tags?: string[]` — filter by tags (AND semantics — atom must have all specified tags)
  - `limit?: integer` — max results, defaults to `MEMORY_SEARCH_DEFAULT_LIMIT`, capped at `MEMORY_SEARCH_MAX_LIMIT`
  - `include_demoted?: boolean` — defaults to `false`
- **Returns:** Array of atom results: `{ id, title, kind, scope, confidence, content, tags, score }`
- **Backed by:** `store.search()` with RRF fusion (lexical + vector)

**Use tracking:** When the agent retrieves atoms via `memory_search`, the harness MUST increment `use_count` and update `last_used_at` for each returned atom. This data feeds the salience model (§7).

#### `memory_get`

- **Purpose:** Retrieve the full content of a specific atom by ID.
- **Inputs:**
  - `id: string` — the atom nanoid
- **Returns:** Full atom: `{ id, title, kind, scope, confidence, status, content, tags, created_at, updated_at }`
- **Backed by:** `store.get(id)`

#### `memory_record`

- **Purpose:** Allow the agent to record a new atom mid-session without waiting for the end-of-session pipeline. Used for high-confidence, time-sensitive observations (e.g., discovering a critical fact mid-task).
- **Inputs:**
  - `kind: enum` — must be one of: `fact`, `preference`, `skill`. **`correction` and `failure` kinds MUST go through the autonomous pipeline, not direct record.**
  - `content: string` — the atom content in markdown
  - `scope?: "project" | "user"` — defaults to `"project"`
  - `tags?: string[]`
  - `confidence?: float` — defaults to `0.6` for mid-session records
- **Behavior:** Generates a nanoid and title (using a fast model), writes the atom file, indexes it in qmd. Sets `source: autonomous`. Emits `atom.created` audit event.
- **Returns:** `{ id, title, path }`
- **Note:** Mid-session records bypass Phase 2 and Phase 3 validation. They SHOULD be reviewed by the end-of-session pipeline (Phase 3 MAY merge or reject them on the next run).

#### `memory_context`

- **Purpose:** Return a set of atom file paths relevant to a query, for the agent to load as additional context. This is the primary tool for **query-driven conditional context loading** (see §6.3, Rule C).
- **Inputs:**
  - `query: string`
  - `scope?: "project" | "user" | "all"`
  - `kind?: enum` — filter by atom kind
  - `tags?: string[]`
  - `limit?: integer` — defaults to `MEMORY_CONTEXT_DEFAULT_LIMIT` (default: 5)
- **Returns:** Array of `{ id, title, path, kind, score }` — the `path` field is the absolute path to the atom's `.md` file on disk, which the agent can load as a context file
- **Backed by:** `store.search()` returning the `path` database field

---

## 7. Salience Model & Demotion Protocol

### 7.1 Salience Formula

Salience is a scalar value in [0.0, 1.0] computed for each non-`canonical`, non-`correction`, non-`failure` atom. `canonical` atoms are exempt from salience-based demotion. `correction` and `failure` atoms have special protection rules (see §8).

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

**`recency_score(updated_at)`** — exponential decay from most recent update:

```
recency_score(t) = exp(−λ_r * age_days(t))
where λ_r = ln(2) / 30   (half-life: 30 days)
```

An atom updated today has `recency_score = 1.0`. An atom last updated 30 days ago has `recency_score ≈ 0.5`. An atom last updated 90 days ago has `recency_score ≈ 0.125`.

**`use_score(use_count, last_used_at)`** — log-scaled use count weighted by recency of last use:

```
use_score = log(1 + use_count) / log(1 + USE_SCALE)
          * exp(−λ_u * age_days(last_used_at))
where USE_SCALE = 20   (tunable; score saturates at ~20 uses)
      λ_u = ln(2) / 14 (half-life: 14 days)
```

If `last_used_at` is NULL (never used), `use_score = 0`. If `use_count = 0`, `use_score = 0`.

**`kind_weight(kind)`**:

| Kind         | Weight |
|--------------|--------|
| `correction` | 1.0    |
| `failure`    | 0.9    |
| `skill`      | 0.8    |
| `fact`       | 0.7    |
| `preference` | 0.6    |
| `canonical`  | exempt |

### 7.2 Salience Computation Schedule

Salience is NOT stored persistently in the atom frontmatter (it would become stale). It is:
1. Recomputed for all active non-exempt atoms during each nightly maintenance run.
2. Recomputed on-demand for an individual atom when it is retrieved (for ranking purposes).
3. The most recently computed value MAY be cached in a separate index table within qmd's SQLite database, tagged with the computation timestamp.

### 7.3 Demotion Protocol

The demotion protocol runs nightly (or on explicit store maintenance invocation). It MUST be applied in the following order:

**Step 1 — Compute salience for all active non-exempt atoms**
For every atom with `status == active` AND `kind NOT IN (correction, failure, canonical)` : compute salience using the formula in §7.1.

**Step 2 — Active → Demoted transition**
For each atom where:
- `salience < 0.25` AND
- `confidence < 0.4`

Set `status = demoted`, `demoted_at = now`. The system MUST emit an `atom.demoted` audit event. The audit event's `metadata` MUST include the computed salience value and each component score.

Demoted atoms are excluded from context injection (§6) and from `memory_search` results by default. They remain on disk and in the qmd index but are filtered by status.

**Step 3 — Demoted → Tombstoned transition**
For each atom where:
- `status == demoted` AND
- `now - demoted_at > 90 days` AND
- `confidence < 0.2`

Set `status = tombstoned`, `tombstoned_at = now`. The system MUST emit an `atom.tombstoned` audit event. Tombstoned atoms remain on disk and in the qmd index (for resurrection purposes) but MUST be excluded from all retrieval and injection.

**Step 4 — Correction and failure protection (enforced)**
The demotion protocol MUST NEVER demote or tombstone an atom with `kind IN (correction, failure)` via the salience pathway. These atoms are only ever demoted or tombstoned by explicit human action (§9) or by a superseding `correction` atom (§4.4, supersede decision). If the protocol encounters a correction or failure atom with low salience, it MUST skip it with no state change.

### 7.4 Audit Event Schema

Every state transition in the system MUST be recorded as an audit event. The audit log is append-only and MUST NOT be modified after writing.

Each audit event is a JSON object with the following fields:

```json
{
  "event_type": "<string>",
  "atom_id": "<nanoid>",

  "timestamp": "<ISO 8601 with timezone>",
  "session_id": "<uuid or null>",
  "actor": "<agent|system|human>",
  "reason": "<human-readable explanation>",
  "metadata": { }
}
```

Defined `event_type` values:

| Event Type           | Trigger                                                         | Actor   |
|----------------------|-----------------------------------------------------------------|---------|
| `atom.created`     | New atom accepted in Phase 4                                  | agent   |
| `atom.updated`     | Existing atom content or confidence modified                  | agent / human |
| `atom.rejected`    | Candidate rejected in Phase 3 (emitted as an audit event only (no atom file))       | agent   |
| `atom.demoted`     | Atom transitioned to demoted status by demotion protocol      | system  |
| `atom.tombstoned`  | Atom transitioned to tombstoned status                        | system / human |
| `atom.resurrected` | Tombstoned atom restored to active status                     | human   |
| `atom.merged`      | Two atoms merged into a new atom; old atom tombstoned         | agent   |
| `canonical.ingested` | Canonical atom created by canonical ingest pipeline           | agent   |
| `atom.forgotten`   | Human directly tombstoned an atom                             | human   |

**Required `metadata` fields by event type:**

`atom.created`:
```json
{
  "kind": "...", "scope": "...", "confidence": 0.0,
  "source_observation_indices": [],
  "phase3_justification": "..."
}
```

`atom.rejected`:
```json
{
  "draft_kind": "...", "draft_content_preview": "...",
  "rejection_reason": "..."
}
```

`atom.demoted`:
```json
{
  "computed_salience": 0.0,
  "salience_components": {
    "confidence_term": 0.0, "recency_term": 0.0,
    "use_term": 0.0, "kind_term": 0.0
  },
  "confidence_at_demotion": 0.0,
  "demoted_at": "<ISO 8601>"
}
```

`atom.tombstoned`:
```json
{
  "days_since_demotion": 0,
  "confidence_at_tombstone": 0.0
}
```

`atom.resurrected`:
```json
{
  "resurrected_by": "<user identifier or human>",
  "reason": "..."
}
```

`canonical.ingested`:
```json
{
  "source_file": "...", "chunk_offset": 0,
  "chunk_hash": "...", "token_estimate": 0
}
```

---

## 8. Corrections & Failures as First-Class Memory

### 8.1 Why They Deserve Special Treatment

Corrections and failures represent the most reliable signal available about the agent's actual, demonstrated failure modes. Unlike `fact` or `preference` atoms — which are derived from the agent's interpretation of session events — corrections are direct user testimony: "you did X wrong; Y is correct." They are not inferences; they are ground truth provided by the authoritative party (the user).

Failures are the negative-space companion: they record what does not work and why, giving the agent something no amount of in-context reasoning can substitute for — a concrete record of its own blind spots.

The cost of losing a correction is higher than the cost of retaining a low-quality `fact`. An agent that forgets a correction will repeat the same mistake in the next session, degrading user trust linearly with time. An agent that retains an outdated `fact` might simply retrieve slightly stale information. The asymmetry is significant.

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

This invariant ensures that a correction the agent received in session 1 is just as authoritatively held in session 100 as it was when it was created.

The same invariant applies to `failure` atoms.

### 8.3 Failure Atom Structure

A `failure` atom MUST document the following three aspects in its `content` field:

1. **The failed action or pattern** — What did the agent do? Be specific. E.g. "Called `npm test` without first running `npm install`, causing module-not-found errors on every attempt in a fresh environment."

2. **The context in which it failed** — When does this failure occur? What preconditions trigger it? E.g. "Occurs in any project where the agent starts a session in a directory that has been cloned but not yet had dependencies installed."

3. **Why it failed (if known)** — The root cause. E.g. "The agent assumed a globally-available `node_modules` from a previous session, but the sandbox resets between sessions."

If the root cause is not known at ingest time, the `content` MUST still include the first two items, and the third SHOULD be marked as unknown: "Root cause: not yet determined."

A failure atom that lacks any of these elements MUST be rejected by Phase 3. The rejection reason MUST reference which element is missing.

### 8.4 Guaranteed Session-Start Injection

At session start (§6.1, Step 1), ALL active `correction` and `failure` atoms for the current project MUST be injected. This is a hard rule with no cap. The rationale:

- A soft cap that could silently exclude corrections would create a category of mistakes the agent is programmed to repeat. This is worse than no memory at all because it creates false confidence.
- The number of active corrections and failures for a given project is bounded in practice (projects with hundreds of corrections indicate a deeper training or calibration problem, not a context budget problem).
- If the total correction/failure set exceeds 20 atoms for a single project, that is a signal for human review and potential consolidation, not a signal to cap injection.

### 8.5 Strict Validation Bar in Phase 3

The Phase 3 strong model applies a higher bar for rejecting `correction` and `failure` candidates:

- The strong model MUST accept any `correction` candidate that references a specific agent mistake and a specific correction, unless it can provide written justification (minimum 2 sentences) explaining why the candidate is invalid or already covered by an existing atom.
- The strong model MUST accept any `failure` candidate that describes a specific, non-trivial failure pattern with at least the first two elements (failed action + context), unless it provides written justification for rejection.
- "Too similar to an existing atom" is a valid reason for rejection only if the existing atom covers the same specific failure mode. Approximate or general similarity is NOT sufficient to reject a `correction` or `failure` candidate.
- A `merge` decision for a correction/failure requires that the merge target be of the same kind and describes the same specific failure. A more general existing atom MUST NOT absorb a specific new correction via merge.

---

## 9. Human Override & Editing

The memory store is primarily agent-managed, but humans retain unconditional last-resort control over all atoms. The following operations are available to humans at any time.

The permanent escape hatch from salience decay is promoting an atom to `canonical` kind. A human may change any atom's `kind` to `canonical` (via the Edit action in §9.1), which exempts it permanently from salience-based demotion. `canonical` kind atoms are never auto-modified by the autonomous pipeline and are treated as ground truth.

### 9.1 Edit

A human may edit any atom's `content`, `confidence`, `tags`, or `kind` field directly. Editing through any interface MUST:
1. Update the atom's `updated_at` to now.
2. Set `source: human` on the modified atom.
3. Append an `atom.updated` audit event with `actor: human`.
4. Re-index the updated atom in qmd.

Humans MAY lower the `confidence` of a `correction` or `failure` atom. This is the only automated-pipeline-equivalent action available to humans that can reduce correction confidence (the autonomous pipeline cannot).

### 9.2 Forget (Immediate Tombstone)

A human may immediately tombstone any atom, regardless of kind, status, or confidence. This is the "forget this" command:
1. Sets `status: tombstoned`, `tombstoned_at: now`.
2. Emits an `atom.forgotten` audit event with `actor: human`.
3. The atom is immediately excluded from all retrieval and injection.
4. The atom file and qmd index entry are retained (to preserve the audit trail).

Tombstoned atoms can be resurrected (§9.3) or permanently deleted. **Permanent deletion** removes the file, removes it from the qmd index, and emits a final audit event. After permanent deletion the atom cannot be resurrected.

### 9.3 Resurrect

A human may resurrect any tombstoned atom (regardless of whether it was tombstoned by the system or by a human forget action):
1. Sets `status: active`, clears `tombstoned_at` and `demoted_at`.
2. Resets `confidence` to a human-specified value (defaults to 0.5 if not specified).
3. Sets `source: human`.
4. Emits an `atom.resurrected` audit event with `actor: human`, including `reason`.
5. Re-indexes the atom in qmd.

### 9.4 Canonical Atom Special Rules

`canonical` atoms MAY NOT be modified, demoted, tombstoned, or deleted by the autonomous pipeline under any circumstances. All changes to canonical atoms MUST be initiated by a human action. The pipeline treats them as read-only inputs.

A `canonical` atom that has been superseded by a newer version of the source document SHOULD be tombstoned by the human before re-ingesting the updated file. The canonical ingest pipeline's deduplication step (§5.2) will then treat the new content as novel.

### 9.5 Audit Completeness

Every human action described in §9.1–9.4 MUST emit a corresponding audit event with `actor: human`. How audit events are persisted is out of scope for this RFC and left to the implementation. Human-initiated actions SHOULD include a `reason` field. The audit log MUST be treated as immutable — entries cannot be edited or deleted. If a human action needs to be reversed, a subsequent action (e.g. resurrect after forget) creates a new event; it does not modify the original.

---

## 10. qmd Integration Details

### 10.1 Store Layout

Two qmd stores are maintained per agent installation:

**Project store** (one per project):
```
~/.agent/memory/projects/<project_id>/
  qmd.db                     ← SQLite database (BM25 FTS5 + vector embeddings)
  corrections/               ← Atom markdown files, kind=correction
  failures/                  ← Atom markdown files, kind=failure
  facts/                     ← Atom markdown files, kind=fact
  skills/                    ← Atom markdown files, kind=skill
  canonical/                 ← Atom markdown files, kind=canonical
  sessions/<project_id>/     ← Session fold files (YYYY-MM.md)
  audit/                     ← Audit event logs (implementation-defined format)
```

**User store** (one per user, shared across projects):
```
~/.agent/memory/user/
  qmd.db                     ← SQLite database
  corrections/               ← User-scope corrections
  failures/                  ← User-scope failures
  preferences/               ← Atom markdown files, kind=preference
  skills/                    ← User-scope skills
  canonical/                 ← User-scope canonical atoms
  sessions/user/             ← Session fold files
  audit/                     ← Audit event logs
```

`preferences` collection exists only in the user store. Project-scope atoms MUST NOT be written to the user store.

### 10.2 Store Initialisation

```typescript
import { createStore } from '@tobilu/qmd';

// Project store
const projectStore = await createStore({
  dbPath: `~/.agent/memory/projects/${projectId}/qmd.db`
});

// User store
const userStore = await createStore({
  dbPath: `~/.agent/memory/user/qmd.db`
});
```

`createStore` initialises the SQLite database if it does not exist, creates the FTS5 virtual tables, and prepares the embedding index. It is idempotent.

### 10.3 Collections

Each kind maps to a named qmd collection. Collections MUST be registered before first use:

```typescript
await store.addCollection({
  name: 'corrections',
  description: 'Mistakes the agent made and their corrections. '
    + 'Highest-priority memory. Always injected at session start. '
    + 'Treat as ground truth.',
  basePath: `~/.agent/memory/projects/${projectId}/corrections`
});

await store.addCollection({
  name: 'failures',
  description: 'Failed approaches, tool call patterns, and reasoning loops '
    + 'that the agent fell into. Companion to corrections.',
  basePath: `~/.agent/memory/projects/${projectId}/failures`
});

await store.addCollection({
  name: 'facts',
  description: 'Project architectural and domain facts: schema shapes, '
    + 'API endpoints, environment variable names, infrastructure details.',
  basePath: `~/.agent/memory/projects/${projectId}/facts`
});

await store.addCollection({
  name: 'skills',
  description: 'Repeatable multi-step procedures and workflows the agent '
    + 'has learned for this project.',
  basePath: `~/.agent/memory/projects/${projectId}/skills`
});

await store.addCollection({
  name: 'canonical',
  description: 'Ground-truth reference material ingested from human-authored '
    + 'files. Treat as authoritative specifications and style guides. '
    + 'Both the project store and user store have a canonical collection; '
    + 'scope (project or user) is determined at ingest time.',
  basePath: `~/.agent/memory/projects/${projectId}/canonical`  // or userStore canonical
});
```

Context descriptions are registered via `store.addContext()` to provide LLM-aware retrieval hints:

```typescript
await store.addContext({
  key: 'memory-system',
  value: 'This store contains long-term memory for a coding agent. '
    + 'Collections: corrections (agent mistakes + fixes), '
    + 'failures (failed patterns), facts (project knowledge), '
    + 'skills (workflows), canonical (reference docs). '
    + 'Prioritise corrections and failures in retrieval.'
});
```

### 10.4 Core Operations

**Hybrid search (primary retrieval path):**

```typescript
const results = await store.search({
  query: taskPrompt,
  collections: ['facts', 'skills'],    // optional collection filter
  status: 'active',                    // filter by atom status
  limit: 5,
  rerank: true                         // enable LLM reranking if available
});
// results: Array<{ docid, title, displayPath, context, score, snippet }>
```

**Lexical search (BM25/FTS5 only):**

```typescript
const results = await store.searchLex({
  query: 'npm install dependencies',
  collections: ['failures'],
  limit: 10
});
```

**Vector search (embeddings only):**

```typescript
const results = await store.searchVector({
  query: chunkContent,
  collections: ['canonical'],
  limit: 5
});
// Used in canonical ingest deduplication (§5.2)
```

**Bulk fetch by ID (used for correction/failure injection):**

```typescript
const atoms = await store.multiGet({
  ids: correctionAndFailureIds,  // pre-indexed list of active correction/failure IDs
  collections: ['corrections', 'failures']
});
```

**Single fetch:**

```typescript
const atom = await store.get({ id: atom_id });
```

### 10.5 Scoring and Ranking

qmd's hybrid search pipeline:

1. **BM25 (FTS5)** — lexical retrieval from SQLite's full-text search index. Fast, keyword-sensitive.
2. **Vector embeddings** — semantic retrieval using dense embedding vectors stored in the SQLite database.
3. **RRF fusion** — Reciprocal Rank Fusion merges the BM25 and vector ranked lists into a single score: `RRF_score(d) = 1/(k + rank_bm25(d)) + 1/(k + rank_vector(d))` where `k=60` is the standard constant.
4. **LLM reranking (optional)** — When `rerank: true`, a language model re-scores the top-N candidates for relevance to the query. Used for context injection where precision matters more than latency.

Result fields returned by `store.search()`: `docid`, `title`, `displayPath`, `context`, `score`, `snippet`.

### 10.6 Atom File and Index Lifecycle

**On create (Phase 4, §4.4):**
```
write: <kind>/<slugified-title>-<id>.md
index: store adds to collection, generates embeddings, updates FTS5
```

**On update (merge, human edit, demotion):**
```
write: <kind>/<slugified-title>-<id>.md  (update frontmatter and content)
index: store.update() re-embeds and re-indexes the file
```

**On tombstone:**
```
write: <kind>/<slugified-title>-<id>.md  (update status field in frontmatter)
index: re-index with status=tombstoned (excluded from searches by default)
```

**On resurrect:**
```
write: <kind>/<slugified-title>-<id>.md  (update status, clear tombstoned_at)
index: re-index with status=active
```

### 10.7 ID Index for Corrections and Failures

Because corrections and failures must be bulk-fetched at every session start (§6.1 Step 1), maintaining a separate index of their IDs is more efficient than a full-collection scan. The harness MUST maintain a lightweight index:

```
~/.agent/memory/projects/<project_id>/correction-index.json
~/.agent/memory/projects/<project_id>/failure-index.json
```

Each file is a JSON array of `{ id, status, updated_at }` records. The index is updated atomically whenever a correction or failure atom is created, updated, tombstoned, or resurrected. The harness reads this index at session start to determine which IDs to pass to `store.multiGet()`.

---

## 11. Open Questions

The following questions are raised by this RFC but are not resolved within it. They are marked for future RFCs or implementation decisions.

**Q1: Multi-agent conflict resolution**
When multiple agent instances operate on the same project simultaneously (e.g. parallel agents in a CI pipeline), how are concurrent writes to the memory store serialised? SQLite's WAL mode handles single-process concurrency, but multi-process concurrent writes to the same qmd.db require coordination. An advisory lock file or write queue MAY suffice, but the semantics of conflicting Phase 3 decisions (two agents independently concluding contradictory things in the same session window) have not been defined.

**Q2: Memory migration across project renames and merges**
When a project is renamed, the `project_id` embedded in atom metadata and store paths becomes stale. When two projects are merged (e.g. a monorepo consolidation), their memory stores may contain overlapping or conflicting facts. No migration tooling or resolution strategy is defined in this RFC. A `memory migrate` command with conflict detection is anticipated but not specified.

**Q3: Privacy and PII in user-scope memories**
User-scope atoms may capture personally identifying information if the user's corrections or preferences reference names, email addresses, or other PII. The current design has no PII-scrubbing step in the extraction pipeline. A redaction pass in Phase 2 or Phase 3 could be added, but the definition of PII in a coding context (is a developer's GitHub username PII?) is not obvious. This RFC does not define a privacy model.

**Q4: Cross-project skill promotion**
A `skill` atom learned in project A (e.g. "how to profile memory usage with valgrind in this codebase") may be generally applicable and worth promoting to user-scope. No mechanism for cross-project skill promotion is defined. A periodic review job that identifies high-confidence, high-use project-scope skills as candidates for user-scope promotion is anticipated but not specified. The promotion threshold and process need to be defined.

**Q5: Embedding model versioning and re-indexing**
The vector index in qmd is dependent on the embedding model used at ingest time. If the embedding model is upgraded, existing embeddings become incompatible with new query vectors. No re-indexing or embedding migration strategy is defined in this RFC. A full re-embed pass is the obvious solution, but for large stores with thousands of atoms this is expensive and must be coordinated with store availability.

**Q6: Adversarial memory injection**
If an agent can be prompted to create atoms autonomously, a malicious or poorly-crafted prompt could cause the agent to write false corrections or facts that persist across sessions (prompt injection attacks against long-term memory). The current Phase 3 validation model provides some defence, but it is not a security boundary. Hardened environments MAY wish to require human approval for all new `correction` and `fact` atoms. No threat model or approval workflow is defined in this RFC.

---

## 12. Appendix

### A. Atom Markdown File Format

All atom files are stored as markdown with YAML frontmatter. The frontmatter contains all structured metadata; the markdown body contains the human-readable `content` field. 

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
project_id: "acme-api"
session_id: "sess_9d8e7f6a5b4c3d2e"
tags:
  - typescript
  - config
  - toml
demoted_at: null
tombstoned_at: null
contradicts: []
---

# Config file format must be TOML, not JSON

## Mistake

The agent wrote project configuration files as JSON (e.g. `project.config.json`)
using the standard Node.js `JSON.parse` / `JSON.stringify` pattern.

## Correction

All configuration files in the `acme-api` project MUST use TOML format.
The configuration loader is `@acme/config-loader` which only accepts `.toml` files.
JSON configuration files will be silently ignored by the loader.

## Correct approach

```toml
# project.config.toml
[server]
port = 3000
host = "localhost"

[database]
url = "postgres://localhost:5432/acme"
pool_size = 10
```

Use the `@iarna/toml` library to read and write TOML programmatically:
```typescript
import * as TOML from '@iarna/toml';
const config = TOML.parse(fs.readFileSync('project.config.toml', 'utf8'));
```
```

---

### B. Audit Event JSON Example

The following shows a sequence of audit events as they would appear in `audit/2026-06.jsonl` (one JSON object per line):

```jsonl
{"event_type":"atom.created","atom_id":"7f3a2b1c-8e4d-4f5a-9b6c-0d1e2f3a4b5c","timestamp":"2026-06-15T14:23:11Z","session_id":"sess_9d8e7f6a5b4c3d2e","actor":"agent","reason":"Accepted by Phase 3 validation. Correction references specific user statement at turn 12.","metadata":{"kind":"correction","scope":"project","confidence":0.92,"source_observation_indices":[4,7],"phase3_justification":"User explicitly corrected agent's use of JSON config files. Correction is specific and actionable."}}
{"event_type":"atom.created","atom_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","timestamp":"2026-06-15T14:23:12Z","session_id":"sess_9d8e7f6a5b4c3d2e","actor":"agent","reason":"Accepted failure atom. Pattern repeated 4 times within session.","metadata":{"kind":"failure","scope":"project","confidence":0.87,"source_observation_indices":[2,5,8,11],"phase3_justification":"Agent called npm test before npm install on 4 separate occasions. Clear repeating failure pattern."}}
{"event_type":"atom.rejected","atom_id":null,"timestamp":"2026-06-15T14:23:13Z","session_id":"sess_9d8e7f6a5b4c3d2e","actor":"agent","reason":"Candidate fact too vague to be actionable.","metadata":{"draft_kind":"fact","draft_content_preview":"The project uses a database.","rejection_reason":"Content is too generic to constitute useful project knowledge. All projects use databases. No specific schema, ORM, or connection detail provided."}}
{"event_type":"canonical.ingested","atom_id":"c0ffee00-1234-5678-9abc-def012345678","timestamp":"2026-06-18T10:05:33Z","session_id":"sess_aaabbbccc111222","actor":"agent","reason":"Chunk 3 of 14 from docs/code-style-guide.md ingested successfully.","metadata":{"source_file":"docs/code-style-guide.md","chunk_offset":2,"chunk_hash":"sha256:8f4e2a1b9c3d5e7f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f","token_estimate":847}}
{"event_type":"atom.demoted","atom_id":"deadbeef-dead-beef-dead-beefdeadbeef","timestamp":"2026-09-14T02:00:00Z","session_id":null,"actor":"system","reason":"Salience below threshold (0.17 < 0.25) and confidence below threshold (0.31 < 0.40) after nightly maintenance run.","metadata":{"computed_salience":0.17,"salience_components":{"confidence_term":0.109,"recency_term":0.044,"use_term":0.000,"kind_term":0.105},"confidence_at_demotion":0.31,"demoted_at":"2026-09-14T02:00:00Z"}}
{"event_type":"atom.tombstoned","atom_id":"deadbeef-dead-beef-dead-beefdeadbeef","timestamp":"2026-12-14T02:00:00Z","session_id":null,"actor":"system","reason":"Atom demoted for more than 90 days with confidence below 0.20.","metadata":{"days_since_demotion":91,"confidence_at_tombstone":0.18}}
{"event_type":"atom.resurrected","atom_id":"deadbeef-dead-beef-dead-beefdeadbeef","timestamp":"2026-12-15T11:30:00Z","session_id":"sess_xyz123","actor":"human","reason":"User confirmed this fact is still accurate after reviewing the tombstoned atom.","metadata":{"resurrected_by":"user","reason":"Reviewed content; still accurate. Tombstone was premature due to project being paused for 3 months, not because the fact became stale."}
```

---

### C. Session-Start Context File Example

The following shows the memory block as it would be written to `.agent/context/memory.md` at the start of a session for project `acme-api`. Two corrections exist for this project, one canonical chunk was retrieved as relevant, two facts, one skill, and two user preferences.

```markdown
---
## Agent Memory — Session Context

> The following memories were retrieved from your long-term store for project `acme-api`.
> CORRECTIONS and FAILURES must be treated as ground truth — do not repeat these mistakes.
> Canonical reference material reflects the authoritative specification for this project.
> Other items are retrieved as relevant to the current task.

### CORRECTIONS (must not repeat these mistakes)

#### [correction] Config file format must be TOML, not JSON
*Confidence: 0.92 | Project: acme-api | Last used: 2026-06-20 | ID: 7f3a2b1c*

All configuration files in the `acme-api` project MUST use TOML format.
The configuration loader is `@acme/config-loader` which only accepts `.toml` files.
JSON configuration files will be silently ignored by the loader.

Use `@iarna/toml` for programmatic read/write. Config file naming convention: `<name>.config.toml`.

---

#### [correction] Do not modify files in the `dist/` directory directly
*Confidence: 0.96 | Project: acme-api | Last used: 2026-06-18 | ID: 2a3b4c5d*

The `dist/` directory is generated by the build process (`npm run build`). Any direct
edits to files in `dist/` are overwritten on the next build. Always edit source files
in `src/` and rebuild.

---

### FAILURES (avoid these patterns)

#### [failure] Running npm test before npm install in a fresh environment
*Confidence: 0.87 | Project: acme-api | Last used: 2026-06-15 | ID: a1b2c3d4*

**Failed pattern:** Calling `npm test` immediately after cloning or checking out
the repository, before running `npm install`.

**Context:** Occurs in any fresh sandbox or CI environment where `node_modules` is not present.

**Why it fails:** The agent assumes `node_modules` from a previous session, but the
sandbox resets between sessions. Every fresh environment requires `npm install` first.

**Correct sequence:**
1. `npm install`
2. `npm run build` (if required)
3. `npm test`

---

### REFERENCE (canonical knowledge)

#### [canonical] Code Style Guide — TypeScript Naming Conventions
*Confidence: 1.0 | Source: docs/code-style-guide.md (chunk 3) | ID: c0ffee00*

**Interfaces:** PascalCase, no `I` prefix. Example: `UserRepository`, not `IUserRepository`.
**Types:** PascalCase. Example: `ApiResponse<T>`.
**Enums:** PascalCase for the enum name; SCREAMING_SNAKE_CASE for values.
  Example: `enum HttpStatus { OK = 200, NOT_FOUND = 404 }`
**Functions:** camelCase. Example: `getUserById`.
**Constants:** SCREAMING_SNAKE_CASE for module-level constants.
**Private class members:** no underscore prefix; use `private` keyword only.

---

### FACTS

#### [fact] Database ORM: Prisma with PostgreSQL
*Confidence: 0.89 | Project: acme-api | ID: f1e2d3c4*

The project uses Prisma as its ORM. The schema file is `prisma/schema.prisma`.
Database: PostgreSQL 15. Connection string env var: `DATABASE_URL`.
Run `npx prisma generate` after schema changes. Run `npx prisma db push` for dev migrations.

---

#### [fact] Authentication: JWT with RS256, keys in environment
*Confidence: 0.85 | Project: acme-api | ID: e5f6a7b8*

JWT tokens use RS256 (asymmetric). Public key: `JWT_PUBLIC_KEY` env var (PEM format).
Private key: `JWT_PRIVATE_KEY` env var (PEM format). Token expiry: 1 hour access,
7 days refresh. Tokens are verified in `src/middleware/auth.middleware.ts`.

---

### SKILLS

#### [skill] Running the full test suite with coverage report
*Confidence: 0.82 | Project: acme-api | ID: b9c0d1e2*

```bash
npm install                    # ensure dependencies are present
npm run build                  # compile TypeScript
npm test -- --coverage         # run Jest with coverage
# Coverage report output: coverage/lcov-report/index.html
# Minimum coverage threshold: 80% (configured in jest.config.ts)
```

If tests fail with "Cannot find module", run `npm run build` first — some tests import
from compiled output.

---

### PREFERENCES (user preferences)

#### [preference] Commit message style: Conventional Commits
*Confidence: 0.94 | Scope: user | ID: d3e4f5a6*

Always use Conventional Commits format: `type(scope): description`.
Types: feat, fix, refactor, docs, chore, test, perf.
Example: `feat(auth): add refresh token rotation`.
Do not use past tense ("added X") — use imperative ("add X").

---

#### [preference] Prefer explicit error types over generic Error
*Confidence: 0.88 | Scope: user | ID: f7a8b9c0*

When throwing or returning errors, use specific typed error classes rather than
`new Error("message")`. The project has `src/errors/` with `AppError`, `NotFoundError`,
`ValidationError`, `UnauthorizedError`. Always use the most specific type.

---

*9 atoms injected inline. Additional memories available via `memory_search(query)`.*
---
```

---

*End of RFC-001*

---

## 13. Implementation Reference

This section provides additional implementation guidance for engineers building the system described in this RFC.

### 13.1 Pipeline Orchestration

The autonomous memory pipeline (§4) MUST be orchestrated as an independent, fault-tolerant background process. The session MUST NOT block on pipeline completion. The recommended model is:

1. At session end, the harness serialises the observation log to a staging file: `sessions/<project_id>/pending/<session_id>.jsonl`.
2. A pipeline worker process (daemon or cron) picks up pending session files, runs Phases 2–5, and moves processed files to `sessions/<project_id>/processed/<session_id>.jsonl`.
3. If the pipeline fails at any phase, the staging file is moved to `sessions/<project_id>/failed/<session_id>.jsonl` along with an error log. A human or a retry mechanism can re-trigger the pipeline.

This model ensures:
- Session files are never lost even if the pipeline crashes mid-execution.
- Idempotent retry: re-running the pipeline on the same session file MUST produce the same result (Phase 3 deduplication prevents double-writes).
- The agent's session latency is not affected by memory pipeline performance.

**Retry policy:**
- Phase 2 (fast model) failures: retry up to 3 times with exponential backoff (5s, 15s, 45s). After 3 failures, skip Phase 2 and move to failed.
- Phase 3 (strong model) failures: retry up to 2 times. After 2 failures, write all Phase 2 candidates with a `pending_validation` status and flag for human review.
- Phase 4 (store write) failures: individual atom write failures MUST be logged and retried independently. A failure to write one atom MUST NOT prevent others from being written.
- Phase 5 (fold) failures: non-fatal. Log the error and continue. The fold file is audit-only.

### 13.2 Observation Log Implementation Notes

The harness MUST hook into the following agent lifecycle events to populate the observation log:

```typescript
interface HarnessHooks {
  // Called before every tool execution
  onBeforeToolCall(tool: string, args: Record<string, unknown>): void;

  // Called after every tool execution (success or failure)
  onAfterToolCall(
    tool: string,
    args: Record<string, unknown>,
    result: unknown,
    success: boolean,
    durationMs: number,
    error?: Error
  ): void;

  // Called when the user sends a message that follows an agent message
  // containing a specific assertion or claim (for correction detection)
  onUserMessage(
    content: string,
    turnIndex: number,
    precedingAgentContent: string
  ): void;

  // Called when an unhandled exception propagates to the harness
  onError(error: Error, context: string): void;

  // Called when the same tool+args pattern repeats N times
  onPatternRepeat(tool: string, pattern: string, count: number): void;

  // Called at session end
  onSessionEnd(summary: SessionSummary): void;
}
```

The harness is responsible for detecting `user_correction` observations. A heuristic approach:
- If the user's message begins with a negation word ("no", "actually", "that's wrong", "incorrect", "not") or contains an explicit correction phrase ("you should", "you need to", "the correct way is", "don't do that"), flag the observation as a potential correction.
- Pass the flagged observation and the immediately preceding agent message to Phase 2 as a `user_correction` event for the fast model to evaluate.

The harness MUST NOT make a definitive determination of whether something is a correction — that is the job of the Phase 2 and Phase 3 models. The harness only provides raw signal.

### 13.3 Phase 2 Prompt Template

The following is the normative prompt template for the Phase 2 fast model. Implementors MUST preserve the structural requirements; the exact wording MAY be adjusted.

```
You are a memory extraction agent for a coding assistant. Your job is to review
a coding session's observation log and identify facts worth remembering long-term.

## Session Metadata
Session ID: {session_id}
Project ID: {project_id}
Task: {task_description}
Duration: {duration}

## Observation Log
{observation_log_as_formatted_text}

## Instructions
Review the observations above and propose memory items (atoms) to store for future sessions.

Rules:
1. Only propose items that are DURABLE and REUSABLE — useful in future sessions, not just in this one.
2. You MUST propose all corrections and failures you find. Do not skip these.
3. For facts, skills, and preferences: only propose if you are reasonably confident (>0.6) they are accurate.
4. Do not propose trivially obvious items ("use npm to install packages").
5. Maximum 20 candidates total. Prioritise corrections and failures over other kinds.
6. For corrections: include both the mistake AND the correct approach in the content.
7. For failures: include the failed pattern, the context, and the cause if known.
8. Write content in clear, imperative markdown suitable for injection into a future system prompt.

## Output Format
Respond with ONLY a JSON array (no prose, no markdown fencing). Each element:
{
  "kind": "correction" | "failure" | "preference" | "fact" | "skill",
  "scope": "project" | "user",
  "content": "<markdown>",
  "confidence": <0.0-1.0>,
  "tags": ["<tag>"],
  "source_observation_indices": [<int>]
}
```

### 13.4 Phase 3 Prompt Template

```
You are a memory validation agent for a coding assistant. Your job is to validate,
deduplicate, and finalise proposed memory items against the existing memory store.

## Session Metadata
Session ID: {session_id}
Project ID: {project_id}
Task: {task_description}

## Proposed Candidates
{candidates_as_json}

## Existing Relevant Atoms (retrieved per candidate)
{existing_atoms_per_candidate}

## Instructions
For each candidate, make one of these decisions: accept, reject, merge, or supersede.

Decision criteria:
- accept:    Valid, novel, and not already covered by existing atoms.
- reject:    Invalid, too vague, trivially obvious, or already well-covered.
- merge:     Near-duplicate of an existing atom. Refine the existing one.
- supersede: Directly contradicts an existing atom. Replace the old one.

STRICT RULES for corrections and failures:
- You MUST accept a correction candidate unless you write at least 2 sentences
  of explicit justification explaining why it is invalid or already covered.
  "Similar to existing" is not sufficient — the existing atom must cover the
  EXACT SAME mistake in the EXACT SAME context.
- You MUST accept a failure candidate that documents a specific repeating pattern
  with at least: (1) the failed action, (2) the context. Missing cause is okay.
- A merge of a correction/failure requires the merge target to be the SAME specific
  failure mode, not a more general one.

Confidence adjustment:
- Increase confidence if multiple observations support the candidate.
- Decrease confidence if the evidence is ambiguous or indirect.
- Corrections and failures: minimum confidence 0.75 if evidence is strong.
- Never set confidence above 1.0 or below 0.0.

## Output Format
Respond with ONLY a JSON object (no prose, no markdown fencing):
{
  "validated": [
    {
      "decision": "accept" | "merge" | "supersede",
      "draft_index": <int>,
      "title": "<short human-readable title for this atom>",
      "kind": "...",
      "scope": "...",
      "content": "<revised markdown>",
      "confidence": <float>,
      "tags": [...],
      "merge_target_id": "<nanoid or null>",
      "contradicts": ["<nanoid>"],
      "justification": "<required for correction/failure rejections; optional otherwise>"
    }
  ],
  "rejected": [
    {
      "draft_index": <int>,
      "reason": "<why rejected>"
    }
  ]
}
```

### 13.5 qmd Store Maintenance Script

The following pseudocode describes the nightly maintenance job (§7.3):

```python
#!/usr/bin/env python3
"""
Nightly memory store maintenance.
Runs salience computation and demotion protocol.
"""
import math
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

W_CONF    = 0.35
W_RECENCY = 0.25
W_USE     = 0.25
W_KIND    = 0.15

HALF_LIFE_RECENCY_DAYS = 30
HALF_LIFE_USE_DAYS     = 14
USE_SCALE              = 20

LAMBDA_R = math.log(2) / HALF_LIFE_RECENCY_DAYS
LAMBDA_U = math.log(2) / HALF_LIFE_USE_DAYS

KIND_WEIGHTS = {
    'correction': 1.0,
    'failure':    0.9,
    'skill':      0.8,
    'fact':       0.7,
    'preference': 0.6,
    'canonical':  None,  # exempt
}

DEMOTION_SALIENCE_THRESHOLD   = 0.25
DEMOTION_CONFIDENCE_THRESHOLD = 0.40
TOMBSTONE_DAYS_THRESHOLD      = 90
TOMBSTONE_CONFIDENCE_THRESHOLD = 0.20

def recency_score(updated_at: datetime) -> float:
    age_days = (datetime.now(timezone.utc) - updated_at).days
    return math.exp(-LAMBDA_R * age_days)

def use_score(use_count: int, last_used_at: datetime | None) -> float:
    if use_count == 0 or last_used_at is None:
        return 0.0
    log_uses = math.log(1 + use_count) / math.log(1 + USE_SCALE)
    age_days = (datetime.now(timezone.utc) - last_used_at).days
    recency_factor = math.exp(-LAMBDA_U * age_days)
    return log_uses * recency_factor

def compute_salience(atom: dict) -> dict:
    kind = atom['kind']
    kw = KIND_WEIGHTS.get(kind, 0.6)
    conf = atom['confidence']
    r_score = recency_score(atom['updated_at'])
    u_score = use_score(atom.get('use_count', 0), atom.get('last_used_at'))

    conf_term    = W_CONF    * conf
    recency_term = W_RECENCY * r_score
    use_term     = W_USE     * u_score
    kind_term    = W_KIND    * kw
    total        = conf_term + recency_term + use_term + kind_term

    return {
        'salience': total,
        'components': {
            'confidence_term': round(conf_term, 4),
            'recency_term':    round(recency_term, 4),
            'use_term':        round(use_term, 4),
            'kind_term':       round(kind_term, 4),
        }
    }

def run_demotion(store_path: Path, project_id: str, session_id: str = None):
    """
    Step through all active non-exempt atoms and apply demotion rules.
    """
    now = datetime.now(timezone.utc)
    audit_path = store_path / 'audit' / f"{now.strftime('%Y-%m')}.jsonl"

    for kind_dir in ['facts', 'skills', 'preferences']:
        for atom_file in (store_path / kind_dir).glob('*.md'):
            atom = load_atom(atom_file)

            # Skip exempt kinds and protected atoms
            if atom['kind'] in ('correction', 'failure', 'canonical'):
                continue
            # Exempt: kind == canonical (already handled above)
            if atom['status'] != 'active':
                # Check tombstone transition for demoted atoms
                if atom['status'] == 'demoted' and atom.get('demoted_at'):
                    days_demoted = (now - atom['demoted_at']).days
                    if (days_demoted > TOMBSTONE_DAYS_THRESHOLD
                            and atom['confidence'] < TOMBSTONE_CONFIDENCE_THRESHOLD):
                        atom['status'] = 'tombstoned'
                        atom['tombstoned_at'] = now.isoformat()
                        save_atom(atom_file, atom)
                        reindex(store_path, atom)
                        emit_audit(audit_path, {
                            'event_type': 'atom.tombstoned',
                            'atom_id': atom['id'],
                            'timestamp': now.isoformat(),
                            'session_id': session_id,
                            'actor': 'system',
                            'reason': f'Demoted for {days_demoted} days with confidence < {TOMBSTONE_CONFIDENCE_THRESHOLD}',
                            'metadata': {
                                'days_since_demotion': days_demoted,
                                'confidence_at_tombstone': atom['confidence']
                            }
                        })
                continue

            result = compute_salience(atom)
            salience = result['salience']

            if salience < DEMOTION_SALIENCE_THRESHOLD and atom['confidence'] < DEMOTION_CONFIDENCE_THRESHOLD:
                atom['status'] = 'demoted'
                atom['demoted_at'] = now.isoformat()
                atom['updated_at'] = now.isoformat()
                save_atom(atom_file, atom)
                reindex(store_path, atom)
                emit_audit(audit_path, {
                    'event_type': 'atom.demoted',
                    'atom_id': atom['id'],
                    'timestamp': now.isoformat(),
                    'session_id': session_id,
                    'actor': 'system',
                    'reason': f'salience={salience:.3f} < {DEMOTION_SALIENCE_THRESHOLD} and confidence={atom["confidence"]:.3f} < {DEMOTION_CONFIDENCE_THRESHOLD}',
                    'metadata': {
                        'computed_salience': round(salience, 4),
                        'salience_components': result['components'],
                        'confidence_at_demotion': atom['confidence'],
                        'demoted_at': now.isoformat()
                    }
                })
```

### 13.6 Atom File Naming and Directory Layout

Atom files follow a strict naming convention to allow directory-based enumeration without qmd queries:

```
<store_root>/<kind>/<atom_id>.md
```

Examples:
```
~/.agent/memory/projects/acme-api/corrections/7f3a2b1c-8e4d-4f5a-9b6c-0d1e2f3a4b5c.md
~/.agent/memory/projects/acme-api/failures/a1b2c3d4-e5f6-7890-abcd-ef1234567890.md
~/.agent/memory/projects/acme-api/facts/deadbeef-dead-beef-dead-beefdeadbeef.md
~/.agent/memory/user/preferences/d3e4f5a6-b7c8-9012-def0-123456789abc.md
~/.agent/memory/user/corrections/f9e8d7c6-b5a4-3210-fedc-ba9876543210.md
```

The nanoid in the filename is the canonical identifier. The kind is encoded in the directory name (redundant with the frontmatter, but useful for filesystem operations).

The ID index files (§10.7) MUST be updated atomically using a write-to-temp-then-rename pattern to prevent corruption on partial writes:

```bash
# Atomic index update
tmp=$(mktemp ~/.agent/memory/projects/${PROJECT_ID}/correction-index.json.XXXXXX)
jq '. += [{"id": "'$NEW_ID'", "status": "active", "updated_at": "'$NOW'"}]' \
  correction-index.json > "$tmp"
mv "$tmp" correction-index.json
```

### 13.7 Error Handling and Graceful Degradation

The memory system MUST degrade gracefully when components fail. The agent MUST remain functional even if the memory system is unavailable.

**Degradation ladder:**

| Failure                                    | Degraded behaviour                                                                                    |
|--------------------------------------------|-------------------------------------------------------------------------------------------------------|
| qmd store unavailable at start             | Agent starts without memory injection. Logs warning. Disables `memory_search`, `memory_get`, `memory_record`, and `memory_context` tools. Context file is not written. |
| Phase 2 (fast model) fails                | Skip extraction. Log warning. Session observations archived for manual review.                        |
| Phase 3 (strong model) fails              | Fall back to accepting all Phase 2 candidates with confidence capped at 0.5. Log warning.             |
| Phase 4 (store write) fails               | Retry with backoff. If all retries fail, save candidates to a pending queue.                          |
| Correction index corrupted                | Rebuild from filesystem scan of corrections/ directory. Log warning.                                  |
| Salience computation fails                | Skip demotion for affected atoms. Do not demote based on partial data.                                |
| Language detection failure                | Fall back to no language filtering — all language-tagged atoms are treated as eligible for injection. Log warning. |
| No session context tags provided          | Skip tag filtering (Rule B) — all tag-eligible atoms are injected regardless of tags.                 |
| `memory_context` query returns no results | Agent continues without additional context; no error is raised.                                       |

The harness MUST emit a system alert when:
- The qmd store is unavailable at session start (memory-blind session)
- Phase 3 falls back to unchecked acceptance for more than 2 consecutive sessions
- The audit log fails to write (data loss risk)

### 13.8 Configuration Reference

All tunable parameters in this RFC are summarised here for implementor convenience. These defaults MAY be overridden via environment variables or a configuration file.

| Parameter                          | Default | Section | Description                                        |
|------------------------------------|---------|---------|---------------------------------------------------|
| `MAX_CANDIDATES_PER_SESSION`       | 20      | §4.2    | Maximum candidates the fast model may propose     |
| `INJECTION_CANONICAL_TOP_K`        | 5       | §6.1    | Canonical atoms retrieved per session           |
| `INJECTION_FACT_TOP_K`             | 3       | §6.1    | Fact atoms retrieved per session                |
| `INJECTION_SKILL_TOP_K`            | 3       | §6.1    | Skill atoms retrieved per session               |
| `INJECTION_PREFERENCE_TOP_K`       | 3       | §6.1    | Preference atoms retrieved per session          |
| `INJECTION_SOFT_CAP`               | 20      | §6.1    | Total inline injection cap                        |
| `MEMORY_SEARCH_DEFAULT_LIMIT`      | 5       | §6.3    | Default results for `memory_search` tool          |
| `MEMORY_SEARCH_MAX_LIMIT`          | 20      | §6.3    | Maximum results for `memory_search` tool          |
| `W_CONF`                           | 0.35    | §7.1    | Salience weight for confidence                    |
| `W_RECENCY`                        | 0.25    | §7.1    | Salience weight for recency                       |
| `W_USE`                            | 0.25    | §7.1    | Salience weight for use                           |
| `W_KIND`                           | 0.15    | §7.1    | Salience weight for kind                          |
| `HALF_LIFE_RECENCY_DAYS`           | 30      | §7.1    | Recency decay half-life in days                   |
| `HALF_LIFE_USE_DAYS`               | 14      | §7.1    | Use recency decay half-life in days               |
| `USE_SCALE`                        | 20      | §7.1    | Use count at which use_score saturates            |
| `DEMOTION_SALIENCE_THRESHOLD`      | 0.25    | §7.3    | Salience below which demotion is considered       |
| `DEMOTION_CONFIDENCE_THRESHOLD`    | 0.40    | §7.3    | Confidence below which demotion may occur         |
| `TOMBSTONE_DAYS_THRESHOLD`         | 90      | §7.3    | Days demoted before tombstone considered          |
| `TOMBSTONE_CONFIDENCE_THRESHOLD`   | 0.20    | §7.3    | Confidence below which tombstone is applied       |
| `CANONICAL_CHUNK_TOKENS`           | 900     | §5.1    | Target chunk size for canonical ingest            |
| `CANONICAL_CHUNK_OVERLAP`          | 0.15    | §5.1    | Chunk overlap as fraction of chunk size           |
| `CANONICAL_DEDUP_THRESHOLD`        | 0.92    | §5.2    | Cosine similarity threshold for near-duplicate    |
| `PHASE2_RETRY_MAX`                 | 3       | §13.1   | Maximum Phase 2 retry attempts                    |
| `PHASE3_RETRY_MAX`                 | 2       | §13.1   | Maximum Phase 3 retry attempts                    |
| `PHASE2_RETRY_BACKOFF_SECONDS`     | 5,15,45 | §13.1   | Exponential backoff intervals for Phase 2 retries |
| `MEMORY_LANGUAGE_DETECTION`        | `true`  | §6.3    | Whether to run language detection at session start |
| `MEMORY_TAG_FILTER_MODE`           | `or`    | §6.3    | Tag matching semantics for Rule B (`or` \| `and`)  |
| `MEMORY_CONTEXT_RERANK`            | `true`  | §6.3    | Whether to use LLM reranking for `memory_context` queries |
| `MEMORY_CONTEXT_DEFAULT_LIMIT`     | `5`     | §6.4    | Default limit for `memory_context` tool            |

### 13.9 Atom Lifecycle State Machine

The following state machine defines all valid status transitions for an atom:

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
              │      │    │ demotion    │ human     │
              │      │    │ protocol    │ forget    │
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
              │      │                  (back to ACTIVE)
              │      │
              │      │  [permanent delete — removes file + index]
              │      │
              └──────┘
                (old atom tombstoned when new superseding atom is created)

Legend:
  ACTIVE     — Retrieved in searches and injected at session start
  DEMOTED    — Excluded from injection and default search; retained on disk
  TOMBSTONED — Excluded from all retrieval; retained on disk for audit/resurrection
```

Valid transitions summary:

| From         | To           | Triggered by                                                  |
|--------------|--------------|---------------------------------------------------------------|
| (created)    | ACTIVE       | Phase 4 write (autonomous or canonical ingest)                |
| ACTIVE       | DEMOTED      | Nightly demotion protocol (salience + confidence thresholds)  |
| ACTIVE       | TOMBSTONED   | Human `forget`, or Phase 4 supersede decision                 |
| DEMOTED      | TOMBSTONED   | Nightly protocol (>90 days demoted + confidence < 0.20)       |
| DEMOTED      | ACTIVE       | Human `resurrect`                                             |
| TOMBSTONED   | ACTIVE       | Human `resurrect`                                             |
| ACTIVE       | ACTIVE       | Phase 4 merge (content/confidence update), human edit, use tracking |

No other transitions are valid. An implementation MUST validate that only the above transitions are applied and MUST log a warning (and no-op the write) if an invalid transition is attempted.

---

*End of RFC-001 — Coding Agent Long-Term Memory*

*This document is a living draft. Major revisions will increment the RFC number. Minor revisions will be tracked in the audit log of the document itself.*
