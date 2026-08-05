# Compose route.md — the change-sized units

Type: task
Status: open
Blocked by: 03, 04, 05, 08, 10, 12

## Question

Nothing left to decide — write the route.

With every decision above resolved, compose `route.md` in the shape
[route.md shape and the SDD join](06-route-shape-and-sdd-join.md) settled: the change-sized units in
order, each linking the decisions that back it.

Expect units along these lines, though the resolved decisions govern:

- Author `skills/hamilton-wayfinder/SKILL.md` and whatever `references/` it needs.
- Port the sibling skills that survived [Which siblings to port](07-which-siblings-to-port.md).
- Land the artifact templates, if [Template convention](05-template-convention.md) chose templating —
  including the `tests/cli/setup.test.ts` impact.
- Sync the docs per [How the framework docs present the pre-SDD stage](10-framework-docs-presentation.md).
- Land the attribution per [Fork attribution and licensing](03-fork-attribution.md).

Before writing, re-read the map's **Not yet specified** section: several patches (worktrees, CLI
surface, existing skills' awareness) should have graduated into tickets or been ruled out by the
time this ticket is takeable. Anything still fogged here is a signal the map is not actually clear.

Closing this ticket clears the map. Each unit then runs
`hamilton-propose → plan → code → review → finish-work`.
