# SDD artifact templates

Templates for the spec-driven pipeline. Each maps to a well-known standard, taken
in spirit (right-sized), not by conformance.

| Template                 | Document        | Owns  | Standard (inspiration)   | Produced by          |
|--------------------------|-----------------|-------|--------------------------|----------------------|
| `proposal.md`            | PRD             | Why   | —                        | hamilton-propose     |
| `requirements-change.md` | SRS (delta)     | What  | ISO/IEC/IEEE 29148       | hamilton-propose     |
| `requirements-spec.md`   | SRS (canonical) | What  | ISO/IEC/IEEE 29148       | hamilton-finish-work |
| `design.md`              | SDD             | How   | IEEE 1016                | hamilton-propose     |
| `plan.md`                | Plan            | Steps | — (handoff contract)     | hamilton-plan        |
| `progress.md`            | Progress        | Log      | — (execution ledger)  | hamilton-code        |
| `review.md`              | Review          | Verdict  | — (review artifact)   | hamilton-review      |

The two SRS forms are the same content in two states: `requirements-change.md` is the
delta a change proposes; `requirements-spec.md` is the consolidated truth it folds into.

## Required vs optional

Only `plan.md` is required. `proposal.md`, `design.md`, and `requirements/` are
optional: small or mechanical changes may start directly at `hamilton-plan`.

Every downstream skill therefore degrades gracefully — it consumes the richer
upstream artifact when present, and otherwise works from the raw change
description. This is what makes "start anywhere" real.

## Where they live

```
.hamilton/
  specs/                              # canonical capability truth (living)
    <capability>.md                   # requirements-spec.md form — no delta markers
  changes/
    <YYYY-MM-DD-change-title>/
      proposal.md                     # optional (PRD)
      design.md                       # optional (SDD)
      requirements/                   # optional (SRS, delta form)
        <capability>.md               # requirements-change.md form
      plan.md                         # required
      progress.md                     # execution ledger — what actually happened
      review.md                       # review verdict + feedback (per pass)
```

`plan.md` is authored up front; `progress.md` is written during implementation. Task
completion lives in `progress.md`, not as a status field on the plan.

`requirements/*.md` inside a change use delta headers (ADDED / MODIFIED / REMOVED /
RENAMED). `hamilton-finish-work` folds those deltas into the canonical
`.hamilton/specs/<capability>.md`, which holds no delta markers.

> Location note: this folder is provisional for review. Templates will move into
> the skill package(s) once the skills are restructured.
