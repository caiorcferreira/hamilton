---
type: research
status: resolved
blocked_by: []
---

# Usage extraction from `opencode run`

## Question

The kernel result carries an optional `usage?: { inputTokens, outputTokens, costUsd }` field
([The kernel seam](02-kernel-seam.md)). `claude -p --output-format json` reports usage directly;
`opencode run` — the author's main agent, so the kernel that matters most in practice — does not
obviously do so. Graduated from the map's cost-observability fog when 02 fixed the seam-level
shape (2026-08-17).

Investigate, against opencode's own docs and source:

- **Output formats.** Does `opencode run` have a JSON/structured output mode, and does it include
  token usage or cost per invocation? Which flags, and since which version?
- **Session files.** opencode persists sessions on disk — do the stored session records carry
  usage, and is the on-disk location and schema stable enough for a kernel to read after the
  subprocess exits (keyed by the session id the kernel already captures)?
- **Server/API surface.** If the CLI itself reports nothing, does `opencode` expose a local
  API or command (`opencode session ...`) that returns usage for a completed session?
- **Cost vs tokens.** If only tokens are available, is cost derivable (does opencode know
  provider pricing), or should the kernel report tokens and leave `costUsd` unset?

The answer decides whether the opencode kernel populates `usage?`, by which mechanism, and how
fragile that mechanism is (documented interface vs reading private state).

findings at research/opencode-usage-extraction.md

## Answer

Resolved by research, 2026-08-17. Full findings with citations in
[research/opencode-usage-extraction.md](../research/opencode-usage-extraction.md); verified
against opencode v1.18.8 (installed binary + matching source tag).

**The opencode kernel populates `usage?`, in-band, via `opencode run --format json`.** The
documented `--format json` flag emits NDJSON events on stdout; each `step_finish` event carries
`cost` (USD) and `tokens { input, output, reasoning, cache: { read, write } }` per LLM call, and
summing across `step_finish` events reproduces opencode's own accounting. There is no final
summary event — the kernel sums. Every event line also carries `sessionID`, which is how the
kernel captures the session id (`sessionId?` from [ticket 02](02-kernel-seam.md)) — the default
output format never prints it.

- **Cost comes from opencode itself** (models.dev-backed pricing, including cache and tiered
  rates) — the kernel never prices tokens. Caveat: unpriced models (local, subscription-billed)
  report `cost: 0`; the kernel treats zero cost with nonzero tokens as unknown and leaves
  `costUsd` unset.
- **Fallbacks exist but are not the mechanism:** `opencode export <sessionID>` (documented CLI,
  usage survives `--sanitize`) as a post-hoc cross-check; the SQLite DB
  (`opencode db --format json` against `~/.local/share/opencode/opencode.db`, `session` table
  usage columns) is public-command-but-internal-schema and version-pinned — last resort only.
  The HTTP API carries usage too, but only pays off with a persistent `opencode serve` +
  `run --attach`, which a one-shot subprocess kernel doesn't want.
- **Accounting convention to fix once, at implementation, consistently across kernels:**
  opencode's `tokens.input` excludes cache read/write (tracked separately), so Hamilton must
  decide whether `inputTokens` means billed input (sum cache in) or mirrors the CLI's
  non-cached figure — whichever is chosen must match the `claude -p` kernel's interpretation.

This closes the fog question of whether `usage?` is populatable for the author's main agent:
yes, via a documented flag, with no second process and no shared-state race.

## Outdated decisions

