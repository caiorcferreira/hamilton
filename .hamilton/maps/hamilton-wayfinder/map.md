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

**Layout is settled.** `.hamilton/maps/<effort>/` holding `map.md`, `route.md` and
`tickets/NN-slug.md` — decided in
[Map artifact layout under .hamilton/](tickets/01-map-artifact-layout.md), which confirmed this
map's provisional guess rather than moving it. Dogfooding is deliberate: the fork's first user is
its own fork.

**Skills every session should consult:** `/grilling` for the decision tickets.

## Decisions so far

<!-- one line per closed ticket: enough to judge relevance, then open the link for the detail -->

- [Map artifact layout under .hamilton/](tickets/01-map-artifact-layout.md) — `.hamilton/maps/<effort>/`
  as a third sibling to `specs/` and `changes/`, undated slug, `tickets/NN-slug.md`, no asset
  directory. `hamilton-init` does not scaffold it; a cleared map stays in place, marked. Nothing
  relocates — the provisional guess is now the convention.
- [Read the three upstream sibling skills](tickets/02-read-upstream-siblings.md) — all three are small
  (research 12 lines, prototype 217, domain-modeling 181) and MIT. `research` ports clean; `prototype`
  assumes an issue to hang its context pointer on; `domain-modeling` is the real collision — it writes
  a root `CONTEXT.md` glossary and numbered `docs/adr/` records, a durable-truth system parallel to
  `.hamilton/specs/`.
- [Fork attribution and licensing](tickets/03-fork-attribution.md) — Hamilton had **no licence at
  all**; it adopts **Apache 2.0**. Upstream credit is formal, not prose: `LICENSE` + `NOTICE` at the
  root, plus a `NOTICE` inside every forked skill directory, because the skill directory — not the
  repo — is the unit of distribution. `Copyright 2026 Caio Ferreira`, no per-file headers, and the
  Inspirations section stays untouched.
- [Map mechanics in files](tickets/04-map-mechanics-in-files.md) — **YAML frontmatter** with
  `type`, `status`, `blocked_by`. Claiming stays (signals intent, doesn't prevent collision).
  Status values: `open` / `resolved` for tickets, `open` / `cleared` for maps. `## Map mechanics`
  section documents the frontmatter contract for future tracker backends.
- [Template convention](tickets/05-template-convention.md) — All three shapes (`map.md`, `ticket.md`,
  `route.md`) go into `bundle/templates/wayfinder/`. Wayfinder depends on `hamilton setup` having been
  run first; dependency is documented, not guarded. Test and docs updates in the route.
- [Route shape and the SDD join](tickets/06-route-shape-and-sdd-join.md) — `route.md` is a static
  handoff document listing change-sized units in order with dependencies. Each unit: name, goal
  (paragraph), decision links, ordering/dependencies, entry point. Implementers follow links; route.md
  does not restate. Route tracks unit completion. Map status: `cleared` → `shipping` → `shipped`.

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
- **Existing skills' awareness.** Whether `hamilton-propose` should mention an upstream map when
  one exists. (The `hamilton-init` half is settled — it does not scaffold the map directory.)

## Out of scope

- **Tracker pluggability** — GitHub/GitLab backends for the map. Ruled out at charting; the fork
  ships file-native with mechanics isolated so a later effort can add them.
- **Porting the rest of the upstream engineering skills** — `to-tickets`, `triage`, `to-spec`,
  `code-review`, `tdd`, `implement`, and the others. Only the three siblings wayfinder actually
  delegates to are in scope.
