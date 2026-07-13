# Skills reference (Assisted mode)

> **Hamilton is in ALPHA.** These skills are the one layer you can rely on today — but the shape
> of the artifacts and the pipeline can still change without notice.

The skills are Hamilton's **Assisted mode**: a portable, tool-agnostic bundle that carries a change
from idea to merge through a fixed sequence of steps. Each step is a self-contained `SKILL.md` that
names no tool and depends on no engine internals — only on the project's standards (`AGENTS.md`) and
the shared artifacts under the project's `.hamilton/` directory. The same skill guides a person in an
editor and, eventually, an autonomous agent inside a workflow.

For the design rationale behind the pipeline, see **[SDD framework](./sdd-framework.md)**. For where
this layer sits relative to the engine and the memory layer, see **[The three modes](./modes.md)**.

## The pipeline

```
init ──▶ [ propose ] ──▶ plan ──▶ code ──▶ review ──▶ finish-work
 (once)   optional                  ▲         │
                                    └─────────┘
                          review requests changes → code
```

Seven skills. `hamilton-init` runs once per project. `hamilton-propose` is the optional heavyweight
front door — a tactical change skips it and starts at `hamilton-plan`, the one required step. The
`code` and `review` steps loop until the review passes. `hamilton-orchestrate` is a driver that runs
the whole plan (code + review over every task) in one session using subagents.

**Start anywhere.** The only required artifact is the plan. Each downstream step degrades gracefully —
it uses the richer upstream artifact when present, and otherwise works from the raw request.

## Setup

Assisted mode needs two things in place:

1. **Artifact templates**, installed once with the CLI:

   ```bash
   bun run install-local     # build + symlink the `hamilton` CLI
   hamilton setup            # installs bundle/templates/ → ~/.hamilton/templates/
   ```

   The skills read the installed templates from `~/.hamilton/templates/<name>.md`.

2. **The skills available to your coding agent.** The pipeline skills live in `skills/hamilton-*/`.
   Make them discoverable to your agent — for Claude Code, copy or symlink the `skills/hamilton-*`
   directories into a skills directory it loads (e.g. `~/.claude/skills/`), or point the agent at the
   `SKILL.md` paths directly. There is no CLI command that installs these into a coding agent; the
   skills are plain Markdown, portable across any agent that can load a `SKILL.md`.

Then, once per project, run the `hamilton-init` skill (below) to scaffold `.hamilton/` and write
`AGENTS.md`.

## The skills

Each skill's authoritative definition is its own `SKILL.md` — this table is a map, not a
replacement.

### `hamilton-init` — set up a project *(step 0, once per project)*

Prepares an existing repository for the pipeline.

- **When:** once, before the first change.
- **Inputs:** an existing git repository; anything you want emphasized in the standards.
- **Produces:** `AGENTS.md` at the project root (the standing standards every later step reads,
  covering commands, testing, structure, code style, git workflow, and boundaries) and the
  `.hamilton/` workspace (`specs/`, `changes/`).
- **Notes:** read-only exploration first; idempotent; never clobbers an existing `AGENTS.md`.
- Source: [`skills/hamilton-init/SKILL.md`](../skills/hamilton-init/SKILL.md)

### `hamilton-propose` — idea → proposal, requirements, design *(step 1, optional)*

The heavyweight front door. Turns an idea into a well-formed change through collaborative dialogue,
gating on approval before any implementation.

- **When:** for a change that warrants a spec; skip it for a tactical change.
- **Inputs:** a change idea; the project's existing specs (`.hamilton/specs/`); `AGENTS.md`.
- **Produces**, in `.hamilton/changes/<YYYY-MM-DD-title>/`: `proposal.md` (why), `requirements/<capability>.md`
  (what, in delta form), `design.md` (how).
- **Notes:** one question at a time; proposes 2–3 approaches with trade-offs; the design must clear a
  code-quality self-review before the gate opens.
- Source: [`skills/hamilton-propose/SKILL.md`](../skills/hamilton-propose/SKILL.md)

### `hamilton-plan` — change → `plan.md` *(step 2, required)*

Decomposes the work into small, TDD-sized, independently verifiable tasks. This is the one required
artifact and the handoff contract between planning and coding. **It never writes production code.**

- **When:** always — the pipeline's mandatory step. Plans from an existing design/requirements when
  present, or straight from a request.
- **Inputs:** a change directory (created if missing); `design.md` / `requirements/` if they exist;
  `AGENTS.md`.
- **Produces:** `plan.md` — an ordered task ledger, each task with its files, acceptance criteria,
  verbatim steps (test-first where behavior is testable), a verify command, and a commit message.
- **Notes:** all the sequencing thinking happens here, because the coder executes the steps verbatim.
- Source: [`skills/hamilton-plan/SKILL.md`](../skills/hamilton-plan/SKILL.md)

