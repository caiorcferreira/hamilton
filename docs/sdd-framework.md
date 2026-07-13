# Spec-Driven Development Framework

> **Hamilton is in ALPHA.** This document is the design of Hamilton's **Assisted mode** — the
> working core (see [The three modes](./modes.md)). For a task-focused map of the skills and how
> to run them, see the [Skills reference](./skills.md); this page is the *why* behind them.

Hamilton's spec-driven development (SDD) framework carries a change from idea to merge
through a fixed sequence of steps, each captured as a **skill** and backed by durable
**artifacts**. The same skills are used by a person working in an editor, by Hamilton's own
agents running autonomously (the experimental [Autonomous mode](./modes.md)), or by a mix of
the two — a person authors the spec and hands execution to Hamilton.

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
guides a human in any editor and an autonomous agent inside a workflow. Whatever is
Hamilton-specific — how an agent reports output, how context templates are rendered — lives
in a thin agent wrapper around the skill, not in the skill itself. The artifacts under a
project's `.hamilton/` directory are the contract between authoring and execution, which is
what makes the human-to-Hamilton handoff possible.

## Principles

**Skills are the single, tool-agnostic source of truth.** Each pipeline step is one skill.
It names no tool, defines the terms it uses, and depends on no runtime internals — only on
the project's standards file (`AGENTS.md`) and the shared artifacts.

**Agents are thin wrappers.** A Hamilton agent that runs a step loads the skill and adds only
the harness binding (output reporting, context, schemas). The skill is never duplicated into
the agent's instructions.

**Start anywhere.** The only required artifact is the plan. The heavyweight front door —
proposal, requirements, design — is optional; a tactical change starts at the plan step. Each
downstream step degrades gracefully: it uses the richer upstream artifact when present, and
otherwise works from the raw request.

**The orchestrator owns the loop.** Steps are linear on paper but the work loops — review
sends code back, a plan gap sends you back to design. The person or the workflow driving the
pipeline runs those loops; a skill does one job and returns. This mirrors Hamilton's existing
retry-and-verify machinery.

**Changes accumulate into living specs.** A change proposes requirement *deltas*
(ADDED / MODIFIED / REMOVED / RENAMED). The finish step folds them into the canonical
`specs/<capability>.md`, which always describes current behavior with no delta markers.

**Right-sized rigor.** The documents borrow the *spirit* of established standards — testable
requirements, decisions with alternatives — without their ceremony. "29148-inspired," not
29148-conformant.

**Match the worker to the work.** The plan step does the sequencing thinking and writes
test-first steps; the code step follows those steps verbatim and adds no design of its own,
so it can run on a weak, cheap model. The review step is the strong-model quality gate. An
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

Six skills, run in order. Step 0 is one-time project setup; steps 1–5 run per change.

| Step | Skill | Role |
|------|-------|------|
| 0 | `hamilton-init` | Set up the project: write `AGENTS.md`, scaffold `.hamilton/` |
| 1 | `hamilton-propose` | Idea → proposal (why), requirements (what), design (how) |
| 2 | `hamilton-plan` | Design → `plan.md`: small, TDD-sized, independently verifiable tasks |
| 3 | `hamilton-code` | Execute one task's steps verbatim → tests + code + `progress.md` |
| 4 | `hamilton-review` | Judge the diff → verdict + feedback in `review.md` |
| 5 | `hamilton-finish-work` | Gate, sync specs, finish via merge / PR / no-op |

```
init ──▶ [ propose ] ──▶ plan ──▶ code ──▶ review ──▶ finish-work
 (once)   optional                  ▲         │
                                    └─────────┘
                          review requests changes → code
```

**hamilton-init** explores the project read-only and writes `AGENTS.md` across the six
standing areas — the project's standards that every later step reads. It scaffolds
`.hamilton/specs/` and `.hamilton/changes/`. It is idempotent and never clobbers an existing
`AGENTS.md`.

