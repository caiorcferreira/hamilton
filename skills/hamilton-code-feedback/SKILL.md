---
name: hamilton-code-feedback
description: "Review exactly one Task N within its stable diff, record task-owned tactical feedback, and commit only that feedback artifact."
---

# Reviewing one implemented task

Review exactly one implemented plan task within its stable diff, decide a tactical verdict,
and persist that verdict in the task-owned feedback history.

The **seven-stage core pipeline** is Hamilton's fixed spec-driven sequence: init → propose → plan → code →
code-feedback → review → finish-work. This skill is **step 4**, the tactical gate between task
implementation and whole-branch review. Wayfinder and `hamilton-critique` are optional and remain
outside the seven-step core count.

**Judge, do not fix.** Inspect and report. Never modify implementation, tests, plan artifacts,
or task status while performing code feedback.

## Inputs

Every invocation supplies exactly one existing active `Task N` from the change's `plan.md` and:

- The task block, including its acceptance criteria and cited constraints.
- A stable task diff package from the task's unchanged
  `<change-dir>/tasks/task-N/.base` checkpoint through the implementation head. The package must
  state the full base and head commit identifiers and include the changed paths and diff.
- The task's latest implementation evidence from
  `<change-dir>/tasks/task-N/progress.md`. This is the detailed claim source; no separate
  implementer report is required.
- The binding requirements and design constraints cited by the task.
- The change directory path.
- Project standards from `AGENTS.md` or its repository equivalent.

The numeric identity controls every task path. Never infer identity from a title, accept multiple
tasks, or read a sibling task's evidence.

## References

This skill ships with its own `references/code-quality.md`. Read it from this skill directory and
apply it proportionately to the task diff. It is the only structural-quality rubric needed by this
skill.

## Generation preflight

Run this no-write gate before task-scope inspection, diff validation, or verdict mutation. A change
directory with no `plan.md` is `pre-plan`, not legacy; stop because no planned task can be reviewed,
but do not classify or scaffold it as an unsupported generation.

Once `plan.md` exists, require the exact split root task ledger and every required active-task
scaffold artifact. Root `<change-dir>/progress.md` must be the exact task-only table, with one
`Task | Status | Progress` column set, exactly one plan-ordered row per active task, a status from
`pending`, `in-progress`, `blocked`, or `done`, and the exact `tasks/task-N/progress.md` link. Each
linked
`<change-dir>/tasks/task-N/progress.md` must exist with matching numeric task identity. Reject a
monolithic root progress file, missing scaffold, partially scaffolded or otherwise partially split
layout, alternate task path, or mixed execution and verdict history as `legacy-unsupported`. Stop
with between-changes upgrade guidance: finish the old change under its old installation or upgrade
the complete Hamilton generation and run `hamilton setup` between changes. Never parse, migrate,
reconstruct, or partially scaffold that layout, and never create, append, change, or write feedback
when this gate fails.

An absent assigned `feedback.md` is a valid creation-time state after the split scaffold passes;
the first successful feedback pass creates it. If it already exists, its path and task identity
must match the assigned task. Feedback files for tasks that have not reached feedback are not
planning scaffold. Only after this preflight succeeds may the task-specific scope and evidence
checks below run.

## Wrong scope

Before inspection, require one exact positive numeric `Task N` that occurs once as an active plan
task and matches the diff package, checkpoint, task progress heading, and destination path. A
missing id, multiple ids, an abandoned task, a task-only identity mismatch, or whole-branch input
is wrong scope. Stop without recording a verdict or changing any artifact. For whole-branch work,
direct the caller to `hamilton-review`.

## Bounded inspection

The stable task diff package is the inspection boundary. Judge the changed lines against the
task's acceptance criteria, cited requirements and design constraints, latest task-local
implementation claims, project standards, and this skill's quality rubric.

Do not crawl the broader repository. When changed code raises one concrete, named risk in an
unchanged consumer or contract, inspect only that named location and no unrelated repository
area. Identify the causal changed location and the exact outside location inspected. If that
single check does not resolve the impact, report it as `cannot verify from diff`; do not widen the
search.

## Process

1. Run the generation preflight and stop without inspection or writes unless it succeeds.
2. Validate the exact task identity and reject wrong-scope input before inspection or writes.
3. Validate the diff package and checkpoint. Require full commit identifiers, require the package
   base to equal the task's recorded checkpoint, and require base to be an ancestor of head and
   head to be an ancestor of current `HEAD`. Stop on a missing, malformed, inverted, unreachable,
   or mismatched range.
