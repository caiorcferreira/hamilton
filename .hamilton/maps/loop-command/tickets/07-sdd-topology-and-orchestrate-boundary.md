---
type: grilling
status: open
blocked_by: ["06"]
---

# The `sdd` topology and the `hamilton-orchestrate` boundary

## Question

The second topology, and the one that proves topologies differ in shape rather than configuration.
It drives Hamilton's own SDD artifacts.

- **What one iteration does.** The sketch from charting: read `plan.md`, take the next unchecked
  task, run `hamilton-code` on it, run gates, commit, exit. Confirm or revise. Does an iteration do
  one task or as many as it can?
- **Where review fits.** `hamilton-orchestrate` runs code *and* review per task. Does the `sdd`
  topology run `hamilton-review` as a separate iteration, as a node in the same iteration, or not
  at all? This is the clearest place the graph genuinely branches — review requesting changes loops
  back to code — and is the strongest evidence for or against the "topologies are graph shapes"
  premise.
- **How the kernel is told which skill to run.** A kernel takes a prompt. Does the topology
  synthesize a prompt naming the skill and task, or is there a conventional prompt template? Since
  skills are markdown loaded by the agent, the topology is writing agent instructions — whose
  authoring conventions apply?
- **Plan completion.** How does the topology know the plan is done — all tasks checked? What if a
  task cannot be completed and the agent leaves it unchecked forever? (Ties to stagnation, 05.)
- **Prerequisites.** Does the topology require a change directory and a `plan.md` to exist, and
  does it fail loudly or offer to run `hamilton-plan` first?
- **The boundary with `hamilton-orchestrate`.** Both drive a plan to completion. Orchestrate is
  in-session with subagents (shared context, compaction); `sdd` is process-level with fresh context
  per task. State the boundary in one sentence a user can act on. Then decide whether they coexist
  as a documented pair, or whether orchestrate is deprecated — the map holds the latter as fog that
  this ticket can graduate or dismiss.

## Answer

## Outdated decisions
