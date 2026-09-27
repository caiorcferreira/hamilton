# Hamilton — Agent Instructions

Template-setup CLI (TypeScript, Bun, NestJS with `nest-commander`).

## Essential Commands

```bash
bun install
bun run build
bun --bun vitest run
```

**Run tests with Vitest on Bun; do not use `bun test`.** Use `bun --bun vitest run` for the full suite or `bun --bun vitest run tests/cli/setup.test.ts` for one file. `bun run test` invokes the same Vitest command.

No separate lint or typecheck scripts — `bun run build` is the project's TypeScript gate.

To install the CLI locally after changes: `bun run install-local` (builds and symlinks `dist/cli/main.js` to `~/.local/bin/hamilton`). Remove the CLI symlink and `~/.hamilton/` with `bun run purge`.

## Architecture

```
src/cli/
  main.ts             # Bun entrypoint; starts Nest with CommandFactory.run(AppModule)
  app.module.ts       # root application module
  nest/               # nest-commander root, setup, and workbench command runners and modules
  setup.service.ts    # injectable setup use case
  setup-runtime.ts    # typed setup runtime ports and production adapters
src/workbench/
  *.ts                # injectable operation services and pure workbench helpers
  runtime.ts          # typed workbench runtime ports
src/paths.ts           # ~/.hamilton path helpers and ensureHamiltonHome()
src/index.ts           # canonical VERSION
bundle/                # templates and guidelines installed into ~/.hamilton/
skills/                # Hamilton skills, installed with `npx skills add`
tests/                 # Vitest tests, organized by CLI, workbench, and docs
```

Nest commands use `@Command` / `@SubCommand` and `CommandRunner`. Command handlers delegate to `@Injectable()` services; Nest modules bind typed runtime ports to their production adapters and allow test overrides. Workbench operations remain independently testable through their services and ports.

## Critical Conventions

- **No comments in code** — zero, ever.
- **ESM with `.js` extensions** in imports: `import { x } from "./foo.js"`, including imports of TypeScript files.
- **Errors and results**: thrown custom errors extend native `Error`; workbench services return structured results with `stdout`, `stderr`, and `exitCode`.
- **`bun.lock` is text** (not `bun.lockb`, which is ignored).
- **Pin every dependency version** — no `~` or `^` in `package.json`.
- **Every PR must bump the project version** — keep `package.json`'s `version` and `src/index.ts`'s `VERSION` synchronized.
- **Shebang**: `#!/usr/bin/env bun` in `src/cli/main.ts`.
- Release workflows compile a standalone Bun binary for each supported platform; keep the sidecar `bundle/` available for setup.

## Testing Patterns

- `vitest.config.ts` sets `globals: false`; import `describe`, `it`, and `expect` from `vitest`.
- Tests that touch `~/.hamilton/` set `process.env.HOME` to a temporary directory and restore it afterward.
- Tests that exercise bundle lookup use a temporary bundle or set `HAMILTON_BUNDLE_DIR` to one.
- Prefer real temporary filesystem and Git fixtures where useful; unit tests can inject fake runtime ports, and Nest provider wiring belongs in Nest testing-module coverage.
- Run one test file with `bun --bun vitest run <path>`.

## CLI Conventions

- Root, setup, and workbench command classes live under `src/cli/nest/`; setup orchestration belongs in the injectable `SetupService`.
- Workbench operations are injectable services under `src/workbench/`, one per operation. Inject only the operation's typed runtime ports; keep pure helpers independent of Nest.
- Command handlers report structured output and exit codes through `ResultReporter`.

## TODO Conventions

When a task in `TODO.md` is marked `[x]` done, move it from `## Next Up` to `## Completed`. Completed items use `- [x]` and stay ordered by completion time (most recent first).
