# route.md shape and the SDD join

Type: grilling
Status: open
Blocked by: 01

## Question

What exactly does `route.md` contain, and how does a unit in it become a change in the SDD loop?

Charting settled that a cleared map produces a route of change-sized units, each linking the
decisions that back it, and that wayfinder does **not** scaffold change directories itself. The
contract's content is still open.

Settle:

- **What a "change-sized unit" is.** Hamilton's `hamilton-plan` already decomposes into TDD-sized
  tasks, so a route unit must be coarser than a task. Is it "one thing that runs the whole
  propose→finish loop"? What makes a unit too big, and what does an agent do when it finds one?
- **The fields per unit.** Name, one-line goal, backing decision links, ordering or dependency
  between units, suggested entry point (`hamilton-propose` for a unit that warrants a spec versus
  straight to `hamilton-plan` for a tactical one)?
- **How decisions travel.** A unit's implementer needs the decisions behind it. Do they read the
  linked tickets, or does the route restate the binding constraints inline? The map is an index and
  never restates decisions — does `route.md` inherit that rule, or is it the one place that breaks
  it, since it is read by someone who never saw the map?
- **When it is written.** At the end as a closing act, or grown incrementally as units become
  visible?
- **What happens after.** Does the route track which units have shipped, and is that how the map
  reaches its destination? Does a finished route mean the map can be deleted?
