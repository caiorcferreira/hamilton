# Route — Fork wayfinder into Hamilton

Status: pending

The map is cleared. What follows is the handoff: ten change-sized units, each running the SDD loop
once — `hamilton-propose → plan → code → review → finish-work`.

**This route points; it does not restate.** Every unit links the decisions that back it. Read those
tickets before proposing — the goal paragraph here is orientation, not specification.

**Every unit enters at `hamilton-propose`.**
[Boundary with hamilton-propose and hamilton-critique](tickets/09-boundary-with-propose-and-critique.md)
ruled propose a required gate with no straight-to-plan path, which collapses the per-unit "suggested
entry" field
[route.md shape and the SDD join](tickets/06-route-shape-and-sdd-join.md) specified into a constant.
It is stated once here rather than repeated ten times.

**Status flips ride the unit's own branch.** Marking a unit `shipped` belongs in the same diff that
ships it, per
[Where map artifacts live relative to per-unit worktrees](tickets/13-map-artifacts-and-worktrees.md).
Between merges this file lags on the default branch; that staleness is accepted, not a defect.

## Units

### 1. Land the glossary

Status: pending
Depends on: —
Backed by: [Which siblings to port](tickets/07-which-siblings-to-port.md)

Harvest the domain vocabulary this map established — *map*, *decision ticket*, *frontier*, *fog of
war*, *destination*, *change-sized unit*, *route*, *cleared/shipping/shipped* — into
`.hamilton/specs/glossary.md`, joining the existing `cli-distribution.md` as canonical project truth.

**Read this before proposing.** Ticket 07 specified a *working* glossary at
`.hamilton/maps/hamilton-wayfinder/glossary.md`, maintained during planning and merged into
`.hamilton/specs/glossary.md` by this unit. That working file was never created — the terms were
sharpened inside ticket Answers instead, which is where ticket 07 also said hard decisions belong. So
this unit has no file to merge; it has thirteen resolved tickets to harvest. The output is the same,
the input is not. Scope the proposal to extraction, and treat the missing intermediate as a fact about
how this map was actually worked rather than a gap to backfill.

First in the route because the vocabulary it fixes is used by every unit after it, and because
finalizing it independently keeps it out of feature work.

### 2. Adopt Apache 2.0 and the attribution convention

Status: pending
Depends on: —
Backed by: [Fork attribution and licensing](tickets/03-fork-attribution.md)

Hamilton currently ships publicly with no licence at all while preparing to redistribute someone
else's MIT text. This unit closes that: `LICENSE` (Apache 2.0 full text), root `NOTICE` with one
entry per forked upstream, `"license": "Apache-2.0"` in `package.json`, and the written rule in
`CONTRIBUTING.md` that every forked skill directory carries its own sibling `NOTICE`.

**Scope note.** Ticket 03 describes this unit as also covering "the per-skill `NOTICE` for every
forked skill". Those skills do not exist yet, so this unit lands the repo-level artifacts and the
**rule**; each skill-authoring unit below lands its own `NOTICE` by following it. Same coverage, no
trailing unit that has to revisit five directories. The root `NOTICE` can still name all five forked
skills up front — [Which siblings to port](tickets/07-which-siblings-to-port.md) fixed the list.

Copy upstream's copyright year and permission text **verbatim from upstream's own `LICENSE`**. Do not
reconstruct it from memory.

Early in the route because ticket 03 requires the answer to exist before anything ships.

### 3. Land the wayfinder artifact templates

Status: pending
Depends on: —
Backed by: [Template convention](tickets/05-template-convention.md),
[Map mechanics in files](tickets/04-map-mechanics-in-files.md),
[route.md shape and the SDD join](tickets/06-route-shape-and-sdd-join.md)

Add `bundle/templates/wayfinder/` holding `map.md`, `ticket.md` and `route.md`, so wayfinder's
artifact shapes live where every other Hamilton artifact shape lives. Extend `tests/cli/setup.test.ts`
with assertions covering the three new templates, and add the `bundle/templates/` row to
`CONTRIBUTING.md`'s mapping table.

The template shapes are fixed by decisions, not invented here: frontmatter fields from ticket 04, the
per-unit structure and lifecycle vocabulary from ticket 06. This file — the route you are reading —
is a worked example of what `route.md` should template to.

