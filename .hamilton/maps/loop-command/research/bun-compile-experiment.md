# LangGraph.js under `bun build --compile` — direct experiment

Findings for [ticket 01](../tickets/01-langgraph-under-bun-compile.md), questions 1–3 and the
concurrency half of question 5. Companion file [`langgraph-bun-compat.md`](langgraph-bun-compat.md)
covers the source-derived questions (4, and the documented half of 5).

These are **measured results**, not documentation claims. Every number below came from running the
commands recorded here.

## Environment

| | |
|---|---|
| Bun | 1.3.14 |
| Platform | Darwin arm64 (macOS, Apple Silicon) |
| `@langchain/langgraph` | 1.4.9 |
| `@langchain/core` | 1.2.7 |
| `@langchain/langgraph-checkpoint-sqlite` | 1.0.3 |
| Hamilton baseline | `src/cli/main.ts`, 4 pinned runtime deps |

**Caveat:** every result is from macOS arm64 only. The release matrix also covers macOS x64, Linux
x64, and Linux arm64. Nothing here is architecture-specific in an obvious way, but the Linux
targets are **not established** by this experiment.

## Summary

1. **LangGraph itself compiles and runs standalone.** A `StateGraph` with conditional-edge looping
   compiles under `bun build --compile` and runs correctly with neither `bun` nor `node` on `PATH`.
2. **The official SQLite checkpointer is unusable on Bun — at all.** It depends on
   `better-sqlite3`, a native module Bun does not support. This fails *interpreted*, so it is not a
   `--compile` problem and no bundler flag fixes it.
3. **The failure is isolated to that one package.** `MemorySaver` compiles and runs standalone with
   `getState` and `getStateHistory` both working, so the checkpointer interface and the graph state
   machinery are fine.
4. **The workaround is clean and validated.** `bun:sqlite` is built into the runtime, compiles to
   1 module, and `BaseCheckpointSaver` is a subclassable exported class. A hand-written
   `BunSqliteSaver` is the path.
5. **Cross-process concurrent reads work.** With WAL enabled, a separate process read a live,
   actively-written database three times and saw monotonically increasing state, with no lock errors.
6. **Size cost is negligible: +597 KB** (0.9%) on a 62 MB baseline. The Bun runtime dominates.

## Q1 — Does a trivial LangGraph program compile and run standalone?

**Yes.**

Test graph: `StateGraph` with two nodes (`iterate`, `gate`), a `START` edge, and an
`addConditionalEdges` loop back to `iterate` until `iteration >= 3` — deliberately exercising the
cyclic branching that is the reason LangGraph is in the stack at all, not just an import smoke test.

```
bun build --compile graph.ts --outfile graph-bin
  [30ms]  bundle  534 modules
 [139ms] compile  graph-bin
```

Run with a scrubbed environment (`env -i PATH=/usr/bin:/bin`, verified that `command -v bun` and
`command -v node` both report not found):

```
ITERATIONS: 3
LOG: ["iteration 1","gate after 1","iteration 2","gate after 2","iteration 3","gate after 3"]
OK
```

Exit code 0. The conditional loop executed the correct number of times, so this is real execution,
not a successful import.

## Q2 — Does the SQLite checkpointer survive compilation?

**No — and worse than the ticket assumed.** It does not work under Bun *at all*, compiled or not.

`@langchain/langgraph-checkpoint-sqlite@1.0.3` declares:

```
dependencies    = { 'better-sqlite3': '^12.10.0' }
peerDependencies = { '@langchain/core': '^1.1.44',
                     '@langchain/langgraph-checkpoint': '^1.0.0' }
```

So it binds to **`better-sqlite3`** — a native module — not `node:sqlite` and not `bun:sqlite`.
Running `SqliteSaver.fromConnString(path)` under plain `bun run`, before any compilation:

```
error: 'better-sqlite3' is not yet supported in Bun.
Track the status in https://github.com/oven-sh/bun/issues/4290
In the meantime, you could try bun:sqlite which has a similar API.
 code: "ERR_DLOPEN_FAILED"
  at new Database (better-sqlite3/lib/database.js:48:29)
  at fromConnString (@langchain/langgraph-checkpoint-sqlite/dist/index.js:59:26)
```

This matters more than a compile failure would: it is a **runtime** incompatibility with Bun
itself, so there is no bundler flag, external-module escape hatch, or lazy-import trick that
recovers it. Bun's own error message points at `bun:sqlite`.