4. Read only the assigned task block, its cited binding constraints, project standards, the latest
   physical attempt in that task's progress file, the supplied diff package, and this skill's
   local rubric. Confirm every nested task identity equals the requested `Task N`.
5. Inspect the complete task diff for correctness, meaningful tests, security, project idioms,
   structural quality, scope, hygiene, and boundary compliance. Follow the bounded-inspection rule
   for any concrete outside risk.
6. Check every acceptance criterion and every latest implementation claim against located diff or
   permitted-risk evidence. Claims never substitute for the diff.
7. Decide `approved` or `changes-requested` under the verdict rules.
8. Append one complete pass to the assigned task's feedback history, then make and verify the
   artifact-only bookkeeping commit before handoff.

## Review dimensions

- **Correctness:** Every acceptance criterion and cited constraint is satisfied, including failure
  paths and edge cases represented by the task.
- **Tests:** Tests exercise observable behavior and would fail if the implementation regressed;
  none were deleted or weakened to force a pass.
- **Security:** The diff adds no secret, unsafe input handling, injection path, or sensitive output.
- **Idioms and standards:** Naming, structure, error handling, and style follow project standards.
- **Structural quality:** The changed code satisfies the local task-diff quality rubric without
  speculative redesign.
- **Scope and hygiene:** Every changed path belongs to the assigned task; there are no stubs, dead
  code, debug output, TODOs, commented-out blocks, or unrelated edits.
- **Boundaries:** The implementation does not cross a boundary forbidden by the plan or design.

Every finding names the exact file and location, explains the defect and required correction, and
cites the violated criterion or standard. Suggestions are optional improvements and never disguise
an unresolved requirement.

## Verdicts

Use only these verdicts:

- `approved` when all acceptance criteria and binding constraints are verified, the reviewed range
  is valid, and Blocking contains no findings.
- `changes-requested` when any correctness, test, security, standards, scope, boundary, or structural
  defect blocks acceptance.

Every unresolved `cannot verify from diff` item is a blocking finding under `changes-requested`
until located evidence or code resolves it. Never issue `approved` while such an item remains
unresolved, and never demote it to Suggestions. The driver may either return a confirmed code gap
to the same task's code step or provide located evidence and dispatch a new feedback pass against
the same head. Only a new complete pass without the unresolved item may approve.

## Feedback artifact

Write only `<change-dir>/tasks/task-N/feedback.md`; the task directory segment is lowercase
`task-N`. Load the exact installed `~/.hamilton/templates/feedback.md` template on every pass. When
the file does not exist, instantiate a complete copy with the exact task id, title, current date,
next pass number, full reviewed identifiers, verdict, and findings. Remove the opening instruction
block and every inline hint while substituting placeholders; neither authoring instructions nor
hints may survive in the live artifact.

When the file exists, validate it first, then use the cleaned record portion of that same installed
template to append the next-numbered pass at the physical end. Preserve the task identity heading
and every prior pass. A retained leading template instruction block or inline hint is authoring
markup rather than verdict history: remove that markup before appending, but do not change, delete,
reorder, or insert within any prior pass. Populate every template-defined value. An approval has no
blocking findings and may briefly record useful verified coverage as a suggestion; both findings
groups remain present. Every pass records the supplied full Base and Head values, never abbreviated
commit ids.

The physically last pass governs. It is valid only when task identity, pass numbering and shape,
verdict, findings, and reviewed range are complete and consistent. An `approved` pass with a
blocking item is contradictory. A malformed last pass must fail closed; never scan backward or fall
back to an earlier approval. Apart from the one-time removal of retained template authoring markup,
do not rewrite, delete, reorder, or insert before an existing pass.

## Record and commit

After appending the complete pass, create an artifact-only bookkeeping commit containing only
`tasks/task-N/feedback.md`. Commit no code or sibling task artifact. Verify the commit's path list
before handoff; if it includes any other path, stop and report the invalid commit rather than
advancing.

Never write root `<change-dir>/progress.md`. Never write
`<change-dir>/tasks/task-N/progress.md`. Never change the root task status. Feedback history belongs
only in the feedback artifact, even when the verdict is `changes-requested`.

## Output and handoff

Return the task identity, full reviewed Base and Head, verdict, blocking count, suggestion count,
and feedback commit identifier. Do not create a separate detailed report.

For `approved`, return control to the driver so it can select the next task for `hamilton-code` or,
after every task is approved, enter whole-branch `hamilton-review`. For ordinary
`changes-requested`, the driver returns the same task to code. For an unresolved
`cannot verify from diff` blocker, the driver adjudicates only the named risk and then supplies
located evidence for another feedback pass or sends a confirmed gap to code. Never invoke another
pipeline skill yourself.
