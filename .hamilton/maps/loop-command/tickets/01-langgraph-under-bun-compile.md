---
type: research
status: resolved
blocked_by: []
---

# Does LangGraph.js survive `bun build --compile`?

## Question

Hamilton's `cli-distribution` capability spec requires four standalone binaries (macOS x64/arm64,
Linux x64/arm64), each of which must "start and execute commands normally" on a machine with no
`bun`, `node`, or source checkout present. Hamilton currently has four pinned runtime dependencies.
`@langchain/langgraph` pulls in `@langchain/core` and its tree.

Establish, from primary sources and by direct experiment:

1. Does a trivial program importing `@langchain/langgraph` and compiling a `StateGraph` build
   successfully under `bun build --compile`, and run on a machine without bun?
2. Does the SQLite checkpointer (`@langchain/langgraph-checkpoint-sqlite` or current equivalent)
   survive compilation? Native modules and dynamic `require` are the usual failure modes — does it
   bind to `better-sqlite3`, `node:sqlite`, or `bun:sqlite`?
3. What does the tree cost — dependency count, and resulting binary size delta against the current
   four-dep baseline?
4. Are there known incompatibilities between LangChain packages and the Bun runtime specifically
   (not just Node), e.g. around `AsyncLocalStorage`, dynamic imports, or `process.versions` sniffing?
5. Does LangGraph require a `thread_id`-keyed checkpointer to be readable by a *second process*
   concurrently, and does the SQLite checkpointer support concurrent readers while a writer holds
   the run? (Bears directly on ticket 03.)

If compilation fails, report what specifically breaks and whether a workaround exists (external
module, bundled sidecar, lazy import). A negative result reshapes the map: the topology layer would
need a different home, and the "loops are topologies, not config" standing decision would come back
into question.

## Answer

**Verdict: LangGraph.js is viable under `bun build --compile`. Adopt it — and write a
`bun:sqlite`-backed checkpointer instead of using the official SQLite one.**

Findings at [`research/bun-compile-experiment.md`](../research/bun-compile-experiment.md) (direct
experiment: Q1–Q3 and the concurrency half of Q5) and
[`research/langgraph-bun-compat.md`](../research/langgraph-bun-compat.md) (primary sources: Q4 and
the documented half of Q5).

### What was established

**1. LangGraph itself compiles and runs standalone (Q1).** A `StateGraph` exercising
`addConditionalEdges` cyclic looping — not a bare import — compiled under `bun build --compile`
(534 modules, no warnings) and ran correctly with `bun` and `node` both verifiably absent from
`PATH`. Confirmed independently by both investigations.

**2. The official SQLite checkpointer is unusable, and the failure is worse than "doesn't compile"
(Q2).** `@langchain/langgraph-checkpoint-sqlite@1.0.3` depends on `better-sqlite3 ^12.10.0`, a
native module. It fails under plain `bun run` with `ERR_DLOPEN_FAILED: 'better-sqlite3' is not yet
supported in Bun`. Because it is a *runtime* incompatibility rather than a bundling one, no
bundler flag, external-module escape, or lazy import recovers it. Tracking issue
[oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290) has been **open since 2023-08-24**
with `better-sqlite3` still unchecked; the proposed `bun:sqlite` shim (bun#36712) is open and
unmerged. Do not plan around an upstream fix.

**3. The failure is isolated to that one package, and the workaround is validated.** `MemorySaver`
compiled and ran standalone with `getState` and `getStateHistory` both working, so the checkpointer
interface and graph state machinery are fine under `--compile`. `bun:sqlite` is built into the
runtime (bundles to **1 module**), and `BaseCheckpointSaver` is an exported, subclassable class
(prototype: `constructor, get, getDeltaChannelHistory, getNextVersion, toJSON`). A hand-written
`BunSqliteSaver` is the path, and it also drops 16 packages that `better-sqlite3`'s build chain
would have added.

**4. Size cost is negligible (Q3).** 22 packages for `@langchain/langgraph` + `@langchain/core`.
Binary grows from 65,064,290 to 65,675,234 bytes — **+597 KB, 0.9%** on a 62 MB baseline, since the
Bun runtime dominates. Size is not an argument against adoption. Note `@langchain/protocol` sits at
`^0.0.18`, a pre-1.0 package pulled in by a 1.x release.

**5. No Bun-specific incompatibility in the core tree (Q4).** `AsyncLocalStorage` — the most
plausible hazard — is a non-issue: Bun 1.3.14 implements the full prototype including
`snapshot`/`bind`, LangGraph imports it statically (so it is statically bundleable), and the
singleton-initializing side effect survives `--compile`, verified with a nested-subgraph test where
the inner graph inherits `thread_id` only via ALS. No `createRequire` in langchainjs source.
`process.versions.node` is sniffed in exactly one place; Bun reports `24.3.0`, so `isNode()`
returns true — a telemetry mislabel, not a bug.

**6. Observation requires a checkpointer; execution does not (Q5).** `invoke` runs fine without
one, but `getState`/`getStateHistory` throw `GraphValueError: No checkpointer set`
(`MISSING_CHECKPOINTER`). Verified directly. **This does not force the checkpointer into
`hamilton loop status`** — it only means *LangGraph's own* state observation needs one. Hamilton
writing its own status file remains fully open, and is now a live decision for ticket 03.

**7. Cross-process concurrent reads work (Q5).** Three separate compiled processes read a live
WAL-mode `bun:sqlite` database while a writer held it, seeing monotonically increasing state, no
`SQLITE_BUSY`, writer completing normally. Independently reproduced against the official
`SqliteSaver` under Node. **LangGraph's docs are entirely silent** on concurrency, multi-process
access, WAL, and locking — this is empirical, not documented, and carries no upstream guarantee.

### Risks accepted by adopting

- **Hamilton is off the upstream tested path.** `langchain-ai/langgraphjs` has **no Bun job in CI
  at all**; `langchain-ai/langchainjs` runs an `oven/bun` job but tests `bun run`, never
  `bun build --compile`. Nothing upstream will catch a regression in the exact configuration
  Hamilton depends on. **Hamilton must own a compile-and-run smoke test in its own CI** — recorded
  against ticket 11.
- **The custom checkpointer is a maintenance burden**, tracking `BaseCheckpointSaver` across
  LangGraph minor versions. An official conformance harness exists to test against.
- **A design trap for that checkpointer:** the official `SqliteSaver.setup()` runs on the *read*
  path too (issuing pragmas and `CREATE TABLE`), so a read-only reader fails `SQLITE_READONLY`
  against a cold database. A `BunSqliteSaver` should separate initialization from reading.
- **macOS arm64 only.** Linux x64/arm64 and macOS x64 from the release matrix are **not
  established**.
- **One unresolved upstream report:** [bun#31586](https://github.com/oven-sh/bun/issues/31586)
  (2026-05-29), a zod-deduplication crash involving `@langchain/core`, auto-closed `not_planned` by
  bots without human judgement. Flagged rather than dismissed.

### What this does not change

The map's standing decisions survive intact. LangGraph stays the orchestration layer, "loops are
topologies, not config" holds, and the daemon layer is still Hamilton's to build — reinforced,
since the checkpointer is now something Hamilton partly implements.

## Outdated decisions