### The failure is isolated, not systemic

`MemorySaver` — same checkpointer interface, no native dependency — compiled and ran standalone:

```
iterations: 3
getState: 3
history entries: 5
OK
```

`getState` and `getStateHistory` both work in a compiled binary. So checkpointing as a mechanism is
fine under `--compile`; only the `better-sqlite3` binding is broken.

### The workaround, validated

Two facts establish the path:

- **`bun:sqlite` compiles.** A program importing `Database` from `bun:sqlite` bundled to **1
  module** — it is part of the runtime, not a dependency — and ran standalone with no `bun` on
  `PATH`, writing and reading a WAL-mode database.
- **`BaseCheckpointSaver` is subclassable.** Imported from `@langchain/langgraph-checkpoint` and
  compiled, it reports `typeof === "function"` with prototype members
  `constructor, get, getDeltaChannelHistory, getNextVersion, toJSON`.

So a hand-written `BunSqliteSaver extends BaseCheckpointSaver` backed by `bun:sqlite` is viable.
**Not established:** the full method surface a correct implementation must provide, and how stable
that surface is across LangGraph minor versions. That is an implementation risk, not a blocker, and
belongs to whichever route unit builds it.

## Q3 — What does the tree cost?

**Dependency count.** `bun add @langchain/langgraph @langchain/core` installed **22 packages**.
Direct dependencies of `@langchain/langgraph@1.4.9`:

```
'@langchain/protocol':          '^0.0.18'
'@standard-schema/spec':        '1.1.0'
'@langchain/langgraph-sdk':     '~1.9.28'
'@langchain/langgraph-checkpoint': '^1.1.3'
```

Adding `@langchain/langgraph-checkpoint-sqlite` took the tree to 38 packages (+16, mostly
`better-sqlite3`'s build chain) — **avoided entirely** by the `bun:sqlite` workaround, which is a
second, independent reason to prefer it.

Note `@langchain/protocol` is at `^0.0.18`, a pre-1.0 version pulled in by a 1.x package.

**Binary size.**

| Binary | Bytes | Modules |
|---|---|---|
| Hamilton baseline (`src/cli/main.ts`) | 65,064,290 | 747 |
| LangGraph test graph | 65,675,234 | 534 |
| LangGraph + `MemorySaver` | 65,675,234 | 534 |
| `bun:sqlite` only | 63,446,114 | 1 |

**Delta: +610,944 bytes ≈ 597 KB, a 0.9% increase** on a 62 MB baseline. The Bun runtime is ~62 MB
of every binary, so LangGraph is noise against it. Module count *dropped* versus baseline because
these test programs don't import `@effect/cli`.

Size is not an argument against adopting LangGraph.

## Q5 (concurrency half) — Can a second process read while a writer holds the database?

**Yes, with WAL enabled.**

Setup: a compiled binary writing 40 rows at 100 ms intervals (~4 s) to a WAL-mode
`bun:sqlite` database, with three separate compiled processes reading during the write.

```
writer pid 89491, writing 40 rows over ~4s
read #1 while writer alive: READ rows: 18 {"seq":18,...}
read #2 while writer alive: READ rows: 25 {"seq":25,...}
read #3 while writer alive: READ rows: 33 {"seq":33,...}
writer finished: HOLD done / OK
```

Monotonically increasing counts, no `SQLITE_BUSY`, no lock errors, writer completed normally. Every
process was a standalone binary run with `env -i PATH=/usr/bin:/bin`.

This is the mechanism `hamilton loop status` needs, demonstrated end to end.

**Scope limit:** this tested raw `bun:sqlite` with a hand-rolled schema, **not** a LangGraph
checkpointer implementation. It proves the storage layer supports the access pattern; it does not
prove a `BunSqliteSaver` will. It also does not test two concurrent *writers*, which is a different
question and only arises if concurrent runs share a store (map fog, ticket 03).

## Reproduction

```bash
mkdir -p /tmp/lg-exp/proj && cd /tmp/lg-exp/proj
bun add @langchain/langgraph @langchain/core
bun build --compile graph.ts --outfile /tmp/lg-exp/graph-bin
env -i PATH=/usr/bin:/bin HOME=/tmp/fakehome /tmp/lg-exp/graph-bin
```
