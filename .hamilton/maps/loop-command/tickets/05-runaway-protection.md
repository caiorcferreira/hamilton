---
type: grilling
status: open
blocked_by: []
---

# Runaway protection

## Question

A Ralph loop is a while-true around a paid, autonomous, repository-mutating process. Decide what
stops it when it goes wrong, at the runner level — this applies to every topology, unlike the
`ralph`-specific exit condition in ticket 06.

- **Iteration cap.** Is there a default maximum, or is unbounded the default with `--max-iterations`
  as opt-in? A default of infinity matches Ralph's canonical form; a finite default matches the
  fact that most damage is discovered late.
- **Wall-clock budget.** Is there a `--max-duration`, and does it stop between iterations or
  interrupt one?
- **Cost budget.** Recorded in the map as fog because it may be unknowable across heterogeneous
  kernels — but if any kernel reports usage, does the runner act on it?
- **No-progress detection.** Ralph's characteristic failure is looping without advancing: identical
  diffs, empty commits, the same test failing every iteration. Is stagnation detected, and how —
  no git changes for N iterations, identical kernel output, an unchanged gate result? Or is this
  deliberately left to the human watching `status`?
- **Gate failure policy.** When a gate fails, does the loop stop, continue (letting the next
  iteration see the failure and fix it), or continue with a strike count? Continuing is the Ralph
  orthodoxy — the failing test *is* the next iteration's prompt context — but N consecutive
  failures is a good stagnation signal.
- **Kernel failure policy.** Distinguish a kernel exiting non-zero because the agent gave up from
  the kernel binary crashing or being missing. Retry, stop, or count as an iteration?
- **Where limits are set.** Flags, per-topology defaults, a settings file, or all three with a
  precedence order.

## Answer

## Outdated decisions
