---
type: grilling
status: open
blocked_by: ["03", "04"]
---

# CLI surface

## Question

`hamilton` has exactly one subcommand today, and it copies files. This ticket fixes what the loop
adds.

- **Subcommands.** `hamilton loop` with `run` / `status` / `list` / `stop` / `kill` / `logs`, or a
  flatter shape? Is `hamilton loop` alone a run, or a help stub like the current root command?
- **Foreground or background by default.** Does `hamilton loop run` block and stream, with
  `--detach` to background it, or detach by default? Charting recorded background as a goal, not a
  default — decide which is less surprising.
- **Naming a run.** Does the user pass `--name`, or only ever get a generated id back? Do `status`
  and `kill` accept a name, an id, a prefix, or default to the most recent run when there is only
  one?
- **Machine-readable output.** Does `status` support `--json`? A loop is a thing people will script
  around and watch from other tools, so this is more load-bearing than for `setup`.
- **What `status` shows.** Run id, topology, kernel, state, current iteration, elapsed, last gate
  result, last commit — which of these, and how does it degrade when the supervisor is dead?
- **`logs`.** Whole run or per-iteration? Is there a `-f` follow, and does that depend on the
  streaming decision in ticket 02?
- **Effect seam.** Per the map's standing constraint, these commands register through `@effect/cli`
  but their implementations must not take an Effect dependency. Ticket 10 fixes the seam; this
  ticket must not design a surface that makes that seam impossible — e.g. by leaning on
  `@effect/cli`'s validation or prompting for loop-specific behavior.

## Answer

## Outdated decisions