### 4. Port hamilton-grilling

Status: pending
Depends on: 2
Backed by: [Which siblings to port](tickets/07-which-siblings-to-port.md),
[Fork attribution and licensing](tickets/03-fork-attribution.md)

Port upstream's grilling skill to `skills/hamilton-grilling/` as a general-purpose dialogue
primitive — one question at a time, lead with a recommendation, look facts up rather than asking,
never answer for the human. Near-verbatim; it owns the **protocol only** and knows nothing about
approaches, artifacts, or the pipeline. Callers supply question content and the exit condition.

Ships with its sibling `NOTICE` and the one-line provenance pointer in `SKILL.md`.

Standalone, not under the `hamilton-wayfinder-*` prefix — ticket 07 placed dialogue at the Hamilton
level because propose and critique use it too.

### 5. Port the three wayfinder siblings

Status: pending
Depends on: 2
Backed by: [Which siblings to port](tickets/07-which-siblings-to-port.md),
[Read the three upstream sibling skills](tickets/02-read-upstream-siblings.md),
[Fork attribution and licensing](tickets/03-fork-attribution.md)

Port `research`, `prototype` and `domain-modeling` to `skills/hamilton-wayfinder-research/`,
`skills/hamilton-wayfinder-prototype/` and `skills/hamilton-wayfinder-domain-modeling/` — full ports,
not trimmed, each with its own `NOTICE`. The prefix marks them as wayfinder's internals rather than
pipeline steps.

The adaptation work is uneven and worth weighing when the proposal slices tasks. `research` is twelve
lines and needs only a findings home at `.hamilton/maps/<effort>/research/`. `prototype` needs its
context pointer re-hung from an issue onto a ticket body. `domain-modeling` carries the real change:
it drops upstream's root `CONTEXT.md` and numbered `docs/adr/` — the parallel durable-truth system
ticket 02 flagged — in favour of a working glossary under the map and hard decisions recorded in
ticket Answers.

### 6. Author hamilton-wayfinder

Status: pending
Depends on: 2, 3, 4, 5
Backed by: [Map artifact layout](tickets/01-map-artifact-layout.md),
[Map mechanics in files](tickets/04-map-mechanics-in-files.md),
[Template convention](tickets/05-template-convention.md),
[route.md shape and the SDD join](tickets/06-route-shape-and-sdd-join.md),
[Which siblings to port](tickets/07-which-siblings-to-port.md),
[Ticket types in the Hamilton fork](tickets/08-ticket-types.md),
[Boundary with hamilton-propose and hamilton-critique](tickets/09-boundary-with-propose-and-critique.md),
[Where map artifacts live relative to per-unit worktrees](tickets/13-map-artifacts-and-worktrees.md)

The centerpiece: `skills/hamilton-wayfinder/SKILL.md` and whatever `references/` it needs, with its
own `NOTICE`. File-native throughout — maps at `.hamilton/maps/<effort>/` holding `map.md`,
`route.md` and `tickets/NN-slug.md`, no tracker indirection.

Two constraints deserve naming because they are easy to lose. Tracker mechanics go in **one**
`## Map mechanics` section so a later backend can swap them — that boundary is the whole pluggability
promise, and it is only real if it is genuinely isolated. And the skill states that map artifacts are
ordinary repo content, versioned and branched like source, per ticket 13.

All four ticket types survive. Wayfinder keeps the strict HITL rule for planning; Hamilton's
three-tier attendance model governs SDD execution, not this stage.

**Author this against `/writing-great-skills`.** This unit writes a `SKILL.md` from scratch — the
longest and most-invoked one in the repo — so the quality bar is the skill-writing craft itself, not
just whether the decisions are faithfully transcribed. Its guidance on predictability as the root
virtue, on the information hierarchy, and on pruning context load applies directly to the choices this
unit makes: what goes in the body versus `references/`, how the `## Map mechanics` boundary is drawn,
how much of the fog-of-war explanation a session actually needs loaded every turn.

Invoke it **explicitly** — it is `disable-model-invocation: true`, so no agent will reach for it on
its own. Read it before drafting rather than as a review pass afterwards; several of its levers
(invocation mode, description shape, what earns a place in the body) are structural and expensive to
retrofit. Wayfinder's own invocation mode is one of them: it is user-invoked upstream, and whether
Hamilton keeps that or lets the agent fire it autonomously is a real decision for the proposal, with
a context-load cost either way.

