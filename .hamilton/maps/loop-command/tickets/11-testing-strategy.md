---
type: grilling
status: open
blocked_by: ["02", "03"]
---

# Testing a process-spawning subsystem

## Question

`AGENTS.md` is unusually specific about testing: vitest with `globals: false`, **no mocking
libraries**, real temp dirs via `node:os.tmpdir()`, and home-directory override by setting
`process.env.HOME`. A subsystem whose core behaviour is "spawn a detached process, supervise it,
signal it" is awkward under every one of those constraints.

- **What stands in for a kernel.** With no mocking libraries, a fake kernel has to be a real
  executable. A committed shell script? A generated one written into a temp dir per test? A
  `node`/`bun` script? It needs to be able to simulate: success, non-zero exit, hanging until
  signalled, writing files, and slow output.
- **Detached processes in tests.** Can a test spawn a genuinely detached supervisor and reliably
  clean it up, or does the loop need a testable non-detached path? If the latter, detachment itself
  goes untested — is that acceptable, and what covers it instead?
- **Signal tests.** Verifying SIGTERM handling, grace periods, and SIGKILL escalation means tests
  that wait on real timers. What are the timeouts, and how is flakiness bounded?
- **Gate commands.** Gates are shell commands. Do tests run real ones (`true`, `false`, `sleep`),
  and does that hold on every platform in the release matrix?
- **What is not unit-tested.** Some of this may only be coverable by an end-to-end test that runs a
  real loop against a real agent CLI — expensive, non-deterministic, and not runnable in CI.
  Decide explicitly what is left uncovered rather than discovering it later.
- **A compile-and-run smoke test in CI — newly required.**
  [Ticket 01](01-langgraph-under-bun-compile.md) established that
  `langchain-ai/langgraphjs` has **no Bun job in CI at all**, and `langchain-ai/langchainjs` tests
  `bun run` but never `bun build --compile`. Nothing upstream will catch a regression in the exact
  configuration Hamilton depends on, so Hamilton must own that check. Decide: does CI compile a
  binary and execute it on every release build, or on every commit? Does it run on all four
  release targets or only one? And does it assert on the `BunSqliteSaver` too, given that a
  hand-written checkpointer tracking `BaseCheckpointSaver` across LangGraph minor versions is the
  most likely thing to break silently?
- **Does the home-override pattern still work?** Existing tests set `process.env.HOME` to a temp
  dir. If run directories live under `~/.hamilton/runs/` (ticket 03), that pattern extends
  naturally — confirm it survives detached children, which inherit the environment but may resolve
  home differently.

## Answer

## Outdated decisions
