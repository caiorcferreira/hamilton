# Working glossary — loop command

The effort's in-progress language. Terms here are **provisional** until a ticket resolves them;
each entry names the ticket that will fix it, or the charting session that proposed it. Resolved
terms fold into the canonical `.hamilton/specs/glossary.md` as a closing act, before `route.md` is
written.

## The loop

**loop run** — One invocation of `hamilton loop`: a topology, a kernel, a working directory, and a
lifecycle that outlives the invoking shell. A run has an identity that survives process exit, so a
later `status` or `kill` in a different process can name it. *Provisional — fixed by ticket 03.*

**iteration** — One pass of a topology, ending in a fresh agent process exiting. Ralph's
load-bearing property is that iterations share no context: everything one iteration learns reaches
the next through files and git, never through a context window. An iteration that resumed a
conversation would not be an iteration in this sense.
([ghuntley.com/ralph](https://ghuntley.com/ralph/), charting 2026-08-13)

**topology** — The graph shape of a loop: what an iteration does, in what order, with what
branching, and when the loop stops. Topologies are code, not configuration — that distinction is
the reason LangGraph is in the stack rather than a config parser. v1 ships two: `ralph` and `sdd`.
*Provisional — fixed by ticket 08.*

**gate** — A check run between iterations that rejects unacceptable work: tests, typecheck, lint,
build. Huntley's "backpressure". A gate's failure is a signal to the topology, not necessarily a
reason to stop the run. *Provisional — fixed by tickets 05 and 06.*

## Execution

**kernel** — The interchangeable thing that executes one iteration's agent invocation. Borrowed
from Jupyter's sense: a swappable execution backend behind a stable seam. A kernel receives a
prompt and a working directory and produces an exit status; everything about *how* it does the work
— its tools, permissions, file editing, model — belongs to the kernel, not to Hamilton. v1 ships
external subprocess kernels only. *Provisional — fixed by ticket 02.*

**external kernel** — A kernel that shells out to a coding-agent CLI (`claude -p`, `opencode run`).
Brings its own tools, permission model, and git handling. Fresh context is structural: it is a new
process every time.

**internal kernel** — A kernel Hamilton itself implements, owning tools and model routing. Ruled
out of scope at charting; the term is defined so the seam has a name for the side it does not yet
implement.

**run directory** — The on-disk home of a loop run's state, and the reason `status` and `kill` work
across process boundaries. Holds at minimum the run's status, the supervising process's identity,
and per-iteration logs. *Provisional — fixed by ticket 03.*

**checkpointer** — LangGraph's own persistence of graph state, keyed by `thread_id`. A graph runs
without one but cannot be *observed* without one: `getState` and `getStateHistory` throw
`MISSING_CHECKPOINTER`. It is therefore LangGraph's answer to observability, not necessarily
Hamilton's — a run directory could carry status independently, and whether the loop has one store
or two is open. Hamilton cannot use the official SQLite checkpointer, because it binds to
`better-sqlite3`, which does not run under Bun; a `BunSqliteSaver` extending `BaseCheckpointSaver`
over `bun:sqlite` is the validated substitute.
([Does LangGraph.js survive `bun build --compile`?](tickets/01-langgraph-under-bun-compile.md))

**`BunSqliteSaver`** — Hamilton's own checkpointer: a `BaseCheckpointSaver` subclass backed by
`bun:sqlite`, replacing the official SQLite checkpointer that cannot load under Bun. **Decided, and
unconditional** — it exists so LangGraph graphs are durable (resumable after a crash, and able to
carry `interrupt()` gates), independently of how `hamilton loop status` is implemented. Two
constraints on its design are already known: initialization must be separated from reading, because
the official saver's `setup()` runs on the read path and so fails `SQLITE_READONLY` against a cold
database; and it needs WAL enabled, which is what makes cross-process reads work.
(Standing decision 2026-08-15; evidence in
[ticket 01](tickets/01-langgraph-under-bun-compile.md))
