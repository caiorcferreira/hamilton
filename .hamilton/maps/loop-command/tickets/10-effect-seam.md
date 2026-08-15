---
type: grilling
status: open
blocked_by: ["01"]
---

# The Effect seam

## Question

The map's standing constraint: the loop subsystem takes no Effect dependency, with a thin adapter
at the `@effect/cli` registration point as the only exception. This is the first Effect-free
province in the codebase, so it sets precedent for every subsystem after it. Make the boundary
precise enough that a reviewer can tell when it has been crossed.

- **Where exactly is the line?** A directory (`src/loop/**` imports no `effect`)? A lint rule? A
  documented convention in `AGENTS.md`? Note there is no lint script in this repo — `bun run build`
  is the only gate — so an unenforced convention is the likely default. Is that acceptable?
- **The adapter's shape.** `@effect/cli` `Command.make` handlers return an `Effect`. Does the
  adapter wrap a plain async function in `Effect.promise` / `Effect.tryPromise`? What happens to
  errors crossing that boundary, given `AGENTS.md` mandates `Data.TaggedError` for all custom
  errors — does that mandate apply to the loop subsystem, or is this the first exemption?
- **Replacements.** Effect currently supplies filesystem access (`@effect/platform-bun`), error
  modelling, and control flow. The loop subsystem needs all three. Does it use `node:fs`/`bun`
  APIs, plain `Error` subclasses or a tagged-union result type, and async/await? Name the
  replacements explicitly — "not Effect" is not a design.
- **Does `AGENTS.md` change?** The conventions section currently mandates Effect patterns
  repository-wide. If the loop is exempt, the document has to say so, or the next agent session
  will "fix" the loop code back into Effect.
- **Test conventions.** The existing tests use `Effect.runPromiseExit` + `Exit.isSuccess` as the
  standard async pattern. What replaces that for the loop's tests? (Ties to ticket 11.)
- **Scope discipline.** This ticket decides the seam only. Unwinding Effect from `setup.ts`,
  `paths.ts`, or `main.ts` is explicitly out of scope per the map.

## Answer

## Outdated decisions