### `hamilton-code` — implement one task *(step 3)*

Implements exactly one planned task by following its steps as written, then self-reviews and commits.

- **When:** once per task in the plan.
- **Inputs:** the task — either by reference (`plan.md` + a task id) or as an inline task block; the
  change directory; `AGENTS.md`; optionally, review feedback from a prior pass on this task.
- **Produces:** the task's tests + code, a commit, and an entry appended to `progress.md`.
- **Notes:** never redesigns, reorders, or touches sibling tasks; never edits `plan.md`. Designed to
  run on a cheap model, since the plan carries the design.
- Source: [`skills/hamilton-code/SKILL.md`](../skills/hamilton-code/SKILL.md)

### `hamilton-review` — judge the diff *(step 4, quality gate)*

Reviews the code produced for a change and returns a verdict with specific, actionable feedback.
**Reviews only; never edits code or `plan.md`.**

- **When:** after each `hamilton-code` pass.
- **Inputs:** the change directory; the diff under review; `plan.md` (intent) and, if present,
  `design.md` / `requirements/` (acceptance criteria); `progress.md`; `AGENTS.md`.
- **Produces:** a verdict (`approved` / `changes-requested`) and located feedback in `review.md`.
- **Notes:** the strong-model quality gate. On `changes-requested`, the driver re-invokes
  `hamilton-code` with the feedback — the skills do not call each other.
- Source: [`skills/hamilton-review/SKILL.md`](../skills/hamilton-review/SKILL.md)

### `hamilton-finish-work` — close the change *(step 5)*

Gates the change, folds requirement deltas into the canonical specs, and finishes.

- **When:** once, after every task is coded and the latest review is approved.
- **Inputs:** the change directory (`plan.md`, `progress.md`, `review.md`, `requirements/`); the
  finish strategy (`local-merge`, `pull-request`, or `no-op`); `AGENTS.md`.
- **Produces:** updated `.hamilton/specs/<capability>.md` (deltas folded in, no delta markers), and
  the change finished per strategy; a finish entry in `progress.md`.
- **Notes:** hard gate — refuses to finish a dirty tree, failing tests, or an unapproved review;
  never fabricates a merge or a pull request.
- Source: [`skills/hamilton-finish-work/SKILL.md`](../skills/hamilton-finish-work/SKILL.md)

### `hamilton-orchestrate` — run a whole plan *(driver)*

Drives an entire `plan.md` to completion in one session by dispatching a fresh subagent per task —
each runs `hamilton-code` on one task, followed by a `hamilton-review` pass — then a broad
whole-branch review at the end. **Coordinates only; never edits code itself.**

- **When:** to execute a full plan unattended, instead of running the code↔review loop by hand.
- **Inputs:** a change directory containing `plan.md`; `AGENTS.md`; optionally `design.md` /
  `requirements/` and an existing `progress.md`.
- **Produces:** every task implemented, reviewed, and recorded — driving the same `code` and `review`
  skills across the plan.
- **Notes:** one task per subagent (fresh context), by reference; artifacts hand off as file paths;
  resumes from `progress.md` and `git log` after any compaction.
- Source: [`skills/hamilton-orchestrate/SKILL.md`](../skills/hamilton-orchestrate/SKILL.md)

## Artifacts and layout

Templates are global; artifacts are per-project. The canonical templates ship in the repository's
`bundle/templates/` and are installed to `~/.hamilton/templates/` by `hamilton setup`. Every change's
artifacts live under the project's `.hamilton/` directory:

```
.hamilton/
  specs/                              # canonical capability truth (living, no delta markers)
    <capability>.md
  changes/
    <YYYY-MM-DD-title>/
      proposal.md                     # optional — why
      design.md                       # optional — how
      requirements/<capability>.md    # optional — what (delta form)
      plan.md                         # required — the handoff contract
      progress.md                     # execution ledger — what happened
      review.md                       # review verdict + feedback
```

**Changes are ephemeral; specs are durable.** A change directory records one unit of work and its
history, with requirements written as deltas (ADDED / MODIFIED / REMOVED / RENAMED). When the change
finishes, those deltas are folded into `specs/`, the project's consolidated, always-current
requirements truth.

## The code–review loop

The pipeline reads as a line but runs as a loop with one gate. `hamilton-code` implements a task and
`hamilton-review` judges it; on `changes-requested`, whoever drives the pipeline (a person, or
`hamilton-orchestrate`) re-invokes `hamilton-code` with the feedback. The skills never call each
other — the loop belongs to the driver. `hamilton-finish-work` is the final gate: it refuses to
complete unless the tree is clean, tests pass, every task is done, and the latest review is approved.
