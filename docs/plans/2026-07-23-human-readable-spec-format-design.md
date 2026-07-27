# Human-readable canonical spec format — design

**Status:** validated design, ready for implementation planning
**Date:** 2026-07-23

## Problem

Hamilton's canonical specs (`.hamilton/specs/<capability>.md`) are written in an
OpenSpec / ISO-29148-inspired structure: `## Requirements` → `### Requirement: <name>`
(a `SHALL` statement + Priority + Rationale) → `#### Scenario: <name>` (`WHEN`/`THEN`).
The **altitude** this sets — durable, black-box, contract-level knowledge rather than
mechanism — is right and stays. The **format** is the problem: it reads like a compliance
form, not like documentation a human wrote. Concretely, a `event-data-model.md` spec should
show the event's contract — field names, types, the shapes the app accepts — and today it is
a wall of `SHALL` prose about interface methods instead.

The format is also load-bearing, which is why this is a workflow problem and not just a
restyle:

- **Merge keys.** `hamilton-finish-work` folds a change's requirement deltas into the
  canonical spec by matching `### Requirement:` names (MODIFIED replaces by name, REMOVED
  deletes by name, RENAMED renames the header).
- **Proto-tests.** Each `WHEN`/`THEN` scenario is meant to be derivable directly into a
  black-box conformance test.

Any new format has to say what happens to both.

## Decisions

Resolved through collaborative brainstorming:

1. **Merge model — anchored sections.** The canonical spec keeps stable heading anchors;
   changes are applied against sections, not against `Requirement:` names. Body under each
   anchor is free-form human prose/tables.
2. **Structure — a light universal skeleton.** Every spec shares five top-level sections;
   the body under each is human prose. The five sections *are* the four altitude registers
   plus an Overview.
3. **Scenarios — prose + explicit Examples block.** The `Behavior` section is narrative,
   followed by a compact, greppable `Examples` list of input→outcome pairs. The proto-tests
   survive as a distinct artifact without the `WHEN`/`THEN` scaffold.
4. **Change delta — structured → prose (asymmetric).** The change side is unchanged: the
   `requirements/<capability>.md` delta keeps today's structured `ADDED`/`MODIFIED`/
   `REMOVED`/`RENAMED` blocks with `SHALL` + `WHEN`/`THEN`, crisp and verifiable for
   plan/code/review. Only the **canonical** spec adopts the prose skeleton. `finish-work`
   translates one into the other.
5. **Voice — natural, keywords for invariants.** Canonical prose reads as plain technical
   documentation. `MUST`/`NEVER` are reserved for hard invariants and boundaries where the
   emphasis earns its keep. (Change-side deltas keep `SHALL` regardless.)
6. **Migration + bootstrap — a new `hamilton-compose-spec` skill** with two modes (below).
7. **Shared reference — duplicated per skill.** `spec-altitude.md` is copied into each
   consuming skill's `references/`, matching Hamilton's self-contained-skill convention.
8. **Scope — both compose modes ship together.**

## The format

Canonical spec `.hamilton/specs/<capability>.md`:

- **Overview** — one paragraph: what the capability is responsible for.
- **Contract** — the concrete interface: field tables, schemas, endpoints, status codes,
  error taxonomy. The section that answers "what does the app accept / return."
- **Behavior** — narrative input→output prose, then a compact **Examples** block of
  input→outcome bullets (the surviving proto-tests).
- **Invariants** — properties that hold across all states and over time. `MUST`/`NEVER`
  allowed here.
- **Decisions** — reusable design rules and deliberate decisions ("policy, not incident").

Rules:

- Sections are **omittable** when a capability has nothing for them — right-sized, not
  gold-plated.
- Domain subheadings under Contract/Behavior (e.g. `### RAP_OPERATION_SYNC`) are the **finer
  merge anchors** `finish-work` targets.
- Natural documentation voice throughout; normative keywords only in Invariants/boundaries.
- Still at altitude: the `spec-altitude.md` tests (black-box scenario, "via/using/as" tell,
  reason-to-change, four registers) all still apply — the skeleton is a shape for the same
  altitude, not a license to drop to mechanism.

### Register → section mapping

| Altitude register | Skeleton section |
|-------------------|------------------|
| Contract          | Contract         |
| Behavior          | Behavior (+ Examples) |
| Invariant         | Invariants       |
| Decision / pattern| Decisions        |
| (narrative frame) | Overview         |

### Illustrative before/after (`event-data-model.md`)

