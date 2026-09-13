---
artifact: requirements-spec
capability: workbench
status: current
updated: 2026-09-13
author: Hermes Agent
decision: accepted
---

# Capability: workbench

## Overview

The workbench is Hamilton's distributed CLI surface for workflow mechanics formerly provided by installed shell helpers and for explicitly scoped validation of Hamilton artifacts. It gives Assisted skills native operations for workspace isolation, diff packaging, finish gates, change context, prototype branches, and artifact linting without moving workflow judgment into the CLI.

## Contract

### Operations

| operation | purpose |
| ----------- | --------- |
| `hamilton workbench isolate` | Check, create, and verify an isolated linked worktree or non-default-branch workspace. |
| `hamilton workbench diff` | Record task checkpoints and package task, explicit-base, or whole-change ranges. |
| `hamilton workbench precondition` | Evaluate clean-tree, test, task, feedback, review, freshness, and ancestry gates for a change. |
| `hamilton workbench context` | Report artifact inventory, task standings, feedback, review freshness, and unsupported legacy format for one or all changes. |
| `hamilton workbench prototype` | Create, resume, switch to, and verify prototype branches in mapped or standalone mode. |
| `hamilton workbench lint` | Validate one explicitly selected file or a recursively selected change directory. |

### Lint selectors

`hamilton workbench lint` accepts exactly one of `--file <file>` and `--change-dir <dir>`. The file selector names one regular file. The change-directory selector recursively considers regular files contained within the supplied Hamilton change directory and does not inspect outside files.

### Result contract

Workbench operations return `0` for success or an affirmative result, `1` for a negative or failed check that is part of normal operation, and `2` for usage or environment errors. Operations with load-bearing results emit a final machine-readable result line. Lint distinguishes errors, warnings, and skipped files and returns `0` only when no errors or warnings remain.

## Behavior

The workbench preserves the stateful behavior and argument meanings of the former Hamilton-owned helper operations. Isolation and prototype operations validate repository state before changing branches or worktrees. Diff validates task and artifact checkpoints before recording or packaging ranges. Context reports current split artifacts and identifies unsupported legacy layouts. Preconditions run the supplied test command and evaluate committed task, feedback, review, freshness, clean-tree, and ancestry evidence without inferring a waiver.

Lint validates only its explicit scope. A file selector validates the named regular file. A change-directory selector traverses regular files below the directory, remains within that directory, does not follow outside-target symlinks, and reports paths deterministically. Frontmatter is read first and selects the artifact contract; the contract then validates required metadata, identity, lifecycle, task, verdict, revision, route, link fields, headings, sections, and append-only records as applicable. Instruction comments do not satisfy body requirements.

A conventional Hamilton artifact filename without valid opening frontmatter produces a warning and a failing result. Malformed YAML, duplicate or missing required metadata, unsupported artifact values, path or identity mismatches, and malformed body structure produce file-specific errors. Unrelated files are reported as skipped and do not fail lint. Invalid selectors or unreadable input paths return a usage or environment error without inspecting the selected scope.

**Examples**

- isolation check on the default branch without a worktree -> exit `1` with final result `isolated: no`
- valid workbench operation -> exit `0` with its load-bearing result line
- invalid option or argument combination -> exit `2` without performing the operation
- `lint --file <file>` -> only the named regular file is validated
- `lint --change-dir <dir>` -> regular files below the directory are considered, while sibling changes and outside targets are not
- lint without a selector or with both selectors -> exit `2` without inspecting anything
- malformed recognized artifact -> file-specific error and exit `1`
- conventional artifact filename without frontmatter -> warning and exit `1`
- unrelated file -> skipped report and no failure
- all recognized artifacts valid, with unrelated files skipped -> successful lint and exit `0`

## Invariants

- Every stateful workbench operation MUST validate its precondition before mutation.
- Lint MUST require exactly one explicit scope selector.
- Lint MUST NOT inspect files outside the supplied change directory or follow symlinks to outside targets.
- Frontmatter MUST be authoritative for recognized artifact identity and metadata.
- Malformed or missing required artifact metadata and body structure MUST fail closed.
- Skipped unrelated files MUST NOT affect lint success.
- Workbench operations MUST preserve the `0`/`1`/`2` result semantics and load-bearing result lines of the replaced helpers.
- The workbench MUST NOT make workflow decisions owned by skills.

## Decisions

- A namespaced workbench groups cohesive mechanics while explicit subcommands preserve established invocation semantics.
- Native typed modules are the maintained implementation; shell helpers are not retained as a compatibility surface.
- Frontmatter is the dispatch boundary, while body parsing is limited to the declared structural contract.
- Lint uses explicit file or change-directory scope to prevent accidental repository-wide inspection and reports unrelated files as skipped.
- The contract registry captures durable metadata and body rules without duplicating template instruction text.
- Existing helper files are left untouched during setup and can be removed only through an explicit purge operation.