**hamilton-propose** is the optional front door. Through dialogue — clarifying questions one
at a time, then two or three alternative approaches with trade-offs — it produces the
proposal, the per-capability requirements, and the design, and gates on approval before any
implementation. A change that does not warrant this depth skips it.

**hamilton-plan** produces the one required artifact. It explores the code read-only, then
decomposes the work into TDD-sized tasks, each with its files, acceptance criteria, ordered
steps, a verify command, and a commit message. Because the coder follows those steps
verbatim, all the sequencing thinking happens here.

**hamilton-code** implements exactly one task — identified either by reference (`plan.md` +
task id) or as an inline task block — following its steps as written. It never redesigns,
never touches sibling tasks, runs a code-quality self-review, commits, and records what it
did in `progress.md`. It never edits `plan.md`.

**hamilton-review** is the quality gate. It reads the diff against the plan, requirements, and
standards, judging correctness, tests, security, idioms, scope, and boundaries. It writes a
verdict and located, actionable feedback to `review.md`; it never edits code.

**hamilton-finish-work** closes the change. It checks the completion gate (clean tree, tests
green, all tasks done, review approved), folds the change's requirement deltas into the
canonical specs, and finishes via local merge, a pull request, or no-op.

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
      progress.md                     # execution ledger — what happened
      review.md                       # review verdict + feedback
```

The document set and the standards it borrows from:

| Artifact | Document | Owns | Inspiration |
|----------|----------|------|-------------|
| `proposal.md` | PRD | Why | — |
| `requirements/<capability>.md` | SRS (delta) | What | ISO/IEC/IEEE 29148 |
| `specs/<capability>.md` | SRS (canonical) | What | ISO/IEC/IEEE 29148 |
| `design.md` | SDD | How | IEEE 1016 |
| `plan.md` | Plan | Steps | — |
| `progress.md` | Progress | Log | — |
| `review.md` | Review | Verdict | — |

**Changes are ephemeral; specs are durable.** A change directory records one unit of work and
its history. The requirements inside it are deltas. When the change finishes, those deltas are
folded into `specs/`, which is the project's consolidated, always-current requirements truth.

## Control flow

The pipeline reads as a line but runs as a loop with one gate.

**The code–review loop** is orchestrator-driven. `hamilton-code` implements a task and
`hamilton-review` judges it. If the verdict is `changes-requested`, whoever runs the pipeline
re-invokes `hamilton-code` with the feedback from `review.md`; the coder addresses it within
the same task. The skills do not call each other — the loop belongs to the driver, which is
either a person or a Hamilton workflow using the same retry semantics as the rest of the
engine.

**The finish gate** is where quality accumulates into a go/no-go. `hamilton-finish-work`
refuses to complete a change unless the tree is clean, tests pass, every task is done, and the
latest review verdict is `approved`. Only then does it sync specs and finish.

**Standing boundaries** live in `AGENTS.md` and steer every step; change-specific boundaries
live in the design's three-tier list. An "Always" action proceeds without asking; a "Never"
action is a hard stop; an "Ask first" action is resolved by asking the requester or, unattended,
by the agent deciding and recording the reasoning.

## Concrete implementation

Three locations hold the framework:

- `bundle/templates/` — the canonical artifact templates, shipped with Hamilton and installed
  to `~/.hamilton/templates/` by `hamilton setup`.
- `skills/hamilton-*/` — the six pipeline skills, each a self-contained `SKILL.md`.
- a project's `.hamilton/` — the per-project specs and change artifacts, created by
  `hamilton-init`.

A typical run: a person invokes `hamilton-propose` in their editor to shape the change with
Hamilton's help, reviews and approves the artifacts, then hands off — a Hamilton workflow runs
`hamilton-plan`, loops `hamilton-code` and `hamilton-review` over the tasks, and calls
`hamilton-finish-work`. Inside the workflow, each step is an agent whose instructions load the
matching skill and add only the Hamilton binding. Model choice follows the work: a cheap model
executes the verbatim coding steps, a strong model reviews.

## Status and open work

All six pipeline skills — plus the `hamilton-orchestrate` driver — are authored and usable today
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