```markdown
# Capability: event-data-model

## Overview
The domain types the worker decodes inbound events into, read through a few
data-access interfaces. These types carry only parsed payload data — no
validation or processing policy; that lives in the handler owning each type.

## Contract
Every decoded event implements `TemplateData` (data-only):

| method             | returns | purpose                                       |
|--------------------|---------|-----------------------------------------------|
| GetMessageType()   | string  | event discriminator, e.g. RAP_OPERATION_SYNC  |
| GetTemplateType()  | string  | LLM template id, or "" for non-template        |
| GetTemplateData()  | any     | template payload, or nil                       |

**BasicMessage** — the ingestion envelope:

| field | type   | notes                                         |
|-------|--------|-----------------------------------------------|
| Type  | string | parsed once at ingestion (routing + metrics)  |
| Raw   | string | original payload, handed to the decoder       |

## Behavior
A new event type is added by implementing the three methods; its validation
and processing live in its handler. At ingestion the message is parsed once
into BasicMessage and both fields travel to the controller, which routes on
Type and hands Raw to the decoder — no second unmarshal.

**Examples**
- new event type → implements only the 3 data-access methods
- controller routes by Type, passes Raw to decoder without re-parsing

## Invariants
- An event struct MUST carry only fields present in its JSON payload — never injected dependencies.
- The inbound payload MUST NOT be unmarshalled twice on the ingestion→controller path.

## Decisions
- Data structs are pure carriers; validation/ShouldProcess/PostProcess live on the owning
  handler, not on the type or a shared interface.
```

## The workflow

### What stays put (deliberately)

- `hamilton-propose` still writes `requirements/<capability>.md` as structured
  `ADDED`/`MODIFIED`/`REMOVED`/`RENAMED` blocks with `SHALL` + `WHEN`/`THEN`.
- `bundle/templates/requirements-change.md` — unchanged.
- `plan → code → review` keep reading the structured change requirements.

### `hamilton-finish-work`: distill + translate

Step 2 ("Sync specs") changes from *copy named blocks by exact name* to *distill and translate
into anchored sections*: read the structured deltas **plus the current prose canonical spec**,
apply the altitude rubric, and update the skeleton's anchored sections. Delta semantics move
up to the section level:

- **ADDED** → new Contract row / Behavior example / Invariant / Decision, or a new domain
  subsection.
- **MODIFIED** → rewrite the affected section(s).
- **REMOVED** → drop the behavior from the relevant section.
- **RENAMED** → rename the anchor.

The merge key is no longer `Requirement: X` — it is "the section this behavior belongs to."

### New skill: `hamilton-compose-spec`

The direct front door for canonical specs, **outside** the change loop. Fills a real gap:
today canonical specs can only be born through `finish-work` distillation. Two modes:

- **reformat** — read an existing spec (old Requirement/Scenario format), apply altitude +
  skeleton, rewrite as anchored-section prose. Batch-run over `specs/` to migrate a project.
- **from-code** — explore the application read-only and author canonical specs from scratch,
  following the same altitude, skeleton, and anchors. How a codebase adopting Hamilton gets
  its first specs.

### Shared reference: `spec-altitude.md`

Extended (not replaced): it already defines the four registers and the altitude tests; it
gains the skeleton definition, the register→section mapping, and the Examples-block treatment
of scenarios. Copied into both `hamilton-finish-work/references/` and
`hamilton-compose-spec/references/` (self-contained-skill convention; two copies to keep in
sync).

## Blast radius (file by file)

1. `bundle/templates/requirements-spec.md` — rewrite to the skeleton.
2. `bundle/templates/requirements-change.md` — unchanged.
3. `skills/hamilton-finish-work/SKILL.md` (step 2) — distill + translate into anchored sections.
4. `skills/hamilton-finish-work/references/spec-altitude.md` — extend with skeleton +
   section mapping + Examples treatment.
5. **New** `skills/hamilton-compose-spec/` — `SKILL.md` (reformat + from-code modes) plus a
   copy of `references/spec-altitude.md`.
6. `skills/hamilton-propose/SKILL.md` — minor: it reads canonical specs (now prose) to tell
   new vs. modified capabilities; anchors keep that working. Verify wording still fits.
7. `docs/sdd-framework.md`, `docs/philosophy.md` — update the "SRS (canonical)" description
   and add `compose-spec` to the skills map.
8. Sweep `hamilton-plan` / `hamilton-code` / `hamilton-review` for any assumption that the
   canonical spec is in Requirement/Scenario form (they mostly read change requirements, but
   confirm).

## Open items for planning

- Exact contract of `hamilton-compose-spec` invocation (mode selection, target path/glob).
- Whether `spec-altitude.md`'s "every requirement carries a scenario" framing is reworded for
  the Examples-block model, or kept only for the change-side delta.
- Keeping the two `spec-altitude.md` copies in sync (a test or a check).
