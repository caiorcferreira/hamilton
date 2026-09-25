---
artifact: requirements-change
capability: cli-distribution
change: 2026-09-25-replace-effect-cli-with-nestjs
status: draft
created: 2026-09-25
author: Caio Ferreira <caiorcferreira@gmail.com>
decision: accepted
---

# Capability: cli-distribution

## ADDED Requirements

None.

## MODIFIED Requirements

### Requirement: CLI framework and dependency stack

The Hamilton CLI SHALL register and execute its root, setup, and workbench commands through NestJS and `nest-commander`. Current CLI source, tests, package dependencies, package scripts, TypeScript configuration, and active project guidance SHALL contain no Effect-TS framework dependency or Effect-TS-specific tooling.

- Priority: must
- Rationale: One CLI framework and one maintained toolchain prevent stale Effect-TS configuration from remaining after the runtime migration.

#### Scenario: CLI commands use NestJS

- WHEN the CLI entry point is built and invoked with `--help`, `--version`, `setup`, or `workbench`
- THEN NestJS and `nest-commander` initialize and dispatch the requested command

#### Scenario: Effect-TS is absent from active project files

- WHEN the source, tests, package manifests, lockfile, TypeScript configuration, package scripts, and active project instructions are inspected
- THEN they contain no Effect-TS imports, dependencies, or Effect-TS-specific configuration

### Requirement: Standalone executable distribution

The CLI SHALL continue to publish standalone executables for macOS x64, macOS arm64, Linux x64, and Linux arm64. An installed executable SHALL run without Bun, Node, or a Hamilton source checkout and SHALL resolve the bundle from the configured override or its installed sibling. Source-checkout execution SHALL continue to use the checkout bundle, and setup SHALL report the checked locations if no bundle is available.

- Priority: must
- Rationale: The framework migration must preserve the installed-binary contract already relied on by Hamilton users.

#### Scenario: Installed standalone executable

- WHEN a released executable runs from its installed layout with a sibling bundle
- THEN it executes supported commands and setup resolves assets without Bun, Node, or a source checkout

#### Scenario: Missing bundle

- WHEN neither the configured bundle override, installed sibling bundle, nor source-checkout bundle exists
- THEN setup fails and identifies the locations it checked
