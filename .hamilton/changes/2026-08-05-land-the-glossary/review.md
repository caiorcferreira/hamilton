# Review: Land the glossary

## Task 1: Write `.hamilton/specs/glossary.md` — 2026-08-05

Verdict: changes-requested

### Blocking

- [.hamilton/specs/glossary.md:36] The **route** entry lists a per-unit "suggested entry point into
  the pipeline" as a current field — "Each unit carries a name, a goal paragraph, links to the
  decisions backing it, its ordering against the other units, and a suggested entry point into the
  pipeline." That field was defined by
  [route.md shape and the SDD join](../../maps/hamilton-wayfinder/tickets/06-route-shape-and-sdd-join.md)
  (the ticket cited at the end of this entry), but a later decision superseded it:
  [route.md](../../maps/hamilton-wayfinder/route.md)'s own preamble states "Every unit enters at
  `hamilton-propose`... which collapses the per-unit 'suggested entry' field [ticket 06] specified
  into a constant. It is stated once here rather than repeated ten times." The glossary entry
  presents the pre-override shape as still-current, which a reader would take at face value since
  the glossary's whole premise is that a definition here can be cited instead of re-checking ticket
  prose. Fix: drop "and a suggested entry point into the pipeline" from the field list (or note that
  every unit enters at `hamilton-propose` uniformly, per ticket 09, rather than choosing per unit).
  This traces to a plan/coder gap, not a design flaw — `design.md`'s Constraints already require
  "Never invent or extend a definition beyond what a resolved ticket or the route text already
  established," and `route.md` itself (read earlier in this same session, per the transcript) is
  exactly the "route text" that constraint points at; the plan's step for *route* just didn't flag
  that ticket 06's per-unit field had since been overridden.  (violates: plan.md Task 1 Acceptance —
  "none introduces meaning beyond what the cited ticket or route text already established"; design.md
  Constraints — "Never: invent or extend a definition beyond what a resolved ticket or the route text
  already established")

### Suggestions

- [.hamilton/specs/glossary.md:34] Once the field-list fix above lands, re-read the whole **route**
  entry once more against `route.md`'s "Writing and lifecycle" section — the rest of the entry
  (written once at map close, points-not-restates, per-unit status field) still matches current
  `route.md` text, so no other change is expected, but it's the same class of staleness risk worth a
  final pass now that one instance surfaced.

### What else was verified

- Three `##` clusters present, in the order and under the exact headings `design.md`'s Architecture
  & Components names: The map and its parts / Working the map / From map to code.
- Ten bolded entries covering all eleven terms, `unit` correctly folded into `change-sized unit` as
  its route-time shorthand rather than a separate entry, matching `design.md` Decision 3.
- `grep -nE 'SHALL|WHEN|THEN' .hamilton/specs/glossary.md` — no matches; the file avoids the
  requirements-spec.md template as `design.md` Decision 1 requires.
- Every relative link target (`map.md`, tickets 01, 04, 06, 08) resolves on disk.
- The **map**, **destination**, **decision ticket**, **frontier**, **claim**, **change-sized unit**,
  **ticket type**, and **cleared/shipping/shipped** entries were checked line-by-line against their
  cited source tickets — each traces cleanly, including the deliberate, correctly-reasoned narrowing
  in the **claim** entry that `progress.md`'s Notes flags (it states only "still open, not resolved"
  rather than repeating ticket 04's frontier-adjacent sentence, which — read literally against the
  wayfinder skill's own frontier definition — would otherwise read as self-contradictory; not
  surfacing that tension inside the entry is a reasonable editorial call, not a silent resolution of
  an open question).
- `bun run build` → exit 0. `bun --bun vitest run` → 23 passed (3 files), unaffected by a
  markdown-only change, matching `design.md`'s Testing Strategy (no test asserts on `.hamilton/specs/`
  content).
- Scope: diff is confined to the one new file plus the change-directory artifacts (`proposal.md`,
  `design.md`, `plan.md`, `progress.md`) that were pending commit from earlier pipeline steps; no
  edits outside the task.
