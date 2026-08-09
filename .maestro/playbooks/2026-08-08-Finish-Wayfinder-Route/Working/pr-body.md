---
## What shipped

This branch completes the **wayfinder fork** — the route at `.hamilton/maps/hamilton-wayfinder/route.md` reached `shipped` after all ten change-sized units ran the SDD loop (`hamilton-propose → plan → code → review → finish-work`).

Units 6–10 (the focus of this push):

- **Unit 6 — Author `hamilton-wayfinder`** — the centerpiece skill written from scratch, plus its `references/` and `NOTICE`.
- **Unit 7 — Refactor propose + critique onto `hamilton-grilling`** — propose delegates its three dialogue surfaces to grilling; critique gains grilling on the `changes-requested` path. "Judge, don't fix" preserved.
- **Unit 8 — Teach propose to read a route** — `hamilton-propose` gains map-aware entrypoint logic (reads `route.md`, finds the next pending unit, pulls decision context).
- **Unit 9 — Sync framework docs** — wayfinder entry in `docs/skills.md`, `CONTRIBUTING.md` mapping row, fork provenance in prose.
- **Unit 10 — Convert map files to the mechanics contract** — `map.md` + all thirteen tickets converted to YAML frontmatter; `## Map mechanics` contract documented in `CONTRIBUTING.md`.

Units 1–5 (glossary, Apache 2.0 licensing + attribution, wayfinder artifact templates, porting `hamilton-grilling`, and porting the three wayfinder siblings) landed earlier in the route.

### Whole-branch review outcome

A whole-branch review (Phase 06) covered three axes: internal consistency across the changed skills, coherence with the route's intent, and Hamilton-framework integration. Verdict: **findings (2 minor, no runtime impact)** — both applied and committed (`2f83dd9`):

1. `.hamilton/specs/artifact-templates.md` under-specified status vocabularies — now matches `wayfinder.md`, the wayfinder `SKILL.md`, and `CONTRIBUTING.md`.
2. `skills/hamilton-critique/SKILL.md` unattended instruction ambiguously skipped "write the report" — reworded so step 7 still runs unattended.

## Map of record

- **Route:** `.hamilton/maps/hamilton-wayfinder/route.md` — the ten-unit handoff that drove this effort; all units show `Status: shipped`.
- **Map:** `.hamilton/maps/hamilton-wayfinder/map.md` — frontmatter reads `status: shipped` (destination reached).

## Gates

- `bun run build` — exit 0 (tsc).
- `bun --bun vitest run` — 24/24 tests pass across 3 files.
- No test asserts on skill content — `tests/cli/setup.test.ts` covers only bundled templates and guidelines; `skills/` is not bundled (per [ticket 12](.hamilton/maps/hamilton-wayfinder/tickets/12-propose-and-critique-use-grilling.md)). Units 6–10 are verified by reading.

Diff vs `main`: 119 files changed, +20,875 / −26.

---
