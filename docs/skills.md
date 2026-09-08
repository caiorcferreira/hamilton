# Skills reference (Assisted mode)

> **Hamilton is in ALPHA.** These skills are the one layer you can rely on today — but the shape
> of the artifacts and the pipeline can still change without notice.

The skills are Hamilton's **Assisted mode**: a portable, tool-agnostic bundle that carries a change
from idea to merge through a fixed sequence of steps. Each step is a self-contained `SKILL.md` that
names no tool and depends on no engine internals — only on the project's standards (`AGENTS.md`) and
the shared artifacts under the project's `.hamilton/` directory. The same skill guides a person in an
editor and a coding agent.

For the design rationale behind the pipeline, see **[SDD framework](./sdd-framework.md)**. For how
this layer is installed and what the CLI does, see **[modes](./modes.md)**.

## The pipeline

```
init ──▶ [ propose ] ──▶ plan ──▶ ( code ◀──▶ code-feedback ) ──▶ review ──▶ finish-work
  0        1 optional      2          3             4                5            6
                                     repeat per task              once per change
```

Seven core skills run in fixed sequence, with an optional pre-change planning stage (Wayfinder).
`hamilton-init` runs once per project. `hamilton-propose` is the optional heavyweight
front door — a tactical change skips it and starts at `hamilton-plan`, which creates the required
plan. For every task, `code` and `code-feedback` loop until that task passes; one whole-branch
`review` follows after all tasks pass, then `finish-work` closes the change. `hamilton-orchestrate`
drives that sequence in one session using subagents. `hamilton-critique` is an optional design-phase
gate before planning. Neither Wayfinder nor critique is part of the seven-skill core line.

`hamilton-compose-spec` sits outside this per-change line: it authors canonical specs
(`.hamilton/specs/`) directly — reformatting existing specs into the current human-readable shape,
or writing them from the application code — for projects adopting Hamilton or migrating an old spec
format. The pipeline never needs it; it is a maintenance and bootstrap tool.

**Start at planning when appropriate.** `plan.md` is the required declarative artifact; planning
also initializes the required root ledger and task progress files. The planning step uses richer
proposal, requirement, and design artifacts when present and otherwise works from the raw request.

## Setup

Assisted mode needs two things in place:

1. **Artifact templates and helper scripts**, installed for the current Hamilton generation with
   the CLI:

   ```bash
   bun run install-local     # build + symlink the `hamilton` CLI
   hamilton setup            # installs bundle/{templates,guidelines,scripts}/ → ~/.hamilton/
   ```

   The skills read the installed templates from `~/.hamilton/templates/<name>.md`, and call the
   required helper scripts at `~/.hamilton/scripts/<name>.sh` (see
   [Helper scripts](#helper-scripts)).

2. **The skills available to your coding agent.** The pipeline skills live in `skills/hamilton-*/`.
   Make them discoverable to your agent — for Claude Code, copy or symlink the `skills/hamilton-*`
   directories into a skills directory it loads (e.g. `~/.claude/skills/`), or point the agent at the
   `SKILL.md` paths directly. There is no CLI command that installs these into a coding agent; the
   skills are plain Markdown, portable across any agent that can load a `SKILL.md`.

Then, once per project, run the `hamilton-init` skill (below) to scaffold `.hamilton/` and write
`AGENTS.md`.

Treat the CLI bundle and agent-loaded skills as one installed generation. Finish an active change
before updating either side, update both from the same release, run `hamilton setup`, and verify the
installed generation before starting new work. The complete commands and checks are in
[Upgrading to the split workflow](./sdd-framework.md#upgrading-to-the-split-workflow).

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

### `hamilton-wayfinder` — chart the route before a change *(optional pre-change planning stage)*

Charts a map of decision tickets for a goal too big for one session, then works only the decision
tickets the user explicitly requests — one ticket or a named batch — until the way to the
destination is clear. The map plans the way; the doing comes later, one change at a time.

- **When:** before `hamilton-propose`, for a goal too big for one change session — one that needs
  its way found before the SDD loop begins.
- **Inputs:** a complex goal; the project's `AGENTS.md`.
- **Produces:** a map at `.hamilton/maps/<effort>/` (`map.md`, `tickets/`, and `route.md` once the
  map clears) — a static handoff listing the change-sized units in order, each pointing at the
  decisions backing it.
- **Notes:** use wayfinder to break a complex goal into clear, realizable units. The wayfinder
  skill itself names no SDD step — it defines an abstract executing-process contract, and the SDD
  skills implement it for software: `hamilton-propose` (spec-worthy units) or `hamilton-plan`
  (tactical units) starts a unit and flips it `in-progress` (flipping the map to `shipping` on the
  first unit), and `hamilton-finish-work` flips the unit `shipped` (and the map, on the last unit).
  A non-code effort — a presentation, an RFC, a strategy — binds its own executing process to the
  same contract. `hamilton-wayfinder` is a fork of upstream `mattpocock/skills` (MIT); see
  [`NOTICE`](../NOTICE) for the full legal credit.
- Source: [`skills/hamilton-wayfinder/SKILL.md`](../skills/hamilton-wayfinder/SKILL.md)

### `hamilton-propose` — idea → proposal, requirements, design *(step 1, optional)*

The heavyweight front door. Turns an idea into a well-formed change through collaborative dialogue,
gating on approval before any implementation.

- **When:** for a change that warrants a spec; skip it for a tactical change.
- **Inputs:** a change idea; the project's existing specs (`.hamilton/specs/`); `AGENTS.md`.
- **Produces**, in `.hamilton/changes/<YYYY-MM-DD-title>/`: `proposal.md` (why), `requirements/<capability>.md`
  (what, in delta form), `design.md` (how).
- **Notes:** one question at a time; proposes 2–3 approaches with trade-offs; the design must clear a
  code-quality self-review before the gate opens. On handoff it discloses the worktree it created
  and, when working with a person, asks before proceeding to `hamilton-plan`.
- Source: [`skills/hamilton-propose/SKILL.md`](../skills/hamilton-propose/SKILL.md)

### `hamilton-critique` — review the propose artifacts *(optional design-phase gate)*

Critiques a change's `proposal.md`, `requirements/`, and `design.md` before planning — the
design-phase counterpart to `hamilton-review`. Returns a numbered findings report and a verdict.
**Reviews only; never edits the artifacts.**

- **When:** on demand, after `hamilton-propose` and before `hamilton-plan`, to catch design defects
  while nothing has been built yet.
- **Inputs:** the change directory; `proposal.md` / `requirements/` / `design.md`; the actual
  codebase (to ground every reference); the canonical specs (`.hamilton/specs/`); `AGENTS.md`.
- **Produces:** a verdict (`approved` / `changes-requested`) and a numbered, located findings list —
  printed to chat and persisted to `critique.md` in the change directory.
- **Notes:** checks logical consistency, semantic coherence (ubiquitous language), and — the load-
  bearing step — that every referenced type/function/file/example actually exists in the codebase
  and nothing is planned against code the change removes. Applies the same `references/code-quality.md`
  rubric `hamilton-propose` self-reviews against, capturing a Quality Lens. On handoff it names the
  next step per the verdict (`plan` on approval, back to revising the artifacts on
  changes-requested) and, working with a person, asks before proceeding.
- Source: [`skills/hamilton-critique/SKILL.md`](../skills/hamilton-critique/SKILL.md)

### `hamilton-plan` — change → executable task contract *(step 2, required)*

Decomposes the work into small, TDD-sized, independently verifiable tasks. `plan.md` is the required
declarative handoff contract between planning and coding. **This skill never writes production code.**

- **When:** always — the pipeline's mandatory step. Plans from an existing design/requirements when
  present, or straight from a request.
- **Inputs:** a change directory (created if missing); `design.md` / `requirements/` if they exist;
  `AGENTS.md`.
- **Produces:** the declarative `plan.md` task contract; root `progress.md`, initialized as the
  current-status ledger with one linked row per active task; and one initialized
  `tasks/task-N/progress.md` implementation-history file per task.
- **Notes:** all sequencing happens here because code follows each task's steps verbatim. Re-plan
  preserves done tasks and stable numeric task identities, appends remediation tasks, and reconciles
  the root ledger without rewriting task histories. On handoff it names `hamilton-code` or
  `hamilton-orchestrate`.
- Source: [`skills/hamilton-plan/SKILL.md`](../skills/hamilton-plan/SKILL.md)

### `hamilton-code` — implement one task *(step 3)*

Implements exactly one active planned task, records its execution state, then self-reviews and
commits.

- **When:** for each task's first implementation attempt, and again when fresh task feedback requests
  changes.
- **Inputs:** one exact active `Task N`; its root ledger row and linked
  `tasks/task-N/progress.md`; its stable `tasks/task-N/.base` checkpoint; `AGENTS.md`; and, on a
  correction, that task's `feedback.md`.
- **Produces:** for a successful attempt, the task's tests and code plus one implementation commit
  that includes the appended `tasks/task-N/progress.md` attempt and the assigned root row's
  transition through `in-progress` to `done`. For a graceful blocker, an artifact-only bookkeeping
  commit contains the appended blocked attempt and the assigned row set to `blocked`; partial
  production edits remain uncommitted.
- **Notes:** `hamilton-plan` initializes the root row and task progress file; `hamilton-code` changes
  only its assigned row and appends to that task-local history among execution artifacts. It never
  edits `plan.md`, sibling task state, feedback, root review, or finish history. The checkpoint stays
  fixed across corrections so code feedback always receives the complete task diff.
- Source: [`skills/hamilton-code/SKILL.md`](../skills/hamilton-code/SKILL.md)

### `hamilton-code-feedback` — review one task diff *(step 4, tactical gate)*

Reviews exactly one implemented task within its stable diff and records a tactical verdict.
**Reviews only; never edits code, plan artifacts, or task status.**

- **When:** after every `hamilton-code` attempt that leaves its task `done`.
- **Inputs:** one exact `Task N`; the stable diff from `tasks/task-N/.base` through the supplied
  implementation Head; the task's acceptance criteria and cited constraints; its physical latest
  `tasks/task-N/progress.md` attempt; and `AGENTS.md`.
- **Produces:** an `approved` or `changes-requested` pass appended to
  `tasks/task-N/feedback.md`, committed in an artifact-only bookkeeping commit.
- **Notes:** the task diff is the inspection boundary, except for one named outside risk. A pass is
  fresh only when its reviewed Head contains the latest task-progress commit. Requested changes
  return the same task to `hamilton-code`; approval advances to the next task or the whole review.
- Source: [`skills/hamilton-code-feedback/SKILL.md`](../skills/hamilton-code-feedback/SKILL.md)

### `hamilton-review` — inspect the whole branch *(step 5, merge gate)*

Reviews how every implemented task composes across the complete branch and records the final
inspection verdict before finish-work. **Reviews only; never edits implementation or task state.**

- **When:** once all active tasks are `done` with fresh approved task feedback, and again after any
  remediation tasks complete.
- **Inputs:** the complete branch range from its actual target-branch merge base through a supplied
  full Head; all change artifacts, the root ledger, every active task's latest implementation and
  feedback evidence; the complete diff; and `AGENTS.md`.
- **Produces:** an `approved` or `changes-requested` pass appended to root `review.md`, committed in
  an artifact-only bookkeeping commit.
- **Notes:** inspection starts with the diff but must trace affected consumers, cross-task
  composition, omissions, and repository-wide assumptions. The reviewed Head must contain the
  latest material change commit. Requested implementation changes return to `hamilton-plan` in
  re-plan mode; an approved fresh pass hands off to finish-work.
- Source: [`skills/hamilton-review/SKILL.md`](../skills/hamilton-review/SKILL.md)

### `hamilton-finish-work` — close the change *(step 6)*

Gates the change, folds approved requirement deltas into canonical specs, records finish history,
and executes the selected finish strategy.

- **When:** after every task is `done` with fresh approved task feedback and root `review.md` has a
  fresh approved whole-branch pass.
- **Inputs:** the plan and root task ledger; every task's latest progress and feedback; the latest
  root review; approved proposal, design, and requirement deltas; existing `finish.md`; the finish
  strategy (`local-merge`, `pull-request`, or `no-op`); and `AGENTS.md`.
- **Produces:** synchronized `.hamilton/specs/<capability>.md` files, the verified merge / request /
  no-op result, and a paired `Attempt N` and `Outcome N` history in root `finish.md`.
- **Notes:** the hard gate treats these as separate requirements: the exact root ledger has every
  row `done`; every row links to `tasks/task-N/progress.md`, where the exact matching H1 is
  `# Task Progress: Task N — <title>` and the physical latest attempt has `Outcome: done`; every task
  has fresh approved feedback; the whole branch has a fresh approved review; the tree is clean; and
  full tests and build pass. It commits intent before external effects and records only observed
  results afterward; a dangling attempt is reconciled from actual repository and provider state
  before any new attempt.
- Source: [`skills/hamilton-finish-work/SKILL.md`](../skills/hamilton-finish-work/SKILL.md)

### `hamilton-orchestrate` — run a whole plan *(driver)*

Drives an entire `plan.md` through task implementation, task feedback, and one whole-branch review.
**Coordinates only; never edits code or stage-owned evidence itself.**

- **When:** to execute a full plan unattended instead of driving each task's code↔code-feedback loop
  and the final whole review by hand.
- **Inputs:** a change directory containing the plan, root task ledger, linked task histories and
  checkpoints, any task feedback and root review, approved design context, and `AGENTS.md`.
- **Produces:** every task committed with `done` status and fresh approved feedback, followed by one
  committed, fresh, approved whole-branch review and a clean handoff to `hamilton-finish-work`.
- **Notes:** its resume matrix combines each root status with the physical latest feedback verdict
  and reviewed-Head freshness; after all tasks pass, a second matrix governs root review freshness.
  Whole-review implementation findings return to `hamilton-plan` for numbered remediation tasks,
  which traverse the ordinary task loop before review runs again.
- Source: [`skills/hamilton-orchestrate/SKILL.md`](../skills/hamilton-orchestrate/SKILL.md)

### `hamilton-compose-spec` — author canonical specs directly *(out-of-band)*

Writes or rewrites `.hamilton/specs/<capability>.md` outside the change pipeline, in two modes:
**reformat** (an existing spec → the human-readable skeleton) and **from-code** (explore the
application read-only and write specs from what it does). The front door for canonical specs — every
other path creates a spec only when `hamilton-finish-work` distills a completed change.

- **When:** adopting Hamilton on an existing codebase (bootstrap specs from code), or migrating specs
  written in the older `Requirement:` / `Scenario:` form into the current shape.
- **Inputs:** the mode and its target (spec files to reformat, or the code to document); the existing
  `.hamilton/specs/`; `AGENTS.md`.
- **Produces:** canonical specs in the skeleton (`## Overview` / `## Contract` / `## Behavior` +
  Examples / `## Invariants` / `## Decisions`), at altitude, in human-readable prose.
- **Notes:** reads code and writes specs only — never edits application code, never creates a change
  directory. Reformat preserves every durable fact; from-code documents what the code actually does,
  flagging inferred behavior rather than inventing guarantees.
- Source: [`skills/hamilton-compose-spec/SKILL.md`](../skills/hamilton-compose-spec/SKILL.md)

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
      critique.md                     # optional — design-phase review of the propose artifacts
      plan.md                         # required — the handoff contract
      progress.md                     # required — current task ledger
      tasks/
        task-N/
          progress.md                 # implementation attempt history
          feedback.md                 # task-feedback verdict history
      review.md                       # whole-branch review history
      finish.md                       # finish attempt and outcome history
```

**Changes are ephemeral; specs are durable.** A change directory records one unit of work and its
history, with requirements written as deltas (ADDED / MODIFIED / REMOVED / RENAMED). When the change
finishes, those deltas are folded into `specs/`, the project's consolidated, always-current
requirements truth.

`plan.md` remains the declarative task contract. Planning initializes the required root
`progress.md` ledger and linked task progress files; code updates current status in the root and
keeps detailed attempts under the task. Feedback, whole-branch review, and finish history each live
in their separate owner artifact rather than being mixed into progress.

## Helper scripts

`hamilton setup` installs six files to `~/.hamilton/scripts/`, executable, from the repository's
`bundle/scripts/`. Five are entry-point helpers; one is their shared artifact-contract library.
They make the pipeline's mechanical steps deterministic and fail closed when required state cannot
be established.

| Script | Does | Consumers |
|--------|------|-----------|
| `hamilton-artifact-contracts.sh` | Provide the exact active-task and verdict-history parsers shared by other helpers | sourced by `diff-package`, `change-context`, and `precondition-check` |
| `hamilton-isolate.sh` | Check whether the workspace is isolated (`--check`), create a worktree + branch (`<title>`), or confirm the `cd` landed (`--verify <title>`) | `propose`, `plan`, `code`, `orchestrate`, `finish-work` |
| `hamilton-diff-package.sh` | Record one task's stable checkpoint (`--record --task N`), package that task range (`--task N`), or package `merge-base(default)..HEAD` (`--whole-change`) | `code`, `orchestrate` |
| `hamilton-precondition-check.sh` | Run the five finish-work gates — clean tree, tests, tasks done, reviews approved, whole-change review not stale — in one call | `finish-work` |
| `hamilton-change-context.sh` | Summarise a change directory: artifact inventory, root task standings, task-feedback freshness, and whole-review freshness (`--all` for one line per change) | `plan`, `critique`, `orchestrate`, `finish-work` |
| `hamilton-prototype-branch.sh` | Create/resume `prototype/<map-name>/<ticket-name>` from the current branch (`<map> <ticket>`, `--standalone <slug>`) or confirm the checkout landed (`--verify <branch>`) | `wayfinder-prototype` |

Three properties hold across the entry-point helpers:

- **Required and generation-matched.** Checkpoint, packaging, context, and finish contracts depend
  on these installed files. Run `hamilton setup` after updating the CLI bundle, and stop at the
  between-changes boundary if a required helper or its shared library is missing or stale.
- **Plain text out, result last.** Each prints human-readable lines and puts the load-bearing value —
  the verdict, the path, the range — on the **last** line, so a caller reads `tail -1`. Exit codes
  carry the same answer: `0` yes/success, `1` no/failed, `2` usage or environment error.
- **Judgment stays in the skill.** They move recipes, never decisions. `hamilton-precondition-check.sh`
  reports which gates failed and fails closed on anything it cannot parse; whether a failure is
  waivable is still the skill's call, and the user's.

## The task loop and whole-branch gate

The pipeline reads as a line but contains two distinct review scopes. For each task,
`hamilton-code` implements against one stable checkpoint and `hamilton-code-feedback` judges that
complete task diff. A fresh `changes-requested` pass sends the same task back to code; a fresh
approval lets the driver select the next task. The skills never call each other — a person or
`hamilton-orchestrate` owns the loop.

After every active task is `done` with fresh approved feedback, `hamilton-review` inspects the whole
branch and its broader repository impact once. Implementation findings return to `hamilton-plan`
in re-plan mode, become numbered remediation tasks, and pass through the same task loop before the
whole review repeats. Only a fresh approved whole-branch review reaches `hamilton-finish-work`,
whose final gate also requires a clean tree, full tests and build, an exact completed root ledger,
and fresh approved task feedback.
