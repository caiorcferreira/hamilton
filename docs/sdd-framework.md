# Spec-Driven Development Framework

> **Hamilton is in ALPHA.** This document is the design of Hamilton's **Assisted mode** — the
> working core (see [modes](./modes.md)). For a task-focused map of the skills and how
> to run them, see the [Skills reference](./skills.md); this page is the *why* behind them.

Hamilton's spec-driven development (SDD) framework carries a change from idea to merge
through a fixed sequence of steps, each captured as a **skill** and backed by durable
**artifacts**. The same skills are used by a person working in an editor or by a coding agent —
a person authors the spec and hands execution to the agent.

## Philosophy

AI coding agents are capable but unanchored. Left with a broad prompt they drift, skip
verification, and produce work that looks right and collapses under the first edge case. The
fix is not a bigger prompt; it is structure that survives across steps and across sessions.

The framework rests on two ideas.

**The spec is the shared source of truth, and it accumulates.** Every change is described
before it is built — why (proposal), what (requirements), how (design) — and the decisions a
change commits to are folded back into a living per-project spec. Over time the project's
`specs/` directory becomes the consolidated truth, while each change keeps its own history.
This is how historical decisions are preserved without letting the current picture rot.

**Skills are portable knowledge; the harness is only a binding.** A skill encodes *how* to
plan, code, or review well, once. It never assumes Hamilton mechanics, so the identical skill
guides a human in any editor and a coding agent. Whatever is
Hamilton-specific — how an agent reports output, how context templates are rendered — lives
in a thin agent wrapper around the skill, not in the skill itself. The artifacts under a
project's `.hamilton/` directory are the contract between authoring and execution.

## Principles

**Skills are the single, tool-agnostic source of truth.** Each pipeline step is one skill.
It names no tool, defines the terms it uses, and depends on no runtime internals — only on
the project's standards file (`AGENTS.md`) and the shared artifacts.

**Agents are thin wrappers.** A Hamilton agent that runs a step loads the skill and adds only
the harness binding (output reporting, context, schemas). The skill is never duplicated into
the agent's instructions.

**Start at planning when appropriate.** `plan.md` is the required declarative artifact. Planning
also initializes the required root task ledger and task progress files. The heavyweight front door
— proposal, requirements, design — is optional; a tactical change starts at the plan step, which
uses richer upstream artifacts when present and otherwise works from the raw request.

**The orchestrator owns the loops.** Steps are linear on paper, but task feedback sends one task
back to code and whole-branch findings send the change back to planning. The person or workflow
driving the pipeline runs those loops; each skill does one job and returns. This mirrors Hamilton's
existing retry-and-verify machinery.

**Changes accumulate into living specs.** A change proposes requirement *deltas*
(ADDED / MODIFIED / REMOVED / RENAMED) in structured form. The finish step folds them into the
canonical `specs/<capability>.md` — human-readable documentation at altitude that always describes
current behavior, with no delta markers and none of the change-side `SHALL`/scenario scaffolding.

**Right-sized rigor.** The documents borrow the *spirit* of established standards — testable
requirements, decisions with alternatives — without their ceremony. "29148-inspired," not
29148-conformant.

**Match the worker to the work.** The plan step does the sequencing thinking and writes
test-first steps; the code step follows those steps verbatim and adds no design of its own,
so it can run on a weak, cheap model. Task feedback provides the bounded tactical gate, while
whole-branch review uses the strongest model for integration and omission analysis. An
"ask first" decision is resolved by asking the requester, or — running unattended — by the
agent reflecting, deciding, and recording the reasoning.

## Inspirations

The framework is a synthesis, not an invention.

- **OpenSpec** — the capability-centric model: a durable spec of requirements, changed
  through deltas that are folded back in at the end. Hamilton keeps this, triggered by the
  finish step rather than a separate sync command.
- **Superpowers** — the collaborative `brainstorming` skill (one question at a time, propose
  alternatives, gate on approval) shapes the propose step; `writing-plans` and
  `executing-plans` shape the plan and code steps.
- **GitHub Spec Kit** — the gated Specify → Plan → Tasks → Implement flow, where the spec
  drives implementation and each phase is validated before the next.
- **"How to write a good spec for AI agents" (Addy Osmani)** — the six core areas of a good
  project spec (commands, testing, structure, style, git workflow, boundaries), the
  three-tier boundary system (Always / Ask first / Never), spec-referenced self-verification,
  and keeping each step's context minimal.
- **IEEE / ISO standards** — 830 and 29148 for the requirements specification (SRS), 1016 for
  the software design description (SDD) — taken in spirit and right-sized.

## The pipeline

Seven core skills run in fixed order. Step 0 is one-time project setup; steps 1–6 run per change.
Wayfinder is an optional pre-change planning stage, and `hamilton-critique` is an optional
design-phase gate; neither is counted in this core sequence.

