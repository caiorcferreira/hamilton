---
type: grilling
status: open
blocked_by: ["02"]
---

# The `ralph` topology

## Question

The default topology, generic by design: it knows nothing about `.hamilton/`. Fix its graph shape
and its inputs.

- **Prompt source.** Canonical Ralph is `cat PROMPT.md | claude -p`. Is the prompt a file path
  argument, a conventional filename the loop looks for, or inline text? Is it re-read every
  iteration (allowing a human to steer a running loop by editing it) or read once at start? The
  former is a real feature and worth naming explicitly.
- **Graph shape.** What are the nodes? A minimum is `invoke kernel → run gates → decide`. Does the
  topology also do: a pre-iteration clean-tree check, a post-iteration commit, a gate-failure
  branch? Where does the branching actually live, given that "loops are topologies, not config" is
  the standing justification for LangGraph.
- **Gates.** How are they specified — a list of shell commands, a single command, a conventional
  script? Are they configured per-run or per-project? Note `AGENTS.md`: this repo's only gate is
  `bun run build`, with no lint or typecheck script.
- **Exit condition.** What ends a `ralph` run, other than the runner-level caps from ticket 05?
  Options: never (human stops it), a sentinel the agent writes, gates passing when they previously
  failed, an explicit "done" marker file. Ralph orthodoxy leans on the human; a sentinel is more
  useful and more forgeable.
- **Commit discipline.** Does the topology commit after each iteration, or does the agent commit
  and the topology only verify? A killed run leaving a clean tree (ticket 04) depends on this.
- **Context allocation.** Huntley's steering lever: every iteration starts from the same known
  files. Does the topology inject anything beyond the prompt — `AGENTS.md`, a plan file, the last
  gate output — and if so is that generic enough to stay in the `ralph` topology rather than `sdd`?

## Answer

## Outdated decisions
