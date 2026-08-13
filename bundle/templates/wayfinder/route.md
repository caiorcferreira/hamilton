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

## Units

### 1. <Unit name>

Status: pending
Depends on: —
Backed by: [<ticket title>](tickets/NN-slug.md)
Decisions:
- Decided: <outcome in one line> ([<ticket title>](tickets/NN-slug.md))

<!-- hint: the goal as a paragraph, then one Decisions line per backing decision
     stating its outcome. Reasoning, context, and alternatives stay in the ticket —
     the Decisions lines are the drill-down entry points. Status values:
     pending / in-progress / shipped. -->
