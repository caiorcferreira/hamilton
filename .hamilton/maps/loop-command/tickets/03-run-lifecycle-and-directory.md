---
type: grilling
status: open
blocked_by: []
---

# Run lifecycle and the run directory

## Question

`hamilton loop status` runs in a different process from the loop it reports on. Everything they
share must be on disk. Fix that representation.

- **Run identity.** What is a run id — a ULID, a timestamp slug, a user-supplied name? Is it unique
  per machine or per repository?
- **Location.** Does the run directory live under `~/.hamilton/runs/<id>/` (global, survives repo
  deletion, one place to list everything) or `.hamilton/runs/<id>/` (per-repo, but then it needs
  gitignoring and a dirty worktree fights the loop's own commits)? Charting leaned global; confirm
  or overturn.
- **Contents.** Status, supervising pid, per-iteration logs — what exactly, in what format? Is
  status a JSON file the supervisor rewrites, an append-only event log, or the LangGraph
  checkpointer's own store queried by `thread_id`? Note that using the checkpointer as the sole
  status source ties `status` to LangGraph's schema.
- **Does `status` read from the checkpointer or from the run directory?** Narrowed by
  [ticket 01](01-langgraph-under-bun-compile.md) and the standing decision that follows it. A
  `BunSqliteSaver` **is being built regardless** — it exists for LangGraph durability (graph resume,
  `interrupt()` gates), not for status — so this ticket does not decide whether a checkpointer
  exists, only whether `status` reads from it. Three established facts bear on that: (a)
  `getState`/`getStateHistory` require a checkpointer, but that constrains only *LangGraph's* state
  observation, not Hamilton's; (b) the run directory exists regardless for pidfile, liveness and
  logs, so a checkpointer-backed `status` means **two stores holding overlapping truth** — name the
  failure mode where they disagree after a crash, and which is authoritative; (c) cross-process
  concurrent reads under WAL work empirically but are **entirely undocumented upstream**, so
  checkpointer-backed `status` rests on unguaranteed behaviour while an own-status-file design
  rests on Hamilton's own format.
- **Detachment.** How does the loop get into the background — detached spawn with `unref()`, a
  double fork, or a foreground default with an explicit `--detach`? Does the parent wait long
  enough to report a startup failure, or does it return immediately and leave failures to `status`?
- **Liveness.** A status file can say `running` while the process is dead. Is liveness
  `process.kill(pid, 0)`, a heartbeat timestamp the supervisor refreshes, or both? What does
  `status` report for a run whose pid is gone but whose status file says `running` — `crashed`, or
  `unknown`?
- **Retention.** Do finished runs' directories persist forever? Is there a prune, a cap, a TTL?
- **stdout/stderr.** Where does a detached supervisor's own output go, distinct from per-iteration
  kernel logs?

## Answer

## Outdated decisions
