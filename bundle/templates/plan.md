---
artifact: plan
change: <YYYY-MM-DD-change-title>
status: draft | approved | in-progress | complete | blocked
created: <YYYY-MM-DD>
author: <Name <email>>
decision: accepted | rejected | skipped
route_unit: null
---

<!--
  Plan — implementation ledger / "Steps"
  Produced by: hamilton-plan (step 2 of the seven-stage pipeline). Lives at:
  .hamilton/changes/<change>/plan.md
  REQUIRED artifact — the one document every change has. It is the handoff contract
  between planning and coding, for a human OR a Hamilton agent.

  Consumption contract:
    - hamilton-code (step 3) consumes ONE task at a time (a single "### Task" block and its steps)
      and nothing else — it must not read or implement sibling tasks. Keep each task
      self-contained.
    - hamilton-plan initializes the root task index in progress.md and each task's
      tasks/task-N/progress.md. hamilton-code updates only that task's row and log;
      hamilton-code-feedback (step 4) owns tasks/task-N/feedback.md.
    - hamilton-review (step 5) owns the whole-branch review.md after all task feedback;
      hamilton-finish-work (step 6) owns finish.md.
    - Each task is a TDD-sized unit: small enough to implement and verify in isolation,
      carrying its own acceptance check. Specify and execute Red before production edits,
      Green on the same check, and behavior-preserving Refactor with relevant tests afterward.
      Record exact commands and observed results in task-local progress. "Build authentication"
      is too big; "add a user-registration endpoint that validates email format" is right.
    - When a conventional failing behavioral check is technically impossible, the task's Red
      step must give the concrete reason and a repeatable alternative verification that
      distinguishes pre-change and post-change behavior before production edits. Preference
      alone is not an exception. A no-op cleanup still gets a documented Refactor check.
    - `hamilton-code-feedback` supplies the refactor-phase review after the implementation
      commit; the task Steps must not invoke it. Requested changes return the same task to a
      verified Red → Green → Refactor correction cycle, not a new task by default.
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
  Before creating this artifact, read the configured Git identity with `git config user.name` and
  `git config user.email`, then write `author: Name <email>` using both configured values. If either
  configured value is missing, ask the user or stop with a blocker rather than inventing an identity.
  When revising an existing artifact, preserve its recorded author unless the user explicitly directs
  an attribution change.
  Delete this comment block and inline hints before finalizing.
-->

# Plan: <Change Title>

## Overview

- Change: <this plan's change directory, .hamilton/changes/<change>/>
- Route unit: recorded in frontmatter `route_unit`; omit unless the change executes a route unit
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
     "Depends on" expresses logical prerequisites; execution is serial — implementers
     share a working tree. -->

### Task 1: <imperative title>

- Depends on: none
- Files:
  - Created: <paths, or none>
  - Modified: <paths, or none>
  - Deleted: <paths, or none>
- Acceptance:
  - <testable criterion — what "done" means; cite requirement/scenario if one exists>
- Steps:
  1. Red — <write or update a behavioral check, run it before production edits, and observe the intended failure; if a conventional failing check is technically impossible, record the concrete reason and run the planned repeatable alternative before editing production files>
  2. Green — <make the smallest passing implementation, then rerun the same check or alternative to confirm it passes for the intended reason>
  3. Refactor — <perform behavior-preserving cleanup or record why none is needed, then rerun relevant behavioral and regression tests>
  4. If a phase fails for the wrong reason, Verify fails, or feedback is `changes-requested`, record the correction and repeat Red → Green → Refactor with relevant verification in this task; block for re-plan if the correction exceeds Files or Acceptance.
- Verify: `<command after Refactor, plus full tests and build per AGENTS.md>` → <expected result>
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
     Task completion is tracked by the root progress.md index and each linked task log,
     not on the tasks here. -->

- All active tasks are `done` in `progress.md` with task-local Red, Green, and Refactor evidence (or a justified alternative Red).
- Each task has fresh committed `approved` feedback from `hamilton-code-feedback` before the next task or whole-branch review; `changes-requested` returns the same task for correction and another pass.
- `<test command>` passes; build / typecheck is clean.
- Whole-branch review is approved with no blocking findings.
