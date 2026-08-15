---
status: open
---

# Loop command

## Destination

`hamilton loop` — a general-purpose loop runner that repeatedly invokes a coding agent in a fresh
process until an exit condition holds, with:

- **Pluggable topologies.** Two ship in v1: `ralph` (generic Ralph Wiggum — prompt, gates, exit
  predicate) and `sdd` (drives Hamilton's own `plan.md`). New topologies are graph shapes, not
  config records.
- **Pluggable kernels.** One iteration is executed by an interchangeable agent kernel. v1 ships
  external subprocess kernels only.
- **Background lifecycle.** Start detached, query status, and stop safely from separate processes.

Built on [LangGraph.js](https://github.com/langchain-ai/langgraphjs) for topology orchestration,
and written Effect-free except at the CLI registration seam.

The map reaches its destination through Hamilton's own SDD loop: when the decisions below are
settled, `route.md` names the change-sized units, and each unit runs
`hamilton-propose → plan → code → review → finish-work`.

## Notes

**Domain:** Hamilton's own repository — a TypeScript/bun CLI on Effect-TS, distributed as
cross-platform standalone binaries. Read `AGENTS.md`, `docs/modes.md`, `docs/skills.md` and
`.hamilton/specs/cli-distribution.md` before resolving any ticket.

**Standing decisions from charting** (2026-08-13) — these frame every ticket and are not up for
re-litigation without redrawing the destination:

- **LangGraph.js for orchestration; Mastra rejected.** Mastra's `startAsync` / `cancel` /
  `getWorkflowRunExecutionResult` are same-process handles and do not serve cross-process status
  and kill. LangGraph's checkpointer keyed by `thread_id` does, because a separate process can
  read the same backing store. Mastra is out of scope entirely.
- **Hamilton writes its own `BunSqliteSaver`.** Confirmed as the chosen path (2026-08-15). The
  official `@langchain/langgraph-checkpoint-sqlite` cannot run under Bun at all, so a checkpointer
  extending `BaseCheckpointSaver` over `bun:sqlite` is how the loop gets LangGraph durability —
  graph resume after a crash, and `interrupt()` gates. This is **not conditional** on how `status`
  is implemented: the saver exists for graph durability, and whether `status` reads from it or from
  the run directory is a separate question left to ticket 03.
- **The daemon layer is built regardless.** A checkpointer gives state, not process supervision —
  a thread can read as `running` while its process is long dead. Detached spawn, pidfile,
  liveness check, signal handling and escalation are Hamilton's to build under any framework.
- **Loops are topologies, not config.** Future loops are genuinely different graph shapes, which
  is what buys LangGraph its place. A loop is code, not a settings record.
- **v1 ships external kernels only.** The kernel seam is real, validated by two external
  implementations. An internal agent kernel is out of scope, below.
- **Two topologies in v1.** `ralph` is generic and knows nothing about `.hamilton/`; `sdd` drives
  `plan.md`. Shipping both proves the extensibility seam on day one rather than discovering its
  shape after one loop.
- **Effect is a constraint, not the destination.** This effort is the first province of a later
  move away from Effect-TS. The loop subsystem takes no Effect dependency; a deliberately thin
  adapter at the `@effect/cli` `Command` registration seam is the only exception. The Effect
  surface stops growing here — unwinding it is a separate effort (Out of scope).

**This is a CLI identity shift.** `hamilton` is currently a template installer with one subcommand
whose only job is copying files. The loop makes it a tool that spawns and supervises long-running
processes. The `hamilton-wayfinder` map ruled a maps CLI surface out of scope partly on the
grounds that "`hamilton` is a template-installer with one subcommand" — that premise ends here,
deliberately. Ticket 12 carries the documentation consequence.

**Ralph's load-bearing property is fresh context per iteration.** Progress accumulates in files and
git, never in a context window. Any decision that reintroduces cross-iteration context sharing —
in-session subagents, resumed conversations, compaction — breaks the technique and needs to be
argued explicitly. See [ghuntley.com/ralph](https://ghuntley.com/ralph/).

**`hamilton-orchestrate` already loops.** It runs code + review over every plan task *in one
session* using subagents, which shares context and compacts. The `sdd` topology is the
process-level, fresh-context alternative. The two need a stated boundary (ticket 07) or they will
drift into confusing overlap.

**Skills every session should consult:** `hamilton-grilling` for the decision tickets;
`hamilton-wayfinder-domain-modeling` alongside it, against [`glossary.md`](glossary.md).

## Decisions so far

- [Does LangGraph.js survive `bun build --compile`?](tickets/01-langgraph-under-bun-compile.md) —
  **Yes, adopt it.** A cyclic `StateGraph` compiles and runs with no `bun`/`node` on `PATH`, at
  **+597 KB (0.9%)** over the 62 MB baseline, with no Bun-specific hazard in the core tree
  (`AsyncLocalStorage` verified fine). **But the official SQLite checkpointer is unusable** — it
  binds to `better-sqlite3`, which fails under plain `bun run`, not merely under `--compile`; the
  upstream Bun issue has been open since 2023 and no fix should be planned around. Workaround
  validated: `bun:sqlite` is in the runtime and `BaseCheckpointSaver` is subclassable, so Hamilton
  writes its own `BunSqliteSaver`. Cross-process concurrent reads work under WAL but are
  **undocumented upstream**. Observation needs a checkpointer; execution does not — so Hamilton's
  own status file stays a live option for ticket 03. Risks accepted: no Bun job in LangGraph's CI
  at all (Hamilton owns its own compile smoke test), a custom checkpointer to maintain, and
  macOS arm64 as the only tested platform.

## Not yet specified

- **Testing a process-spawning subsystem at the integration level.** Ticket 11 covers the strategy;
  what remains foggy is whether the loop needs a fake kernel binary committed to the repo, and
  whether any test may spawn a real agent. Depends on the kernel seam (02).
- **Cost and token observability.** Whether a run records spend per iteration, and whether that is
  even knowable across heterogeneous external kernels. Hangs on the kernel seam (02) — some agent
  CLIs report usage, some do not.
- **Concurrency.** More than one loop running at once, in the same repo or across repos: locking,
  run-id collision, whether a second `hamilton loop` in a dirty worktree is refused. Hangs on the
  run directory layout (03).
- **User-authored topologies.** Whether third parties can register a topology, or whether the
  bundled set is closed in v1. Hangs on how topologies are defined and discovered (08).
- **`hamilton-orchestrate`'s fate.** If the `sdd` topology is strictly better on the property that
  matters, orchestrate may deserve deprecation rather than coexistence. Cannot be stated sharply
  until 07 fixes the boundary.

## Out of scope

- **Internal agent kernel.** A Hamilton-owned LangGraph agent with its own tools, permission
  gating, diff application, and model routing. That is building a coding agent — larger than
  everything on this map combined. Ruled out at charting (2026-08-13). The kernel seam survives so
  it can land as its own effort later; the fresh-context guarantee stays delegated to external
  agents until then.
- **Mastra.** Considered as orchestrator and as internal kernel, rejected on both counts during
  charting. Recorded so a future session does not reopen it without new evidence.
- **The Effect-TS migration proper.** Replacing `@effect/cli`, unwinding `Effect.gen` from
  `setup.ts`, and removing `Data.TaggedError` as the mandated error model. This map only
  establishes that new subsystems do not take an Effect dependency. Choosing a CLI framework under
  pressure from a feature deadline is the wrong condition for a decision touching every command
  Hamilton will ever have.
