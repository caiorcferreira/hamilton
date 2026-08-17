# Extracting token usage and cost from `opencode run`

Research for [ticket 13](../tickets/13-opencode-usage-extraction.md): how a `hamilton loop`
kernel wrapping `opencode run` can populate `usage?: { inputTokens, outputTokens, costUsd }`.

All version-dependent claims were verified against **opencode v1.18.8** (the locally installed
binary at `/opt/homebrew/bin/opencode`, `opencode --version` → `1.18.8`) and the matching
`v1.18.8` tag of [sst/opencode](https://github.com/sst/opencode) (commit `3c81a5d1`). Where the
`dev` branch was consulted it is noted; in every case checked, the v1.18.8 source was identical
on the relevant lines.

## 1. Structured output: `opencode run --format json`

`opencode run` has a JSON event-stream mode, and it **does include per-step token usage and
cost**.

- The flag is `--format` with choices `default` (formatted) and `json` ("raw JSON events").
  Verified in the installed v1.18.8 via `opencode run --help`, and documented on the CLI docs
  page ([opencode.ai/docs/cli](https://opencode.ai/docs/cli/), `run` section: "Format: default
  (formatted) or json (raw JSON events)"). I could not pin down the exact version that
  introduced the flag; it exists in v1.18.8 and in current `dev`.
- Output is **NDJSON on stdout**: one JSON object per line, each shaped
  `{ type, timestamp, sessionID, ...data }`. Source: the `emit()` helper in
  [`packages/opencode/src/cli/cmd/run.ts`](https://github.com/sst/opencode/blob/v1.18.8/packages/opencode/src/cli/cmd/run.ts)
  (lines 678–691 at the v1.18.8 tag).
- Event types emitted (same file, lines 720–784): `tool_use`, `step_start`, `step_finish`,
  `text`, `reasoning`, `error`.
- **`step_finish` carries usage.** Its `part` payload is a `StepFinishPart`, whose schema
  includes `cost: number` and
  `tokens: { input, output, reasoning, cache: { read, write }, total? }`. Source:
  [`packages/schema/src/v1/session.ts`](https://github.com/sst/opencode/blob/v1.18.8/packages/schema/src/v1/session.ts)
  lines 240–256 at the v1.18.8 tag (also surfaced in the generated SDK,
  `packages/sdk/js/src/gen/types.gen.ts`, `StepFinishPart`).
- One step = one LLM call. The message-level totals are accumulated from steps
  (`ctx.assistantMessage.cost += usage.cost` in
  [`packages/opencode/src/session/processor.ts`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/processor.ts),
  line ~444 on `dev`), so **summing `part.cost` and `part.tokens.*` across all `step_finish`
  events of the run reproduces what opencode itself records** for the assistant message(s).
- There is **no final summary event** with run totals; the kernel must sum `step_finish`
  events itself (verified by reading the full event loop in `run.ts` — nothing else is
  emitted in JSON mode).

### Session id exposure

Every JSON event line includes a top-level `sessionID` field (the `emit()` helper injects it
unconditionally — `run.ts` lines 678–691). So in `--format json` mode the kernel learns the
session id from the first event. In `default` format the session id is **not** printed
(the header prints only agent and model, `run.ts` line ~710), so JSON mode is also the only
way to capture the id without pre-creating a session. Alternatively the caller can dictate the
session with `--session <id>` / `-c, --continue` (both in `opencode run --help`, v1.18.8).

## 2. On-disk session state

**v1.18.8 stores sessions in a SQLite database, and the `session` table carries usage columns
directly.**

- Location: `~/.local/share/opencode/opencode.db`. This is discoverable through a public CLI
  command: `opencode db path` (verified locally; prints
  `/Users/caio.cavalcante/.local/share/opencode/opencode.db`). `opencode db [query]` runs
  arbitrary SQL against it and supports `--format json|tsv` (verified via `opencode db --help`,
  v1.18.8).
- Schema (read from the local DB, `.schema`): table `session` has columns
  `cost REAL`, `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`,
  `tokens_cache_write` (all `NOT NULL DEFAULT 0`), plus `id`, `project_id`, `directory`,
  `model`, timestamps, etc. Tables `message` and `part` store the full records as JSON in a
  `data` column; assistant-message `data` embeds `$.cost` and `$.tokens.*`.
- The session usage columns are **sums over the session's assistant messages** — the migration
  that introduced them backfills exactly that:
  [`packages/core/src/database/migration/20260510033149_session_usage.ts`](https://github.com/sst/opencode/blob/dev/packages/core/src/database/migration/20260510033149_session_usage.ts)
  (`SET cost = sum(json_extract(message.data,'$.cost')) ... WHERE role='assistant'`).
- Verified against live local data: recent session rows show populated values, e.g.
  `cost=3.2520696, tokens_input=1342204, tokens_output=40132, cache_read=9957568`.
- Caveats: the DB is shared mutable state (WAL files present), and **older opencode versions
  used flat JSON files** under `~/.local/share/opencode/storage/` instead of SQLite (a
  `storage/migration` remnant exists locally). The SQLite schema itself is internal (Drizzle
  migrations), but the `opencode db` command makes querying it a supported, user-facing
  operation in v1.18.8. A supervisor **can** read usage after `opencode run` exits, keyed by
  session id, e.g.:
  `opencode db --format json "SELECT cost, tokens_input, tokens_output FROM session WHERE id='ses_...'"`.

Higher-level (and more stable) than raw SQL:

- **`opencode export [sessionID]`** — "export session data as JSON" (`opencode export --help`,
  v1.18.8; also on the CLI docs page). Output is `{ info, messages }` where `info` is the
  session record and `messages` are messages with parts — assistant messages include `cost`
  and `tokens`, and `--sanitize` redacts transcript text but **not** the usage numbers
  (source: [`packages/opencode/src/cli/cmd/export.ts`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/cli/cmd/export.ts) —
  the `sanitize()` function never touches `cost`/`tokens`).
- **`opencode session list --format json`** does **not** include usage — only
  `id, title, updated, created, projectId, directory`
  (source: `formatSessionJSON()` in
  [`packages/opencode/src/cli/cmd/session.ts`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/cli/cmd/session.ts)).
- **`opencode stats`** — "show token usage and cost statistics" (`opencode stats --help`,
  v1.18.8; [docs](https://opencode.ai/docs/cli/)). Aggregate, human-formatted table over the
  whole DB (`--days`, `--project`, `--models` filters); no JSON output and no per-session
  query, so unsuitable for per-invocation extraction.

## 3. Server / API surface

opencode runs a local HTTP server (`opencode serve`, default `127.0.0.1:4096`) with an
OpenAPI 3.1 spec served at `/doc`; the spec generates the JS SDK. Source:
[opencode.ai/docs/server](https://opencode.ai/docs/server/).

- `GET /session/:id` returns the session record (`Session.Info`) — whose schema includes
  **optional `cost` and `tokens`** fields
  ([`packages/schema/src/v1/session.ts`](https://github.com/sst/opencode/blob/v1.18.8/packages/schema/src/v1/session.ts)
  `SessionInfo`, lines 543–569 at v1.18.8; route definition in
  [`packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`](https://github.com/sst/opencode/blob/v1.18.8/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts)).
  Note the older v1 generated SDK type (`packages/sdk/js/src/gen/types.gen.ts`) omits
  `cost`/`tokens` on `Session`, while the v2 generated type
  (`packages/sdk/js/src/v2/gen/types.gen.ts`, lines 170–193) includes them — treat
  session-level fields as version-dependent.
- `GET /session/:id/message` returns messages with parts (`SessionV1.WithParts[]`); assistant
  messages carry **required `cost` and `tokens`** (schema `Assistant`, lines 453–485 at
  v1.18.8 — both fields are non-optional on assistant messages in v1 and v2 SDKs).
- `opencode run --attach http://localhost:PORT` runs against an existing server
  (`opencode run --help`, v1.18.8), so a supervisor that manages its own `opencode serve`
  can query usage over HTTP after each run.
- No CLI command reports per-session usage directly; `export` (JSON dump) and `stats`
  (aggregate table) are the closest, as covered above.

## 4. Cost vs tokens

**opencode computes `cost` in USD itself** — the kernel does not need to price tokens.

- `Session.getUsage()` in
  [`packages/opencode/src/session/session.ts`](https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/session.ts)
  (line ~338 on `dev`) converts provider-reported token counts into cost:
  `input×cost.input/1e6 + output×cost.output/1e6 + cache.read×cost.cache.read/1e6 + cache.write×cost.cache.write/1e6 + reasoning×cost.output/1e6`,
  with tiered-pricing handling (`cost.tiers`, `experimentalOver200K`). A code comment reads
  "TODO: update models.dev to have better pricing model" — the per-model `cost` rates come
  from opencode's model catalog, which is backed by [models.dev](https://models.dev).
- The computed `cost` is stored on every `step-finish` part, every assistant message, and
  (summed) on the session row — all three surfaces from sections 1–3.
- Caveat: cost is 0 when the model has no pricing metadata (e.g. local models, or
  subscription-billed providers) — `costInfo?.input ?? 0` in the same function. The kernel
  should treat `cost === 0` with nonzero tokens as "unknown" and may leave `costUsd` unset in
  that case.
- Note the token-shape mismatch with opencode's accounting: opencode's `tokens.input`
  **excludes** cache reads/writes (they are subtracted and tracked under `tokens.cache`,
  `getUsage()` comment: "Always subtract cache tokens to get the non-cached input count").
  If hamilton's `inputTokens` is meant to be "billed input", sum
  `tokens.input + tokens.cache.read + tokens.cache.write`; if it mirrors what
  `claude -p` reports (which also separates cache fields), keep them consistent across
  kernels.

## Recommendation

Ranked by robustness (documented interface > stable-but-undocumented > private state):

1. **Primary: parse the `--format json` event stream** (documented flag on
   [opencode.ai/docs/cli](https://opencode.ai/docs/cli/); event shape from source). Run
   `opencode run --format json ...`, read NDJSON from stdout, capture `sessionID` from the
   first event, and sum `cost` and `tokens` over `step_finish` events. This is in-band (no
   second process, no shared-state race), works per-invocation, and uses the same schema the
   public SDK exposes (`StepFinishPart`). Fragility: the event *types* (`step_finish` etc.)
   are only documented in source, but the part schema is part of the published OpenAPI/SDK
   surface.
2. **Fallback / cross-check: `opencode export <sessionID>`** after exit (documented CLI
   command) — read `messages[].info` where `role === "assistant"` and sum `cost`/`tokens`.
   Requires the session id, which the JSON stream (or a caller-supplied `--session`) provides.
3. **Last resort: query the SQLite DB** —
   `opencode db --format json "SELECT cost, tokens_input, ... FROM session WHERE id=?"`.
   The `opencode db` command is public, but the schema is internal Drizzle state and changed
   from flat JSON files to SQLite across versions; treat as version-pinned.

The HTTP API (`GET /session/:id`) is equally legitimate but only pays off if hamilton already
manages a long-lived `opencode serve` and uses `run --attach`; for one-shot subprocess kernels
the event stream avoids the server lifecycle entirely.

**Populate `usage` as:** `inputTokens` = Σ step `tokens.input` (+ cache read/write if hamilton
counts billed input — decide once, consistently with the claude kernel), `outputTokens` =
Σ step (`tokens.output` + `tokens.reasoning`) or just `tokens.output` to mirror the claude
kernel's output figure, and `costUsd` = Σ step `cost`, left unset when the sum is 0 despite
nonzero tokens (unpriced model).
