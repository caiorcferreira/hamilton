---
artifact: route
effort: <effort-name>
status: open | shipping | shipped
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
decision: accepted | rejected | skipped
units:
  - id: 1
    name: <unit-name>
    status: pending | in-progress | shipped
    depends_on: []
    backed_by:
      - tickets/NN-slug.md
---

<!--
  Route — the handoff from a cleared map to the SDD loop.
  Produced by: hamilton-wayfinder
  Lives at: .hamilton/maps/<effort>/route.md
  Written once when the map clears. Each unit states its backing decisions'
  outcomes in one line each; reasoning stays in the tickets. The process that
  executes a unit flips its status on its own branch.
  Delete this comment block and every inline hint comment before finalizing.
-->

# Route — <Effort Name>

<!-- hint: the preamble — the constants that would otherwise repeat on every unit
     below, stated once. What the route is, and any standing rule every unit inherits. -->

## Shipping rules

<!-- hint: how the units will be shipped — the branch units merge back into
     (seeded from the map's `branch:` field), commit and merge/PR conventions,
     and any standing shipping constraint every unit inherits, including
     shipping-relevant operation rules carried over from the map. -->

## Units

### 1. <Unit name>

<!-- Unit metadata is represented by the matching entry in the document frontmatter `units` list. -->

Decisions:
- Decided: <outcome in one line> ([<ticket title>](tickets/NN-slug.md))

<!-- hint: the goal as a paragraph, then one Decisions line per backing decision
     stating its outcome. Reasoning, context, and alternatives stay in the ticket —
     the Decisions lines are the drill-down entry points. Status values:
     pending / in-progress / shipped. -->
