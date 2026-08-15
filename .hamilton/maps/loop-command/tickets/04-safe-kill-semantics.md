---
type: grilling
status: open
blocked_by: ["03"]
---

# Safe kill semantics

## Question

"Safe" is doing a lot of work in the goal "a safe method to kill the background process". Define it.

- **What is unsafe about killing?** Candidates: a kernel mid-`git commit` leaving an index lock; a
  half-applied edit; orphaned grandchild processes (the agent CLI's own subagents and tool calls);
  a run directory left claiming `running`. Which of these actually matter, and which are handled by
  the kernel already?
- **Stop vs kill.** Are these two commands or one? A graceful *stop* could let the current
  iteration finish and decline to start the next — safe, but unbounded, since an iteration can run
  for many minutes. A *kill* terminates the in-flight kernel. Does the CLI expose both?
- **Signal protocol.** SIGTERM to the supervisor, which then does what to the kernel? Does Hamilton
  signal the process *group* to catch grandchildren, and does that require the detached spawn to
  create a new session (ticket 03)?
- **Escalation.** Grace period before SIGKILL — fixed, configurable, or per-kernel? What is the
  default?
- **Idempotence and staleness.** `kill` on an already-dead run: error or no-op? `kill` on a run
  whose pid was recycled by an unrelated process — how is that prevented? (A pid alone is not a
  safe handle; recording start time or a process-name check may be needed.)
- **State after kill.** Does the run directory record *why* it stopped, distinguishing killed from
  crashed from completed? Does anything need cleaning up in the working repository, or is the
  loop's own commit discipline (ticket 06) enough that a killed run leaves a clean tree?

## Answer

## Outdated decisions
