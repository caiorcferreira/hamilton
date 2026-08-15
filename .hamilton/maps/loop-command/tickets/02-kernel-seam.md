---
type: grilling
status: open
blocked_by: []
---

# The kernel seam

## Question

A kernel executes one iteration's agent invocation behind a stable interface. Fix that interface
and the v1 implementations.

- **Signature.** What does a kernel receive and return? The minimum is a prompt and a working
  directory in, an exit status out. Does it also receive: a timeout, an `AbortSignal`, an
  environment, a log sink, an iteration number? Does it return anything richer than an exit code —
  captured stdout, a structured result, a usage report?
- **Streaming vs buffering.** Does the kernel stream output to the run's log as it goes, or return
  it at the end? Streaming matters for `hamilton loop logs -f`; buffering is simpler.
- **Which kernels ship in v1.** Two external implementations are needed to prove the seam is not
  single-implementation fiction. `claude -p` is one. What is the second — `opencode run`, `codex`,
  something else — and is that choice driven by what the author uses or by what is most different
  from Claude Code (which stress-tests the abstraction harder)?
- **Configuration and selection.** How does a run pick its kernel — a flag, a settings file, a
  per-topology default? Where do kernel-specific arguments (model, permission mode, allowed tools)
  live, given every agent CLI spells them differently?
- **Discovery and failure.** What happens when the selected kernel binary is not on `PATH`? Is
  there a preflight check, and does it run at loop start or at first iteration?
- **What a kernel is forbidden from doing.** The seam is only honest if kernels cannot reach around
  it. Does a kernel own git commits, or does the topology? Does a kernel decide when to stop?

Note the constraint from charting: kernels are external subprocesses in v1, and the internal kernel
is out of scope. The interface should not be so narrow that an internal kernel could never satisfy
it, nor so wide that it is shaped entirely around one agent CLI's flags.

## Answer

## Outdated decisions
