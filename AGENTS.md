# Hamilton — Agent Instructions

Template-setup CLI (TypeScript, bun, Effect-TS).

## Essential Commands

```bash
bun install          # install deps
bun run build        # tsc -p tsconfig.json
bun run test         # bun --bun vitest run
```

**Do NOT use `bun test`.** The native bun test runner lacks `vi.mocked()`. Always use `bun --bun vitest run`. Use `bun --bun vitest run tests/cli/setup.test.ts` for a single file.

No lint or typecheck scripts — `bun run build` is the only gate.

To install the CLI locally after changes: `bun run install-local` (builds + symlinks `dist/cli/main.js` to `~/.local/bin/hamilton`). Purge with `bun run purge`.

## Architecture

```
src/cli/
  main.ts             # Command.run(rootCommand) → BunRuntime.runMain
  bundle-root.ts      # Locates bundle/ (env override, binary sibling, source checkout)
  commands/
    setup.ts          # setupHamilton effect + setupCommand — copies templates + guidelines, writes settings.yaml
src/paths.ts          # ~/.hamilton path helpers + ensureHamiltonHome()
src/index.ts          # VERSION
bundle/
  templates/          # SDD artifact templates, copied to ~/.hamilton/templates/ by setup
  guidelines/         # Coding guidelines, copied to ~/.hamilton/guidelines/ by setup
skills/               # Assisted skills (hamilton-* SKILL.md files), installed via `npx skills add`
tests/                # vitest, mirrors src/ structure
```

CLI commands use `@effect/cli` 0.75.2: `Command.make(name, { args, options }, handler)` with `Command.withSubcommands([])`. Each command file exports its `Command` — `main.ts` just composes them.

## Critical Conventions

- **No comments in code** — zero, ever.
- **ESM with `.js` extension** in imports: `import { x } from "./foo.js"` even when importing `.ts` files.
- **`Data.TaggedError`** for all custom errors (not `class extends Error`).
- **`bun.lock` is text** (not `bun.lockb` which is in `.gitignore`).
- **All dependency versions pinned** — no `~` or `^` in package.json.
- **Shebang**: `#!/usr/bin/env bun` in `src/cli/main.ts`.
- **`@effect/platform-bun`** (not `platform-node`) since we run on bun.

## Effect-TS Quirks

- `Effect.gen(function* (_)` — use `_` for the yielded generator if pattern-matching on yielded values.
- `Effect.runPromiseExit(effect)` + `Exit.isSuccess(exit)` / `Exit.isFailure(exit)` is the standard async test pattern.
- `@effect/cli` `Options.choice("name", ["a","b"] as const)` creates a valued option. Pipe with `.pipe(Options.optional)` to make it optional.

## Testing Patterns

- `vitest.config.ts` has `globals: false` — always import `describe`, `it`, `expect`.
- **Home dir override pattern**: Tests that touch `~/.hamilton/` set `process.env.HOME = tmp` in `beforeEach` and restore in `afterEach`.
- **Bundle override pattern**: Tests that exercise bundle copy set `process.env.HAMILTON_BUNDLE_DIR` to a temp dir with the expected subdirs.
- **No mocking libraries** — tests use real temp dirs/files with `node:os.tmpdir()`.
- Run a single test file: `bun --bun vitest run tests/cli/setup.test.ts`

## CLI Conventions

- Each command file under `src/cli/commands/` exports both the `Command` and the underlying `Effect` function (for testability).
- `setup.ts` is the only command — it exports `setupCommand` and `setupHamilton`.

## TODO Conventions

When a task in `TODO.md` is marked `[x]` done, move it from `## Next Up` to `## Completed`. Completed items use `- [x]` and stay ordered by completion time (most recent first).
