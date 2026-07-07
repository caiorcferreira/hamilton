<!--
  Plan — implementation ledger / "Steps"
  Produced by: hamilton-plan (step 2).  Lives at: .hamilton/changes/<change>/plan.md
  REQUIRED artifact — the one document every change has. It is the handoff contract
  between planning and coding, for a human OR a Hamilton agent.

  Consumption contract:
    - hamilton-code consumes ONE task at a time (a single "### Task" block and its steps)
      and nothing else — it must not read or implement sibling tasks. Keep each task
      self-contained.
    - Each task is a TDD-sized unit: small enough to implement and verify in isolation,
      carrying its own acceptance check. "Build authentication" is too big;
      "add a user-registration endpoint that validates email format" is right.
    - Reference upstream artifacts (design.md, requirements/) — do not copy them. Even
      when the pipeline starts at this step, plan.md still lives in a change directory;
      if there are no upstream docs, state the minimal why/what inline.
    - Detail scales to risk and executor: include code or exact commands when they remove
      ambiguity; otherwise state intent and let the coder think. Do not pre-write the
      whole diff. Any snippet you do include is copied verbatim by the coder — make it model
      the clean shape (cohesive, testable, no shortcut), never a throwaway.
    - Task seams follow the design's structure: each task lands one cohesive unit that can be
      tested in isolation, and its acceptance covers the error/edge behavior, not just the
      happy path. A task you cannot state without "and" is usually two.
  Delete this comment block and inline hints before finalizing.
-->

# Plan: <Change Title>

## Overview

- Change: <this plan's change directory, .hamilton/changes/<change>/>
- Goal: <1–2 sentences — what this plan delivers and why>
- Test: `<command that runs the test suite>`
- Build / typecheck: `<command>`
- Context notes: <only the relevant slice — key constraints, files, patterns. Reference
  AGENTS.md / design.md instead of duplicating them.>
- Quality notes: <how the task breakdown preserves the design's structure, and any
  structural smell accepted on purpose (with why). One line, or "none" for a trivial change.
  This is the plan's blocking record — an unresolved smell that is neither re-sliced away nor
  recorded here fails the self-review.>

## Tasks

<!-- Numbered for stable reference (hamilton-code is pointed at "Task 3").
     Independent tasks may run in parallel — express ordering via "Depends on". -->

### Task 1: <imperative title>

- Depends on: none
- Files:
  - Created: <paths, or none>
  - Modified: <paths, or none>
  - Deleted: <paths, or none>
- Acceptance:
  - <testable criterion — what "done" means; cite requirement/scenario if one exists>
- Steps:
  1. <write a failing test for the behavior>
  2. <implement it>
  3. <run `test` — expect green>
- Verify: `<command>` → <expected result>
- Commit: `<type: message>`

### Task 2: <imperative title>

- Depends on: Task 1
- Files:
  - Created:
  - Modified:
  - Deleted:
- Acceptance:
  -
- Steps:
  1.
- Verify:
- Commit:

## Done when

<!-- Plan-level definition of done — checked by hamilton-finish-work.
     Task completion is tracked in progress.md, not on the tasks here. -->

- All tasks implemented (recorded in progress.md)
- `<test command>` passes; build / typecheck is clean
- All review feedback has been addressed
