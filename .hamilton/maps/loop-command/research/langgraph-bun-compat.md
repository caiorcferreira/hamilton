# LangGraph.js under Bun — runtime compatibility and cross-process checkpointer reads

Research for ticket `01-langgraph-under-bun-compile.md`, sub-questions 4 and 5.
Investigated 2026-08-13. Primary sources only: official docs, GitHub source and issues, npm registry
metadata, plus direct execution against the real runtimes on this machine.

**Local versions used for the direct-execution checks:** Bun 1.3.14 (macOS arm64),
Node v24.11.0, `@langchain/langgraph` 1.4.9, `@langchain/core` 1.2.7,
`@langchain/langgraph-checkpoint-sqlite` 1.0.3, `better-sqlite3` 12.11.1.

---

## Summary

- **The LangGraph core tree works under Bun, and survives `bun build --compile`.** A `StateGraph`
  with `MemorySaver`, `invoke`, `getState`, `getStateHistory`, and nested-subgraph context
  propagation produced byte-identical output under `bun run`, a `bun build --compile` binary run
  with a cleared environment, and Node 24. 534 modules bundled, no build warnings, 66 MB binary.
- **`AsyncLocalStorage` is not the problem.** Bun 1.3.14 implements the full `AsyncLocalStorage`
  prototype surface plus `snapshot`/`bind`, LangGraph's static `import { AsyncLocalStorage } from
  "node:async_hooks"` is statically resolvable by the bundler, and the entrypoint side-effect that
  initializes the singleton survives `--compile`.
- **The SQLite checkpointer is the hard blocker.** `@langchain/langgraph-checkpoint-sqlite` 1.0.3
  depends on `better-sqlite3` ^12.10.0 — a V8-C++-API native addon that **Bun cannot load at all**.
  Bun throws `ERR_DLOPEN_FAILED: 'better-sqlite3' is not yet supported in Bun` and points at
  tracking issue oven-sh/bun#4290, which is **still open** with `better-sqlite3` unchecked. This is
  a runtime failure, not just a `--compile` failure. There is no `node:sqlite` or `bun:sqlite`
  binding in the official package.
- **A checkpointer is mandatory for anything `thread_id`-shaped.** Without one the graph still
  runs, but `getState`/`getStateHistory`/`updateState` throw
  `GraphValueError("No checkpointer set")` with `lc_error_code: MISSING_CHECKPOINTER`.
- **Cross-process reads work in practice but are entirely undocumented.** LangGraph's own docs say
  nothing about concurrency, multiple processes, WAL, or locking. Empirically a second OS process
  read live-advancing `getState`/`getStateHistory` from the same file while a first process wrote,
  with no `SQLITE_BUSY` — because `SqliteSaver.setup()` sets `journal_mode=WAL`. But the reader path
  is **not** read-only-safe on a cold database.

---

## Q4 — Known LangChain/LangGraph incompatibilities with the Bun runtime

### Q4.1 — Bun is a CI-tested environment for LangChain.js, but not for LangGraph.js

`langchain-ai/langchainjs` runs a dedicated `exports-bun` CI job on every PR touching
`libs/langchain`, `libs/langchain-core`, `libs/langchain-classic`, or the OpenAI/Anthropic
providers. It runs the `oven/bun` Docker image against ESM, CJS, `require` from CJS, all
entrypoints, and TypeScript.
Source: [`.github/workflows/test-exports.yml`, job `exports-bun`](https://github.com/langchain-ai/langchainjs/blob/main/.github/workflows/test-exports.yml)
and [`environment_tests/docker-compose.yml` (`image: oven/bun`)](https://github.com/langchain-ai/langchainjs/blob/main/environment_tests/docker-compose.yml).
The test scripts are `bun src/index.js`, `bun src/require.cjs`, `bun src/entrypoints.js`, etc.
Source: [`environment_tests/test-exports-bun/package.json`](https://github.com/langchain-ai/langchainjs/blob/main/environment_tests/test-exports-bun/package.json).

Note the scope: this tests **running under `bun`**, not `bun build --compile`. Nothing in
langchainjs CI compiles a standalone binary.

`langchain-ai/langgraphjs` has **no Bun environment test.** Its environment-test matrix is
esbuild, esm, cjs, cloudflare, vercel, vite, tsc — no bun, no deno.
Source: [`.github/workflows/test-exports.yml`](https://github.com/langchain-ai/langgraphjs/blob/main/.github/workflows/test-exports.yml)
and [`internal/environment_tests/`](https://github.com/langchain-ai/langgraphjs/tree/main/internal/environment_tests).
No workflow file in that repo mentions `bun` or `deno` at all.

### Q4.2 — Zero open Bun-related issues in either repo

- `langchain-ai/langgraphjs`: **no issue or PR mentions Bun** in a substantive way. A search of all
  issue bodies for "bun" returns 15 hits, all of which are incidental (e.g. "ubuntu-latest",
  dependency bumps). No issue titled or scoped to Bun exists.
  Source: GitHub issue search `repo:langchain-ai/langgraphjs bun in:title` → 0 results.
- `langchain-ai/langchainjs`: exactly two Bun-titled issues exist, **both closed**, and
  `state:open` count for `bun in:title` is **0**.
  Source: GitHub issue search `repo:langchain-ai/langchainjs bun in:title state:open` → 0 results.

### Q4.3 — `bun build --compile` + LangChain: the one confirmed historical breakage, fixed in Bun 1.1.30

[langchainjs#4602, "Possible circular dependencies breaking from building binaries with Bun"](https://github.com/langchain-ai/langchainjs/issues/4602)
— opened 2024-03-03, **closed 2024-10-11 as completed**. `bun build --compile` of a program
importing `langchain` produced a binary that crashed at startup with
`ReferenceError: Cannot access uninitialized variable` at
`node_modules/@langchain/core/dist/prompts/string.js` — a module-initialization-order failure on a
circular dependency inside `@langchain/core`. The same class of error also reproduced under plain
`bun build --target=node` and then Node (`Cannot access 'BasePromptTemplate' before initialization`),
so it was a bundler-emit-order bug, not a Bun-runtime bug.

Resolution, verbatim from the thread: a reporter stated it "seems to be solved with the latest
version of Bun (1.1.30), was using 1.1.3 previously"; maintainer `jacoblee93` closed it, adding
"We also cleaned up a few dependencies recently so may have been fixed by that."
**Caveat:** the fix was never bisected or verified by a maintainer — the issue was closed on a
single user's report. The same thread records that LangChain had earlier **disabled** its Bun CI job
("stopped the Bun CI test due to some issues", jacoblee93, 2024-03-04); it is enabled again today
(Q4.1).

### Q4.4 — A more recent, disputed `bun build` + `@langchain/core` report (zod dedup)

[oven-sh/bun#31586](https://github.com/oven-sh/bun/issues/31586) — opened 2026-05-29 against Bun
1.3.14, **closed the same day as `not_planned`**. Claim: `bun build` fails to deduplicate Zod v4
modules reached via two subpaths (`zod` and `zod/v4/core`), and in a large real graph including
`@langchain/core` the emit order inverts and the bundle crashes with
`TypeError: undefined is not a constructor` inside `zod/v4/core/api.js`. This is the same
initialization-order failure mode as #4602.

The issue was closed by automated triage, not a human: a dedupe bot flagged it against #13092 /
#11785 / #9360, and the `robobun` bot posted a non-reproduction on 1.3.14 and 1.4.0-main, arguing
the reporter's `grep -c` was counting a repeated source-path comment rather than a duplicated
module. **Not established:** whether the reported runtime crash is real. The issue is closed
`not_planned` with no human maintainer judgement on record, and no linked fix.

Relevance to Hamilton: `@langchain/langgraph` 1.4.9 declares a peer dependency on
`zod ^3.25.32 || ^4.2.0` and `@langchain/core` 1.2.7 depends on `zod ^3.25.76 || ^4`
([npm registry](https://registry.npmjs.org/@langchain/langgraph),
[npm registry](https://registry.npmjs.org/@langchain/core)), so the zod-dedup path is on the table
for any graph that also pulls zod directly.

### Q4.5 — `AsyncLocalStorage`: how LangGraph uses it, and whether Bun's implementation is complete

**How it is imported.** `@langchain/langgraph`'s Node entrypoint performs a *static* import and a
module-level side effect:

```ts
// libs/langgraph-core/src/node.ts
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { AsyncLocalStorage } from "node:async_hooks";

