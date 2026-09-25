---
artifact: design
change: 2026-09-25-replace-effect-cli-with-nestjs
status: draft
created: 2026-09-25
author: Caio Ferreira <caiorcferreira@gmail.com>
decision: accepted
route_unit: null
---

# Design: Replace Effect-TS in the CLI with NestJS

## Context

The CLI entry point currently composes `@effect/cli`, `@effect/platform-bun`, and Effect runtime operations. `setup` returns an Effect value, and `workbench` command handlers adapt parsed inputs to asynchronous operation functions and their structured results. The `src/workbench/` modules already separate use cases and expose Git, filesystem, process, and runtime seams; their tests exercise temporary repositories and explicit fake dependencies. The project also uses Effect-specific language-service dependencies and configuration that the refactor must remove.

Hamilton's release workflow builds self-contained Bun executables for macOS and Linux on x64 and arm64. The CLI must continue to locate the bundle from an environment override, an installed sibling, or the source checkout. The user chose `nest-commander` and the provider-oriented Nest architecture, accepting the wider migration from command adapters into injectable operation services.

## Goals / Non-Goals

**Goals**

- Use NestJS and `nest-commander` to bootstrap and dispatch all CLI commands.
- Make setup and each workbench operation available through a role-specific injectable service.
- Remove Effect-TS imports, package dependencies, test adapters, build hooks, TypeScript configuration, and active project guidance.
- Preserve existing CLI inputs and outputs, operation results, and standalone Bun distribution.
- Keep operation policy and low-level artifact validation independent of CLI command parsing.

**Non-Goals**

- Do not change setup behavior, workbench operation semantics, or bundle resolution order.
- Do not add an HTTP server or an HTTP platform adapter.
- Do not rewrite historical `.hamilton/changes/` records.
- Do not introduce generic provider registries, plugin systems, or other extension points without a current requirement.

## Decisions

### Decision: Use NestJS with `nest-commander` as the CLI framework