Depends on the four units before it so that every reference it makes — to templates, to grilling, to
its siblings — resolves on the branch it lands on.

### 7. Refactor propose and critique onto hamilton-grilling

Status: pending
Depends on: 4
Backed by: [Update propose and critique to use hamilton-grilling](tickets/12-propose-and-critique-use-grilling.md)

Propose delegates its dialogue at all three surfaces — step 4 clarifying questions, step 7 approach
choice, step 10 approval loop. Critique gains dialogue it never had, on the `changes-requested` path
only, positioned between the code-quality rubric and writing the report so findings are validated
before `critique.md` exists.

**"Judge, don't fix" must survive intact.** Critique still never edits `proposal.md`, `requirements/`
or `design.md`, and the revision loop stays with whoever runs the pipeline. Placing grilling before
the write is what preserves this — ticket 12 reasons it out; do not relocate it.

Attendance is guarded at each call site: attended invokes grilling, unattended falls back to the
behaviour both skills already document. Grilling itself never gains an unattended mode.

No test coverage needed — `skills/` is not bundled and no test asserts on skill content.

### 8. Teach propose to read a route

Status: pending
Depends on: 6, 7
Backed by: [Boundary with hamilton-propose and hamilton-critique](tickets/09-boundary-with-propose-and-critique.md),
[Where map artifacts live relative to per-unit worktrees](tickets/13-map-artifacts-and-worktrees.md)

`hamilton-propose` gains map-aware entrypoint logic: pointed at a map folder, it reads `route.md`,
finds the next unit with status `pending`, and navigates that unit's decision links to pull full
context before its normal dialogue begins. Everything after the entrypoint is unchanged.

It reads `route.md` from the branch the session started on and does not reach for the default
branch's copy — ticket 13 settled that, and it is what keeps propose's worktree gate intact.

Depends on unit 6 because there is no route shape to read until wayfinder ships, and on unit 7 because
both edit `skills/hamilton-propose/SKILL.md` — serializing them avoids a conflict on the same file.

### 9. Sync the framework docs

Status: pending
Depends on: 6
Backed by: [How the framework docs present the pre-SDD stage](tickets/10-framework-docs-presentation.md),
[Fork attribution and licensing](tickets/03-fork-attribution.md)

Add the wayfinder entry to `docs/skills.md` in the established format, positioning it before
`propose` as an optional pre-change stage, and add the `New/changed map artifacts in .hamilton/maps/`
→ `docs/skills.md` row to `CONTRIBUTING.md`'s mapping table. The pipeline keeps its identity, phrased
as "six core skills in fixed sequence, plus an optional pre-change planning stage."

The `docs/skills.md` entry also carries the **fork's provenance in prose** — the one place a reader
learns where wayfinder came from, since ticket 03 ruled it out of `docs/sdd-framework.md`'s
Inspirations section. Brief, with a link to `NOTICE` for the legal credit.

**Hold the scope literally.** Ticket 10 restricts edits to `docs/skills.md` and `CONTRIBUTING.md`,
which means the six-skill diagram in `README.md` and `docs/sdd-framework.md` stays as it is. That is
the decision, not an oversight — resist widening it while editing.

### 10. Convert the map's own files to the mechanics contract

Status: pending
Depends on: 3
Backed by: [Map mechanics in files](tickets/04-map-mechanics-in-files.md)

This map was written with loose `Key: value` header lines; ticket 04 chose YAML frontmatter with
`type`, `status` and `blocked_by`. Convert `map.md` and all thirteen tickets, then give the
`## Map mechanics` contract a written home.

**One choice is deliberately left open.** Ticket 04 named two candidate homes — `CONTRIBUTING.md` or
a dedicated `MECHANICS.md` under `.hamilton/maps/` — and did not pick. That is a spec-level question,
so propose settles it rather than the implementer deciding mid-change.

Last in the route: dogfooding cleanup that touches only this map's own files, and it should follow
the templates that fix the shape it converts to.

## After the route

Each unit flips its own status here as it ships, on its own branch. When the last one merges, this
route is complete and `map.md` moves to `shipped` — the destination reached through Hamilton's own
loop, which was the point.
