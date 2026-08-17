---
type: grilling
status: resolved
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

Resolved by grilling, 2026-08-17.

**The interface.** Kernel-specific configuration binds at construction; `run()` takes only what
varies per iteration:

```
makeClaudeKernel({ model, permissionMode, env, sink, ... }) → kernel
kernel.run({ prompt, cwd, signal }) → { outcome, exitCode, sessionId?, usage? }
```

- `signal` is an `AbortSignal` and is required — `hamilton loop kill` must be able to interrupt an
  agent turn mid-flight, or kill orphans the subprocess. There is **no separate timeout
  parameter**: compose `AbortSignal.timeout()` into `signal` at the call site, so there is one
  cancellation mechanism rather than two that can disagree.
- **Rejected as `run()` inputs:** iteration number (only log naming wants it — the sink's concern),
  env (a property of which kernel, not which iteration), timeout (above). The env in construction
  config is an **overlay** on the inherited process environment, not a replacement.
- `outcome` is `"completed" | "failed" | "aborted"` — normalized by the kernel so topologies never
  learn any CLI's exit-code conventions; `aborted` keeps a kill from being misread as failure.
- `sessionId?` is optional (per-CLI availability) and **forensic only** — for opening the
  transcript in the agent's own tooling after the fact, never an input to a later iteration.
  Feeding it back to resume a conversation would break the fresh-context guarantee.
- `usage?` (`{ inputTokens, outputTokens, costUsd }`) is optional: kernels populate it when their
  CLI reports usage, omit it when not. Optionality is honest about heterogeneous kernels without
  forcing a lowest common denominator.

**Streaming, not buffering.** The kernel pipes child stdout/stderr to a sink it is constructed
with. Buffering was rejected on three counts: `logs -f` is incoherent when a 10-minute agent turn
only flushes at the end; a mid-turn crash leaves no transcript exactly when one is most needed; and
holding a long transcript in the runner's memory is pure cost. `run()` does **not** return captured
output — that would recreate the buffering problem and tempt topologies into parsing transcripts.

**Where truth lives.** Topologies read truth from repo state and gates, never from agent
self-reports through the return channel. A richer "did the agent claim it's done" field was
considered and rejected.

**The boundary (non-reliance, not prohibition).** Hamilton cannot forbid an external agent from
committing — a prompt ending in `git commit` will commit. So the rule is: kernels *may* leave
commits behind; the topology must be correct **whether or not** the agent committed, and must be
able to ensure the tree is committed before a new iteration starts (uncommitted state is
cross-iteration contamination). The commit sweep is **topology-chosen**, not runner-imposed —
`ralph` wants sweep-into-a-commit per iteration, while `sdd` (where `hamilton-code` already commits
per task) may want to treat a dirty tree as a failure signal, which a forced sweep would destroy.
The git plumbing lives in **its own module**, not as a runner helper — the runner supervises
processes and does not accrete utilities. Topologies own stopping; kernels never decide when the
loop ends.

**v1 kernels: `claude -p` and `opencode run`.** Driven by what the author actually uses (opencode
is the main agent), and opencode also stress-tests the seam: different vendor, different
`provider/model` naming, different config surface.

**Selection and configuration.** `--kernel <name>` flag → `loop.defaultKernel` in
`~/.hamilton/settings.yaml` → hardcoded fallback. Kernel-specific settings live in per-kernel
opaque blocks (`loop.kernels.<name>`) whose schema belongs to the kernel implementation — Hamilton
never lifts agent-CLI flags into its own vocabulary, because every CLI spells model/permissions
differently and a translation layer would grow into the union type the construction-time split
avoids. Accepted cost: no per-run model override without editing settings; a per-kernel-interpreted
`--model` convenience flag can come later but is out of v1.

**Discovery and failure.** Preflight at loop start, in the foreground, **before the runner
detaches** — a detached run that dies on a `which`-detectable error surfaces only via a later
`status`, while failing before detach lands the error in the terminal synchronously with no
half-created run directory. Preflight checks existence and executability only: no version pinning
(a treadmill against two fast-moving CLIs; a too-old CLI already surfaces as a failed iteration)
and no auth probe (costs tokens; auth failure surfaces in the first iteration's transcript).
Mid-run binary disappearance gets no special handling — the spawn fails, the kernel returns
`failed`, and runaway protection (ticket 05) is the layer that stops a loop failing forever.

## Outdated decisions
