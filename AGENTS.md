# Hamilton — Agent Instructions

Workflow-based agentic execution engine (TypeScript, bun, Effect-TS, Pi SDK, SQLite).

## Essential Commands

```bash
bun install          # install deps
bun run build        # tsc -p tsconfig.json
bun run test         # bun --bun vitest run (155 tests)
```

**Do NOT use `bun test`.** The native bun test runner lacks `vi.mocked()`. Always use `bun --bun vitest run`. Use `bun --bun vitest run tests/db/queries.test.ts` for a single file.

No lint or typecheck scripts — `bun run build` is the only gate.

To install the CLI locally after changes: `bun run install-local` (builds + symlinks `dist/cli/main.js` to `~/.local/bin/hamilton`). Purge with `bun run purge`.

## Architecture

```
src/cli/              # @effect/cli Commands (was manual argv, now migrated)
  main.ts             # Command.run(rootCommand) → BunRuntime.runMain
  commands/           # Each file exports xxxCommand + the underlying Effect
src/agent/            # Pi SDK integration, persona resolution, prompt building
src/workflow/         # Runner, state machine, engine, loader, context merging
src/db/               # bun:sqlite queries + schema
src/observability/    # Run dirs, streaming, JSONL logs
tests/                # vitest, mirrors src/ structure
workflows/            # Bundled workflow YAML specs + agent personas
agents/shared/        # Shared agent personas (installed to ~/.hamilton/agents/)
docs/superpowers/     # Design specs + implementation plans
```

CLI commands use `@effect/cli` 0.75.2: `Command.make(name, { args, options }, handler)` with `Command.withSubcommands([])`. Each command file exports its `Command` — `main.ts` just composes them.

## Critical Conventions

- **No comments in code** — zero, ever.
- **ESM with `.js` extension** in imports: `import { x } from "./foo.js"` even when importing `.ts` files.
- **`Data.TaggedError`** for all custom errors (not `class extends Error`).
- **DB is `bun:sqlite`**: `import { Database } from "bun:sqlite"` — not `better-sqlite3` (migrated away).
- **`bun.lock` is text** (not `bun.lockb` which is in `.gitignore`).
- **All dependency versions pinned** — no `~` or `^` in package.json.
- **Shebang**: `#!/usr/bin/env bun` in `src/cli/main.ts`.
- **`@effect/platform-bun`** (not `platform-node`) since we run on bun.

## Effect-TS Quirks

- `Effect.timeout` in effect 3.21.3 returns **unwrapped values** on success (not `Option`-wrapped as in newer Effect versions).
- `Effect.gen(function* (_)` — use `_` for the yielded generator if pattern-matching on yielded values.
- `Effect.runPromiseExit(effect)` + `Exit.isSuccess(exit)` / `Exit.isFailure(exit)` is the standard async test pattern.
- `@effect/cli` `Options.choice("name", ["a","b"] as const)` creates a valued option. Pipe with `.pipe(Options.optional)` to make it optional.
- `Args.repeated` exists for variadic args — `Args.trailing` does **not** exist in this version.

## Testing Patterns

- `vitest.config.ts` has `globals: false` — always import `describe`, `it`, `expect`.
- **Home dir override pattern**: Tests that touch `~/.hamilton/` set `process.env.HOME = tmp` in `beforeEach` and restore in `afterEach`.
- **DB test pattern**: `tempDb()` helper creates in-memory SQLite, creates schema, stamps `_tempDir` for cleanup.
- **No mocking libraries** — tests use real temp dirs/files with `node:os.tmpdir()`.
- Run a single test file: `bun --bun vitest run tests/cli/list.test.ts`

## CLI Conventions (Post-migration)

- Each command file under `src/cli/commands/` exports both the `Command` and the underlying `Effect` function (for testability).
- `install-logic.ts` has shared install/uninstall functions; `install.ts` and `uninstall.ts` are Command wrappers.
- `doctor.ts` uses an extensible `checks` array — currently only `checkRtk`. Add new checks by pushing to the array.
- `main.ts` deletes were: `rtk.ts` + `rtk.test.ts` (replaced by `doctor.ts`).

## ROADMAP Conventions

When a task in `ROADMAP.md` is marked `[x]` done, move it from `## Next Up` to `## Completed`. Completed items use `- [x]` and stay ordered by completion time (most recent first).

## Stale Worktrees

`.worktrees/bun-migration/` is stale — LSP errors from it are ignorable. Only `main` branch is active.
