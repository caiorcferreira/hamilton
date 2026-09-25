---
artifact: proposal
change: 2026-09-25-replace-effect-cli-with-nestjs
status: draft
decision: accepted
author: Caio Ferreira <caiorcferreira@gmail.com>
created: 2026-09-25
route_unit: null
---

# Proposal: Replace Effect-TS in the CLI with NestJS

## Why

Hamilton's CLI currently uses Effect-TS for command parsing, runtime composition, error handling, and setup tests. The same CLI is distributed as standalone Bun-compiled binaries, so replacing the framework must remove Effect-specific application and tooling dependencies without weakening the command contract or release format.

## Goals & Success Criteria

- Implement every Hamilton CLI command with NestJS and `nest-commander`.
- Remove Effect-TS imports, dependencies, test adapters, language-service setup, TypeScript plugin configuration, and active project guidance.
- Preserve the current root, setup, and workbench command names, arguments, options, help/version behavior, output streams, exit codes, and operation results.
- Preserve the four supported standalone binary targets and their ability to run without Bun, Node, or a source checkout.
- Keep the existing build and Vitest workflows working without Effect-TS tooling.

## Non-Goals

- Do not change setup's filesystem behavior, workbench operation semantics, or the bundle lookup contract.
- Do not change the release targets, installer layout, or runtime prerequisites for end users.
- Do not rewrite historical `.hamilton/changes/` records that document the former framework.
- Do not move workflow judgment owned by Hamilton's skills into the CLI.

## Proposed Change

Replace the Effect-TS command and runtime layer with NestJS modules and `nest-commander` command handlers across the root CLI, `setup`, and every `workbench` subcommand. Remove the Effect-TS package dependencies and the language-service script and TypeScript configuration. Update setup tests and the active project instructions to use the new framework. Keep the CLI's public behavior and Bun standalone distribution intact.

## Capabilities

### New

*(none)*

### Modified

- `cli-distribution`: Replace the CLI framework and remove Effect-TS tooling while preserving the standalone release and setup contracts.
- `workbench`: Replace the command adapters while preserving the documented operation interface and result contract.

### Removed

*(none)*

## Impact

The change affects `src/cli/`, the CLI tests, `package.json`, `bun.lock`, `tsconfig.json`, `AGENTS.md`, and any build or release configuration required for NestJS decorators and command execution. The `src/workbench/` operation modules remain the behavior boundary; the command layer must continue to translate parsed arguments into their existing inputs and render their existing results. The release workflow must still compile and smoke-test the supported standalone binary. Project policy requires the implementation change to synchronize the package and source versions.
