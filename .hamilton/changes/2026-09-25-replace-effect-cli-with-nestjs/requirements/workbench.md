---
artifact: requirements-change
capability: workbench
change: 2026-09-25-replace-effect-cli-with-nestjs
status: draft
created: 2026-09-25
author: Caio Ferreira <caiorcferreira@gmail.com>
decision: accepted
---

# Capability: workbench

## ADDED Requirements

None.

## MODIFIED Requirements

### Requirement: Workbench command contract

The NestJS command adapters SHALL preserve the documented `hamilton workbench` namespace and all six operations: `isolate`, `diff`, `precondition`, `context`, `prototype`, and `lint`. They SHALL preserve each operation's current accepted arguments and options, validation rules, stdout and stderr behavior, state changes, final load-bearing result lines, and result codes: `0` for success or affirmative results, `1` for normal negative or failed checks, and `2` for usage or environment errors. Lint SHALL retain its explicit file-or-change-directory scope and existing finding behavior.

- Priority: must
- Rationale: Replacing the command framework must not change the CLI contract consumed by Hamilton's skills and users.

#### Scenario: Workbench help

- WHEN a user invokes `hamilton workbench --help`
- THEN help lists `isolate`, `diff`, `precondition`, `context`, `prototype`, and `lint`

#### Scenario: Negative operational result

- WHEN a workbench operation returns a normal negative check
- THEN the CLI returns exit code `1`, preserves the operation's output streams, and emits its load-bearing result line when the operation defines one

#### Scenario: Usage or environment error

- WHEN a workbench invocation has invalid arguments or encounters a usage or environment error
- THEN the CLI returns exit code `2` and preserves the documented error stream and message behavior

#### Scenario: Lint scope

- WHEN lint receives exactly one of `--file <file>` or `--change-dir <dir>`
- THEN it validates only that scope and preserves its current diagnostics and result code

#### Scenario: Invalid lint scope

- WHEN lint receives neither selector, both selectors, or an invalid selector
- THEN it returns exit code `2` without inspecting files outside a valid explicit scope