| Step | Skill | Role |
|------|-------|------|
| 0 | `hamilton-init` | Set up the project: write `AGENTS.md`, scaffold `.hamilton/` |
| 1 | `hamilton-propose` | Idea → proposal (why), requirements (what), design (how) |
| 2 | `hamilton-plan` | Design → `plan.md`: small, TDD-sized, independently verifiable tasks |
| 3 | `hamilton-code` | Execute one task → tests + code + task progress |
| 4 | `hamilton-code-feedback` | Judge that task's stable diff → task feedback verdict |
| 5 | `hamilton-review` | Inspect the complete branch and broader repository → root review verdict |
| 6 | `hamilton-finish-work` | Gate, sync specs, record finish history, finish via merge / PR / no-op |

```
init ──▶ [ propose ] ──▶ plan ──▶ ( code ◀──▶ code-feedback ) ──▶ review ──▶ finish-work
  0        1 optional      2          3             4                5            6
                                     repeat per task              once per change
```

**hamilton-init** explores the project read-only and writes `AGENTS.md` across the six
standing areas — the project's standards that every later step reads. It scaffolds
`.hamilton/specs/` and `.hamilton/changes/`. It is idempotent and never clobbers an existing
`AGENTS.md`.

**hamilton-propose** is the optional front door. Through dialogue — clarifying questions one
at a time, then two or three alternative approaches with trade-offs — it produces the
proposal, the per-capability requirements, and the design, and gates on approval before any
implementation. A change that does not warrant this depth skips it.

**hamilton-plan** produces the required declarative `plan.md` handoff contract. It explores the code
read-only, then decomposes the work into TDD-sized tasks, each with its files, acceptance criteria,
ordered steps, a verify command, and a commit message. It also initializes root `progress.md` as the
current task ledger and one `tasks/task-N/progress.md` history for each task. Because the coder
follows task steps verbatim, all sequencing happens here.

**hamilton-code** implements exactly one task — identified either by reference (`plan.md` +
task id) or as an inline task block — following its steps as written. It never redesigns,
never touches sibling tasks, runs a code-quality self-review, and commits. It transitions only its
assigned row in root `progress.md` and appends detailed attempt evidence only to
`tasks/task-N/progress.md`. It never edits `plan.md`.

**hamilton-code-feedback** is the per-task tactical gate. It reviews one stable task diff from the
task's unchanged checkpoint through the implementation Head, checks the task's acceptance and
latest attempt evidence, and appends an artifact-only verdict to `tasks/task-N/feedback.md`. Its
reviewed Head must contain the latest task-progress commit. Requested changes return that same task
to code; approval advances the driver.

**hamilton-review** is the whole-branch merge gate. After all tasks have fresh approved feedback,
it starts from the complete branch diff and inspects broader affected consumers, cross-task
composition, omissions, and repository assumptions. It appends its verdict to root `review.md`;
the reviewed Head must contain the latest material change commit. Implementation findings return
to planning as remediation tasks rather than directly to code.

**hamilton-finish-work** closes the change. It checks the completion gate (clean tree, full tests
and build, exact task ledger complete, every task's fresh feedback approved, and fresh whole-branch
review approved), folds the change's requirement deltas into the canonical specs, and finishes via
local merge, a pull request, or no-op. It persists paired intent and observed outcome records in
root `finish.md`, reconciling any dangling attempt before starting another. Folding is a *distill
and translate* step: the change-side deltas are structured (`SHALL` + `WHEN`/`THEN`), but the
canonical spec is human-readable documentation — a light universal skeleton (Overview / Contract
/ Behavior + Examples / Invariants / Decisions) written at altitude — so finish-work rewrites each
delta into the section it belongs to rather than copying requirement blocks by name.

**hamilton-compose-spec** sits outside the per-change pipeline. It authors canonical specs
directly, in two modes: *reformat* an existing spec into the current skeleton, or write specs
*from the application code*. It is the front door for canonical specs — every pipeline path
produces a spec only as a by-product of finishing a change — and the tool a project uses to
bootstrap specs on adoption or migrate an older spec format.

## Artifacts and layout

**Templates are global.** The canonical set lives in the repository's `bundle/templates/` and
is copied to `~/.hamilton/templates/` by the `hamilton setup` command. Every step reads the
installed copy, so there is one definition of each artifact's shape.

**Artifacts are per-project**, under the project's `.hamilton/` directory:

```
.hamilton/
  specs/                              # canonical capability truth (living)
    <capability>.md                   # no delta markers — current behavior
  changes/
    <YYYY-MM-DD-title>/
      proposal.md                     # optional — PRD (why)
      design.md                       # optional — SDD (how)
      requirements/<capability>.md    # optional — SRS delta (what)
      plan.md                         # required — the handoff contract
      progress.md                     # required — current task ledger
      tasks/
        task-N/
          progress.md                 # implementation attempt history
          feedback.md                 # task-feedback verdict history
      review.md                       # whole-branch review history
      finish.md                       # finish attempt and outcome history
```

The document set and the standards it borrows from:

| Artifact | Document | Owns | Inspiration |
|----------|----------|------|-------------|
| `proposal.md` | PRD | Why | — |
| `requirements/<capability>.md` | SRS (delta) | What | ISO/IEC/IEEE 29148 |
| `specs/<capability>.md` | SRS (canonical) | What | ISO/IEC/IEEE 29148 |
| `design.md` | SDD | How | IEEE 1016 |
| `plan.md` | Plan | Steps | — |
| `progress.md` | Task ledger | Current implementation status and task-history links | — |
| `tasks/task-N/progress.md` | Task progress | Implementation attempts | — |
| `tasks/task-N/feedback.md` | Code feedback | Task verdicts and reviewed ranges | — |
| `review.md` | Whole-branch review | Change verdicts and reviewed ranges | — |
| `finish.md` | Finish history | Intended and verified finish outcomes | — |

**Changes are ephemeral; specs are durable.** A change directory records one unit of work and
its history. The requirements inside it are deltas. When the change finishes, those deltas are
folded into `specs/`, which is the project's consolidated, always-current requirements truth.

`plan.md` is the declarative task contract. Planning initializes the required root `progress.md`
ledger and task-local progress files; execution updates those operational artifacts without turning
them into a second plan. Task feedback, whole-branch review, and finish history remain separate so
each stage has one durable owner.

## Upgrading to the split workflow

Treat this artifact split as a clean break between changes. Before starting a new change, update
the Hamilton skills, templates, and helper scripts as one compatible set. New work uses the full
seven-step pipeline, root `progress.md` only as the task index and ledger,
`tasks/task-N/progress.md` and `tasks/task-N/feedback.md` for task histories, root `review.md` for
the whole-branch gate, and root `finish.md` for finish history. Replace task-scoped
`hamilton-review` invocations with `hamilton-code-feedback`.

Legacy planned changes that mix task verdicts into root `review.md` or detailed attempts into root
`progress.md` are `legacy-unsupported` under the new execution and finish contracts. They are not
converted, resumed, or accepted by the new workflow. Finish an active legacy change with the
Hamilton version that created it; do not switch formats in the middle of that change.

## Control flow

The pipeline reads as a line but runs a per-task loop followed by one change-level gate.

**The code–feedback loop** is driver-owned. `hamilton-code` implements one task against its stable
checkpoint and `hamilton-code-feedback` judges that task's complete diff. A fresh
`changes-requested` pass re-invokes code for the same task; a fresh approval advances to the next
task. The skills do not call each other — a person or `hamilton-orchestrate` owns the loop.

**The whole-branch review gate** begins only after every task is `done` with fresh approved
feedback. `hamilton-review` inspects the complete branch plus broader affected consumers and
composition. Implementation findings return to `hamilton-plan` in re-plan mode, become numbered
remediation tasks, and traverse the ordinary code↔code-feedback loop before one new whole review.

**The finish gate** is where quality accumulates into a go/no-go. `hamilton-finish-work` refuses to
complete unless the tree is clean, full tests and build pass, every task and task-history outcome is
done, every task feedback pass is fresh and approved, and the whole-branch review is fresh and
approved. Only then does it sync specs, record finish intent, execute the selected strategy, verify
the result, and persist the matching outcome.

**Standing boundaries** live in `AGENTS.md` and steer every step; change-specific boundaries
live in the design's three-tier list. An "Always" action proceeds without asking; a "Never"
action is a hard stop; an "Ask first" action is resolved by asking the requester or, unattended,
by the agent deciding and recording the reasoning.

## Concrete implementation

Four locations hold the framework:

- `bundle/templates/` — the canonical artifact templates, shipped with Hamilton and installed
  to `~/.hamilton/templates/` by `hamilton setup`.
- `bundle/scripts/` — the optional helper scripts the skills call for their mechanical steps,
  installed to `~/.hamilton/scripts/` by the same command. Every call site carries the manual
  recipe too, so the framework does not depend on them.
- `skills/hamilton-*/` — the seven core pipeline skills and their optional companion skills, each a
  self-contained `SKILL.md`.
- a project's `.hamilton/` — the per-project specs and change artifacts, created by
  `hamilton-init`.

A typical run: a person invokes `hamilton-propose` in their editor to shape the change with
Hamilton's help, reviews and approves the artifacts, then hands off — the agent runs
`hamilton-plan`, loops `hamilton-code` and `hamilton-code-feedback` over the tasks, runs one
`hamilton-review` over the whole branch, and calls `hamilton-finish-work`. Each step loads the
matching skill from `~/.claude/skills/` (or wherever
your agent reads `SKILL.md` files) and follows it against the artifacts.

## Status and open work

All seven core pipeline skills — plus the `hamilton-orchestrate` driver — are authored and usable today
(Assisted mode). `hamilton setup` installs the
artifact templates into `~/.hamilton/templates/`, so the pipeline runs end to end with any coding
agent. The remaining work is integration with the Autonomous engine, not skill authoring:

- Unify the framework with the existing bundle: refactor the `feature-dev` agents and the
  merge / PR / worktree variants to *invoke* these skills instead of embedding their own
  instructions.
- Consolidate the legacy spec systems (`openspec/`, `.superpowers/`, `docs/superpowers/`) into
  the `.hamilton/` model.
- Run a real change end to end through the full human-to-Hamilton (Autonomous) pipeline and record
  the friction.