export function initializeAsyncLocalStorageSingleton() {
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
}
```
Source: [`libs/langgraph-core/src/node.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/node.ts).
It is invoked at import time from the entrypoint, guarded by the `__LC_ALLOW_ENTRYPOINT_SIDE_EFFECTS__`
marker: [`libs/langgraph-core/src/index.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/index.ts).

This is good news for bundling: it is a **static, literal specifier**, statically resolvable by any
bundler. There is no dynamic `import()` of `node:async_hooks` in the shipped Node path.

A PR proposing to replace it with lazy `process.getBuiltinModule` / dynamic `import()` resolution —
[langgraphjs#2163, "fix(core): load async_hooks conditionally"](https://github.com/langchain-ai/langgraphjs/pull/2163),
opened 2026-03-10 — was **closed unmerged**. Current `main` still uses the static import.

**How it is consumed.** The ambient config is read through
`AsyncLocalStorageProviderSingleton.getRunnableConfig()` at
[`libs/langgraph-core/src/pregel/utils/config.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/utils/config.ts),
which is how a nested graph/tool invocation inherits `thread_id` and tracing context without an
explicit config argument. Historically this has been the fragile spot: bundlers dropping the
entrypoint side effect ([langgraphjs#278](https://github.com/langchain-ai/langgraphjs/pull/278),
merged 2024-07-23) and singleton leakage across concurrent invocations
([langgraphjs#1538](https://github.com/langchain-ai/langgraphjs/issues/1538),
[#2040](https://github.com/langchain-ai/langgraphjs/issues/2040), fixed by
[#2552](https://github.com/langchain-ai/langgraphjs/pull/2552), 2026-06-17). None of these are
Bun-specific.

**Bun's implementation.** Direct probe on Bun 1.3.14:

```
process.versions.node = 24.3.0        process.versions.bun = 1.3.14
AsyncLocalStorage.prototype: constructor, enterWith, exit, run, disable, getStore, _enable, _propagate
AsyncLocalStorage statics:   bind, snapshot
async_hooks.AsyncResource:   function      async_hooks.createHook: function
```
The full documented Node surface is present. **Confirmed working, not broken.**

**Direct behavioural verification.** A nested-subgraph program in which an inner compiled graph is
invoked with *no explicit config* — so it must inherit the thread through `AsyncLocalStorage` —
produced identical results under all three:

| | `bun run` | `bun build --compile` binary (`env -i`) | `node` |
|---|---|---|---|
| result | `{"out":"outer\|inner"}` | `{"out":"outer\|inner"}` | `{"out":"outer\|inner"}` |
| `getStateHistory` | `["outer\|inner","",""]` | `["outer\|inner","",""]` | `["outer\|inner","",""]` |

The compiled binary was run with a cleared environment (`env -i`), confirming the entrypoint
side-effect initialization survives `--compile` and is not dropped by tree-shaking.

### Q4.6 — Runtime sniffing: `process.versions.node`

`@langchain/core` sniffs the runtime in exactly one place:

```ts
export const isNode = () =>
  typeof process !== "undefined" &&
  typeof process.versions !== "undefined" &&
  typeof process.versions.node !== "undefined" &&
  !isDeno();
```
Source: [`libs/langchain-core/src/utils/env.ts`](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/utils/env.ts).
`getEnv()` returns `"node"` when this is true; there is no Bun branch. `process.versions` appears
nowhere else in either repo's runtime source (GitHub code search over
`repo:langchain-ai/langchainjs process.versions` returns only this file;
`repo:langchain-ai/langgraphjs process.versions` returns only SDK test files).

Because Bun 1.3.14 reports `process.versions.node = "24.3.0"`, `isNode()` returns **true** under
Bun. The practical effect is that LangChain takes its Node code paths under Bun — which is the
desired behaviour — and that any telemetry/tracing metadata reports the runtime as `"node"`. This is
a mislabel, not a misbehaviour. **No Bun-misdetection bug found.**

### Q4.7 — Dynamic `require`/`import` that a bundler cannot statically resolve

None in the runtime path. `createRequire` appears in `langgraphjs` only under
`libs/checkpoint-validation/` (`src/runner.ts`, `src/import_utils.ts`) — a test-harness package, not
a runtime dependency of `@langchain/langgraph` — and in a yarn patch file. GitHub code search over
`repo:langchain-ai/langchainjs createRequire` returns **zero** source hits.
Sources: code search `repo:langchain-ai/langgraphjs createRequire`,
`repo:langchain-ai/langchainjs createRequire`.

The one dynamic-resolution hazard in the tree is **`better-sqlite3`**, which loads its native binary
through the `bindings` package — a runtime filesystem search, not a static specifier. See Q5.

### Q4.8 — `bun build --compile` with the actual LangGraph tree: works today

Direct experiment, Bun 1.3.14, macOS arm64, `@langchain/langgraph` 1.4.9 + `@langchain/core` 1.2.7:

```
$ bun build --compile probe.mjs --outfile probe-bin
  [66ms]  bundle  534 modules
 [147ms] compile  probe-bin
$ env -i ./probe-bin
invoke: { n: 1 }
getState: { n: 1 }
history entries: 3
no-checkpointer getState -> GraphValueError: No checkpointer set (MISSING_CHECKPOINTER)
```

No build warnings. Binary size 66 MB. The program exercised `StateGraph`, `compile({checkpointer})`,
`invoke`, `getState`, `getStateHistory`, and `MemorySaver`. This does **not** cover the SQLite
checkpointer (Q5) or any provider/model package.

Bun's own docs state `--compile` embeds `.node` files, with the caveat that "the `.node` file must be
required directly or it won't bundle correctly" if `@mapbox/node-pre-gyp` or similar is in play, and
that `bun:sqlite` is usable with `--compile`.
Source: [Bun docs — Single-file executable](https://bun.com/docs/bundler/executables).
`better-sqlite3` uses exactly the indirect-`bindings` pattern that caveat warns about, and
`oven-sh/bun#8895` ("better-sqlite3 .node exe is not bundled", **open** since 2024-02-14) reports
that `bun build` does not bundle `better-sqlite3`'s `.node` while it does bundle other addons'.

---

## Q5 — Cross-process checkpointer reads

### Q5.1 — Is a checkpointer required for `thread_id` resumability/queryability? Yes, for querying.

A graph compiles and runs fine with no checkpointer. But every state-access API hard-fails without
one. In `libs/langgraph-core/src/pregel/index.ts`, `getState`, `getStateHistory`, and the
superstep-update path each begin with:

```ts
const checkpointer = config.configurable?.[CONFIG_KEY_CHECKPOINTER] ?? this.checkpointer;
if (!checkpointer) {
  throw new GraphValueError("No checkpointer set", { lc_error_code: "MISSING_CHECKPOINTER" });
}
```
Source: [`libs/langgraph-core/src/pregel/index.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/pregel/index.ts)
(three occurrences, at the `getState`, `getStateHistory`, and update entrypoints).

Confirmed by direct execution — the error surfaces with an official troubleshooting URL:

```
GraphValueError: No checkpointer set
Troubleshooting URL: https://docs.langchain.com/oss/javascript/langgraph/MISSING_CHECKPOINTER/
lc_error_code: MISSING_CHECKPOINTER
```

The official error page states: "You are attempting to use built-in LangGraph persistence without
providing a checkpointer. This happens when a `checkpointer` is missing in the `compile()` method of
`StateGraph` or `entrypoint`."
Source: [docs.langchain.com — MISSING_CHECKPOINTER](https://docs.langchain.com/oss/javascript/langgraph/MISSING_CHECKPOINTER).

The docs also note the checkpointer is what backs `getState`/`getStateHistory` specifically:
"`.getTuple` … is used to populate `StateSnapshot` in `graph.getState()`"; "`.list` … is used to
populate state history in `graph.getStateHistory()`".
Source: [langgraphjs `docs/docs/concepts/persistence.md`](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md).

So: **optional to run, mandatory to observe or resume by `thread_id`.**

### Q5.2 — Official JS checkpointer packages (npm, as of 2026-08-13)

| Package | npm `latest` | Published | Runtime dependency | Docs positioning |
|---|---|---|---|---|
| `@langchain/langgraph-checkpoint` | 1.1.3 | 2026-06-25 | none | base interface + in-memory `MemorySaver`, "for experimentation"; bundled with `@langchain/langgraph` |
| `@langchain/langgraph-checkpoint-sqlite` | **1.0.3** | 2026-06-10 | **`better-sqlite3` ^12.10.0** | "Ideal for experimentation and local workflows" |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.4 | 2026-06-25 | `pg` ^8.12.0 | "Ideal for using in production" |
| `@langchain/langgraph-checkpoint-mongodb` | 1.4.0 | 2026-06-22 | `mongodb` ^6.21.0 | "Ideal for production use" |
| `@langchain/langgraph-checkpoint-redis` | 1.0.10 | 2026-06-17 | `redis` ^4.7.0 | "Ideal for using in production" |

Version/dependency data read from the npm registry documents
(`https://registry.npmjs.org/@langchain/langgraph-checkpoint-sqlite`, and siblings).
Positioning quoted from
[docs.langchain.com — Checkpointers, "Checkpointer libraries"](https://docs.langchain.com/oss/javascript/langgraph/checkpointers).

**None of these are tagged experimental or beta on npm.** All five publish a stable `latest`
dist-tag. `@langchain/langgraph-checkpoint-sqlite` also carries a `next` tag at 1.0.0, which is
*older* than `latest` — a stale tag, not a prerelease channel. The "experimentation" framing for
SQLite is documentation positioning only, not a package-metadata marker. It is not documented as
production-unsuitable in so many words; the docs say it is "Ideal for experimentation and local
workflows" while Postgres/Mongo/Redis are "Ideal for … production".

### Q5.3 — What the SQLite checkpointer binds to: `better-sqlite3`, and it does not load under Bun

`package.json`:
```json
"dependencies": { "better-sqlite3": "^12.10.0" }
```
Source: [`libs/checkpoint-sqlite/package.json`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-sqlite/package.json).

Source import, line 1:
```ts
import Database, { Database as DatabaseType, Statement } from "better-sqlite3";
```
Source: [`libs/checkpoint-sqlite/src/index.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-sqlite/src/index.ts).

**Not `node:sqlite`. Not `bun:sqlite`.** There is no alternate driver, no optional peer, and no
runtime switch in the package.

`better-sqlite3` **cannot be loaded by Bun at all.** Direct probe, Bun 1.3.14, `better-sqlite3`
12.11.1 installed by `bun add`:

```
error: 'better-sqlite3' is not yet supported in Bun.
Track the status in https://github.com/oven-sh/bun/issues/4290
In the meantime, you could try bun:sqlite which has a similar API.
 code: "ERR_DLOPEN_FAILED"
      at bindings (node_modules/bindings/bindings.js:112:48)
      at new Database (node_modules/better-sqlite3/lib/database.js:48:29)
```
The identical program under Node v24.11.0 succeeds. This is a **`bun run` failure**, so `--compile`
never even enters the picture.

The cause is documented in Bun's own repo:
[oven-sh/bun#4290, "Support V8 C++ APIs for 'nan' addons and other packages to work"](https://github.com/oven-sh/bun/issues/4290)
— **open** since 2023-08-24, labelled `tracking`, 89 comments, with `better-sqlite3` listed as an
affected package and the checkbox **unchecked**. Restated verbatim in the still-open PR
[oven-sh/bun#36712](https://github.com/oven-sh/bun/pull/36712) (2026-08-01): "`better-sqlite3` is a
V8-API native addon, so its compiled `.node` file cannot be loaded by Bun (`process.dlopen` throws
`ERR_DLOPEN_FAILED`…, tracked in #4290)". That PR proposes shimming `require("better-sqlite3")` onto
`bun:sqlite`; it is **open and unmerged** as of 2026-08-13, so it cannot be relied on.

Related open/closed Bun issues in the same cluster, all consistent:
[#8895](https://github.com/oven-sh/bun/issues/8895) (open, 2024-02-14, `.node` not bundled by
`bun build`), [#16050](https://github.com/oven-sh/bun/issues/16050) (closed as duplicate,
2025-01-02, ABI mismatch), [#19328](https://github.com/oven-sh/bun/issues/19328) (closed as
duplicate, 2025-04-28, ABI mismatch), [#25863](https://github.com/oven-sh/bun/issues/25863) (closed
as duplicate, 2026-01-10, feature request).

### Q5.4 — Can a second OS process read state while a first writes?

**LangGraph's documentation is silent on this.** The current
[Checkpointers page](https://docs.langchain.com/oss/javascript/langgraph/checkpointers) and the
[Persistence page](https://docs.langchain.com/oss/javascript/langgraph/persistence) contain **zero**
occurrences of "concurrent", "multi-process", "separate process", "WAL", "lock", or "read-only". The
legacy [`concepts/persistence.md`](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md)
is likewise silent. **Not established from documentation:** there is no official guidance on
multi-process access to a checkpointer store, for SQLite or any other backend. A search of
`langchain-ai/langgraphjs` issues for `SQLITE_BUSY` and `database is locked` returns **zero
results** — the failure mode has apparently never been reported there either.

**What the source guarantees.** `SqliteSaver.setup()` unconditionally enables WAL:

```ts
protected setup(): void {
  if (this.isSetup) return;
  this.db.pragma("journal_mode=WAL");
  this.db.exec(`CREATE TABLE IF NOT EXISTS checkpoints (…)`);
  this.db.exec(`CREATE TABLE IF NOT EXISTS writes (…)`);
  …
}
```
and `setup()` is called at the head of `getTuple()`, `list()`, `put()`, and `putWrites()` alike
(lines 109, 146, 232, 388, 447).
Source: [`libs/checkpoint-sqlite/src/index.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-sqlite/src/index.ts).

`better-sqlite3`'s own documentation states that WAL is the mechanism for exactly this case:
"Concurrently reading and writing from an SQLite database can be very slow in some cases… it's
recommended to turn on WAL mode to greatly increase overall performance", and explicitly discusses
accessing "the database from multiple processes or threads simultaneously" (with the caveat of
checkpoint starvation — the WAL file growing without bound under everlasting concurrent reads,
mitigated by `wal_checkpoint(RESTART)`).
Source: [better-sqlite3 `docs/performance.md`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md).
The default busy timeout is 5000 ms before `SQLITE_BUSY` is thrown, configurable via
`options.timeout` on the `Database` constructor.
Source: [better-sqlite3 `docs/api.md`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md).

**Direct experiment** (Node v24.11.0, since Bun cannot load the driver). Process A ran a 10-superstep
graph against `SqliteSaver.fromConnString("/tmp/ck-probe/run.db")` with a 300 ms delay per node.
Process B, a separate `node` process, opened the same path and polled every 400 ms:

```
reader t0: pid=90923 values={"n":3}  history=11
reader t1: pid=90923 values={"n":4}  history=14
reader t2: pid=90923 values={"n":5}  history=17
reader t3: pid=90923 values={"n":7}  history=23
…
reader t6: pid=90923 values={"n":10} history=30
```
Both `getState` and `getStateHistory` returned live, monotonically advancing state from a second OS
process while the first was actively writing. No `SQLITE_BUSY`, no lock error, writer completed
normally. **This is my own experiment, not documented behaviour.**

**Important boundary — the reader is not read-only.** Because `getTuple()`/`list()` call `setup()`,
which issues a `pragma` and two `CREATE TABLE` statements, a reader process opening the file with
`{ readonly: true }` only works if the database already exists **with the tables created and WAL
already set**. Against a fresh/empty file it fails:

```
readonly getTuple on an initialized DB  -> OK
readonly getTuple on an empty DB        -> SQLITE_READONLY: attempt to write a readonly database
```
There is no way to configure this through `SqliteSaver.fromConnString`, which is hard-wired to
`new Database(connStringOrLocalPath)` with no options object; passing tuned options (`readonly`,
`timeout`) requires constructing `better-sqlite3`'s `Database` yourself and using the
`new SqliteSaver(db)` constructor directly.

**Not established:** whether LangGraph considers cross-process reads a supported pattern at all,
what happens under sustained multi-process polling (checkpoint starvation is a documented
`better-sqlite3` risk that neither project addresses in the LangGraph context), and whether the
same holds for `PostgresSaver`/`RedisSaver`/`MongoDBSaver` — the docs make no concurrency claims for
any backend.

---

## Bearing on the ticket

The Bun blocker is **not** LangGraph and **not** `AsyncLocalStorage`. Those work, including under
`bun build --compile`. The blocker is that the only official file-backed local checkpointer binds to
a native addon Bun has been unable to load for three years, on an open tracking issue with no
committed fix. Options, in order of what the sources support:

1. Use `bun:sqlite` behind a hand-written `BaseCheckpointSaver` implementation. Bun's docs
   explicitly support `bun:sqlite` under `--compile`
   ([Bun docs](https://bun.com/docs/bundler/executables)); the checkpointer interface is four
   methods — `put`, `putWrites`, `getTuple`, `list`
   ([persistence docs](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md))
   — and `@langchain/langgraph-checkpoint-validation` exists as a conformance harness.
2. Wait on [oven-sh/bun#36712](https://github.com/oven-sh/bun/pull/36712) (the `bun:sqlite`-backed
   `better-sqlite3` shim). Open, unmerged, no merge signal.
3. Ship Node alongside the binary for the persistence layer. Contradicts the `cli-distribution`
   requirement of a machine with no `bun` or `node` present.
