# Fork wayfinder into Hamilton

## Destination

`skills/hamilton-wayfinder/` — plus the ported sibling skills it needs and the synced framework
docs — authored and merged to `main`, so Hamilton has a pre-SDD stage that refines a loose goal
into change-sized units the SDD loop implements.

The map reaches the destination *through* Hamilton's own loop: when the decisions below are
settled, `route.md` names the change-sized units, and each unit runs
`hamilton-propose → plan → code → review → finish-work`.

## Notes

**Domain:** Hamilton's own repository — skill authoring, artifact conventions, framework docs.
Read `AGENTS.md`, `CONTRIBUTING.md`, `docs/sdd-framework.md` and `docs/skills.md` before
resolving any ticket. Upstream source is
[mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering) (MIT).

**This map carries execution** — overriding wayfinder's "plan, don't do" default. The destination
is a merged fork, not a set of decisions. Execution is delegated to the SDD loop via `route.md`,
not performed inside the tickets.

**Standing decisions from charting** (2026-08-04) — these frame every ticket and are not up for
re-litigation without redrawing the destination:

- **File-native, mechanics isolated.** The map and its tickets are markdown under `.hamilton/`.
  No tracker indirection, no external config doc. Tracker mechanics live in one clearly-bounded
  `## Map mechanics` section so a later change can swap them.
- **Route handoff.** A cleared map produces a `route.md` naming change-sized units in order, each
  linking the decisions that back it. Wayfinder does not scaffold change directories itself.
- **Port the siblings.** `research`, `prototype` and `domain-modeling` come into Hamilton
  alongside the fork rather than being inlined or soft-depended on.

**Provisional layout.** This map lives at `.hamilton/maps/hamilton-wayfinder/` as a working
guess — [Map artifact layout under .hamilton/](tickets/01-map-artifact-layout.md) decides the real
convention and may relocate it. Dogfooding is deliberate: the fork's first user is its own fork.

**Skills every session should consult:** `/grilling` for the decision tickets.

## Decisions so far

<!-- one line per closed ticket: enough to judge relevance, then open the link for the detail -->

## Not yet specified

- **Worktrees and branching.** Hamilton's `hamilton-propose` creates worktrees per change. How a
  long-lived map relates to that — does it live on `main`, on its own branch, in the worktree of
  the unit being built? Can't be phrased sharply until layout and mechanics land.
- **Concurrency and claiming.** Upstream's claim mechanic exists because several sessions share one
  tracker. Whether a file-based map in a single repo needs claiming at all, and what it means when
  two worktrees hold divergent copies, depends on the mechanics decision.
- **CLI surface.** Whether `hamilton` grows anything for maps (a scaffold command, a frontier
  query) — hangs on the template convention decision.
- **Test impact.** `tests/cli/setup.test.ts` asserts what `hamilton setup` installs. If map
  templates land in `bundle/templates/`, that suite and the bundle-override fixtures move with them.
- **Existing skills' awareness.** Whether `hamilton-init` scaffolds the map directory, and whether
  `hamilton-propose` should mention an upstream map when one exists.

## Out of scope

- **Tracker pluggability** — GitHub/GitLab backends for the map. Ruled out at charting; the fork
  ships file-native with mechanics isolated so a later effort can add them.
- **Porting the rest of the upstream engineering skills** — `to-tickets`, `triage`, `to-spec`,
  `code-review`, `tdd`, `implement`, and the others. Only the three siblings wayfinder actually
  delegates to are in scope.