- Choice: Bootstrap the command application with `CommandFactory.run(AppModule)`, following the [`nest-commander` command setup](https://github.com/jmcdo29/nest-commander). Use Nest-managed command classes for the root, setup, workbench group, and workbench subcommands.
- Alternatives considered: Keep or write a separate argument parser around Nest's standalone application context; rejected because the user selected `nest-commander` to own command parsing and registration. Use Nest's HTTP application and platform adapter; rejected because Hamilton is a terminal CLI and does not serve HTTP.
- Rationale: `nest-commander` supplies command and option parsing while Nest supplies the application module and dependency-injection container. One framework owns command lifecycle and dependency resolution.

### Decision: Represent setup and workbench operations as injectable services

- Choice: Provide one use-case service for setup and one for each workbench operation. Command classes validate CLI-specific combinations, call the corresponding service, and hand structured results to the CLI output adapter. Services own use-case orchestration and inject the runtime collaborators they need. Framework-independent parsers, validators, and other focused algorithms may remain as helpers below these services.
- Alternatives considered: Keep every operation as a free function and add only command classes; rejected after the user selected the provider-oriented approach. Put all six workbench operations into one generic service; rejected because each operation has distinct behavior, dependencies, and reasons to change.
- Rationale: The Nest container becomes the application composition boundary the user requested, while one provider per use case avoids a command manager with unrelated responsibilities. Retaining focused pure helpers keeps artifact and argument rules independently testable.
- Accepted trade-off: Provider migration touches every workbench operation even though its current functions already have test seams. Preserve result types and use-case boundaries, and verify each operation's current contract before changing its dependency wiring.

### Decision: Inject role-sized runtime ports

- Choice: Register production filesystem, bundle-location, process, and Git collaborators at the CLI module boundary and inject only the ports each setup or workbench service uses. Reuse existing port shapes where they match; split an oversized dependency rather than injecting a universal mutable runtime object. Test providers substitute fakes or temporary filesystem and Git implementations.
- Alternatives considered: Call `node:fs`, `process`, and Git directly from operation services; rejected because those services would lose the explicit test seams already present. Inject one all-purpose runtime context into every service; rejected because it would couple unrelated operations and expose unused collaborators.
- Rationale: This maintains dependency inversion and prevents Nest-specific infrastructure from leaking into low-level artifact and result helpers.

### Decision: Preserve the Bun standalone release path

- Choice: Keep [`bun build --compile`](https://bun.sh/docs/bundler/executables) for the existing four target binaries and verify the Nest command application in both source execution and a compiled Linux x64 executable. Configure TypeScript decorator metadata required by Nest, remove the Effect language-service schema and plugin, and retain the existing `bun run build` and Vitest gates.
- Alternatives considered: Move releases to Node-based executables; rejected because the installed-binary contract requires a self-contained executable and the current release path is Bun-native. Keep Effect-specific TypeScript configuration solely for compatibility; rejected because the user requested its removal everywhere.
- Rationale: The framework changes without weakening distribution or retaining stale tooling. The integration smoke test makes decorator and dependency bundling behavior observable before release.

## Architecture & Components

| Unit | Responsibility | Interface and dependencies |
|---|---|---|
| `src/cli/main.ts` | Start the Nest command application and map bootstrap failures to the CLI's single error path. | Calls `CommandFactory.run(AppModule)` and reads the canonical `VERSION`; owns no command business logic. |
| `src/cli/app.module.ts` | Compose the application's setup and workbench modules. | Imports the two command modules; contains no operation policy. |
| Setup command module and command | Register `setup`, parse `--force`, invoke setup service, and render setup's current success or failure output. | Injects `SetupService` and the setup output dependency. |
| Workbench command module and command classes | Register the workbench group and six named commands, parse existing arguments/options, preserve CLI-level combination checks, and report structured results. | Injects the matching operation service and a shared result reporter. |
| Setup service | Own setup orchestration: create Hamilton directories, resolve the bundle, copy templates and guidelines, and preserve existing settings behavior. | Injects bundle-location, home/filesystem, and settings dependencies through narrow ports. |
| Workbench operation services | Own the `isolate`, `diff`, `precondition`, `context`, `prototype`, and `lint` use cases, one service per operation. | Each service receives only its operation's typed Git, filesystem, process, and runtime ports; pure parsing and validation helpers remain framework-independent. |
| Runtime provider modules | Adapt Bun/Node filesystem access and Git/process execution to the operation ports. | Registered in Nest modules and replaceable by test providers; do not decide workflow policy. |
| CLI result reporter | Write command stdout/stderr and set the process exit code. | Accepts output strings and an exit code; command handlers adapt structured results (including rendered lint findings); has no Git, filesystem, or parsing dependency. |

The flow is `process argv → CommandFactory → AppModule → command handler → injected use-case service → role-sized runtime ports → structured result → CLI result reporter`. `setup` follows the same path but renders its template list and setup errors. The root command continues to own help and `--version`. The command layer handles syntactic usage rules; services handle operation behavior and return the existing result contracts.

### Quality Lens

Each module and provider has one reason to change: root composition, one CLI command, one setup use case, one workbench use case, or one infrastructure adapter. Command handlers depend on service interfaces, and services depend on operation-specific ports rather than concrete filesystem, process, or Git implementations; test modules can substitute those providers. The design adds no universal runtime service or generic command registry. The accepted cost is the broader provider migration requested by the user; pure helpers and result types remain framework-independent so the work does not couple artifact logic to Nest decorators.

## Data & Flow

1. `CommandFactory` loads `AppModule`, which registers `SetupModule` and `WorkbenchModule` and their runtime providers.
2. `nest-commander` parses the selected command and options, then invokes its Nest-managed command handler.
3. The handler validates command-specific option combinations and calls the matching injected service with typed input.
4. The service executes its use case through injected ports and returns a structured result or a setup failure.
5. The command output provider writes stdout and stderr and sets `process.exitCode`; setup retains its existing success listing and failure message, while lint renders its findings before reporting them.

## Error Handling & Edge Cases

| Failure | Behavior |
|---|---|
| Unknown command, missing required input, or invalid option combination | Return the documented usage/environment code `2`; preserve the CLI's error stream and avoid starting the operation. |
| Workbench negative check or failed check | Preserve the service's `0`/`1`/`2` result, output streams, and final machine-readable line. |
| Setup bundle or filesystem failure | Report the existing setup error message through one command error path; do not swallow or duplicate it. |
| Nest provider/bootstrap failure | Fail before executing a command, report one actionable error, and return code `2`. |
| Compiled binary cannot load decorator metadata or a bundled dependency | The release smoke test fails; do not publish a binary that cannot run its command tree. |
| Bundle is absent | Preserve the current checked-path error from bundle resolution. |

## Testing Strategy

- Test each setup and workbench service against injected fake ports or the existing temporary filesystem and Git fixtures. Keep artifact parser, contract, and result tests independent of Nest.
- Add Nest application integration coverage that starts the actual command modules and verifies provider resolution rather than only manually constructing command classes.
- Exercise the CLI as a subprocess for `--version`, root help, `setup`, `workbench --help`, every workbench command's representative success/negative/error path, invalid option combinations, output streams, and exit codes.
- Run `bun run build` and `bun --bun vitest run`; verify Effect packages, imports, scripts, schemas, and plugins are absent from active project files, and check the lockfile is regenerated.
- Compile all four release targets with the existing `bun build --compile` workflow. Run the Linux x64 binary's version, setup with a sibling bundle, workbench help, and a representative operation.
- Keep the `hamilton-code` and `hamilton-code-feedback` task gates, then use `hamilton-review` and `hamilton-finish-work` for branch review and finish verification.

## Constraints & Boundaries

- Always: pin new dependencies; keep `package.json` and `src/index.ts` versions synchronized; preserve the existing four binary targets and bundle layout; run the full Vitest suite and build before release.
- Never: retain Effect-TS packages or configuration in active project files; change workbench result semantics without an approved requirement change; let workflow judgment move from skills into the CLI.

## Risks / Trade-offs

- **The provider migration broadens a framework refactor across six workbench use cases.** Keep one provider per operation, retain typed results and focused helpers, and use the current integration tests as behavioral regression coverage.
- **Nest decorators and emitted metadata may behave differently in Bun source and compiled execution.** Set the required TypeScript decorator options, include `reflect-metadata` as required by the Nest runtime, and smoke-test the real compiled binary in CI.
- **Nest command parsing may differ at help, missing-argument, and invalid-option boundaries.** Capture the accepted command/option matrix in subprocess tests and compare exit code and output streams against the documented contract.
- **Nest dependencies may increase compiled binary size and cold-start cost.** Record the resulting Linux x64 artifact size during implementation; do not add a size limit without a user requirement.

## Migration / Rollout

No user data or installed settings format changes. The next release replaces the existing standalone executable with the Nest-based executable while retaining the sidecar bundle and install paths. Source contributors continue to use Bun; setup and workbench users retain their current command syntax. The implementation updates the package version and `src/index.ts` together under the repository's release policy.
