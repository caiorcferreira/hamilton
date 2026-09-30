# Code-feedback dispatch template

Use this to dispatch `kepler-code-feedback` for one exact active task after its root row is
`done` and its latest feedback is absent, malformed, stale, or awaiting evidence-only re-feedback.
The stable task range, task log, and optional located evidence are the complete handoff. The
review dispatch supplies task acceptance, the stable task diff, project standards, task-local TDD
evidence, and bounded located-risk context.

Fill every `[BRACKET]`. Choose the model according to the orchestrator's model roles.

```
Subagent:
  description: "Review Task [N]: [TASK_TITLE]"
  model: [MODEL]
  prompt: |
    Run the kepler-code-feedback skill for exactly one planned task.

    ## Task

    - Change directory: [<change-dir>]
    - Task id: Task [N]
    - Task log: [<change-dir>/tasks/task-N/progress.md]
    - Feedback destination: [<change-dir>/tasks/task-N/feedback.md]
    - Project standards: [PROJECT_STANDARDS]
    - Task-local TDD evidence: [TDD_EVIDENCE]

    Read only Task [N] from plan.md, its cited constraints, its latest physical implementation
    attempt, the supplied package, project standards, and kepler-code-feedback's local rubric.

    ## Stable task diff

    - Base: [BASE_SHA]
    - Head: [HEAD_SHA]
    - Diff package: [DIFF_FILE]

    Run `kepler workbench lint --change-dir <change-dir>` before interpreting existing artifacts;
    only lint decides whether their format is valid. Require the package base to equal Task [N]'s
    recorded checkpoint. Follow kepler-code-feedback's evidence, review, append, and commit rules;
    do not impose a second template or pass-shape validator on a lint-valid history. Treat the
    package as the bounded inspection boundary. Inspect one concrete named outside risk only under
    kepler-code-feedback's rules.

    ## TDD refactor handoff

    This dispatch is the task's refactor-phase review. Judge the supplied task-local
    red/green/refactor evidence, or its justified exception and repeatable alternative
    verification, as part of the behavior-preserving review. A correction must include relevant
    verification before a fresh feedback pass can approve it.

    ## Binding constraints

    [TASK_ACCEPTANCE_AND_CITED_CONSTRAINTS]

    ## Located evidence

    This is bounded located-risk context, supplied only when the driver has adjudicated a named
    risk under the feedback rules.

    [LOCATED_EVIDENCE_OR_NONE]

    Use `none` for an ordinary feedback pass. A populated value is exact named cross-task evidence
    supplied by the driver after bounded adjudication of a prior `cannot verify from diff`
    Blocking item. Treat it only as supplementary evidence for the same supplied `Head`; it does
    not change the reviewed range or authorize a broader search. Independently judge the item in
    a new physical pass rather than inheriting the prior verdict.

    ## Required outcome

    Judge without fixing. A `changes-requested` refactor-phase review returns the same Task [N] to
    `kepler-code`; relevant verification is required before a fresh
    `kepler-code-feedback` pass. Append one complete pass to
    <change-dir>/tasks/task-N/feedback.md, then create and verify an artifact-only bookkeeping
    commit containing only that feedback file. Do not change code, plan.md, either progress file,
    the root task status, or a sibling artifact.

    Return only the task id, full reviewed Base and Head, verdict, finding counts, and feedback
    commit id. You are unattended; do not ask whether to continue or invoke another skill.
```

## Placeholders

- `[MODEL]` is required for every dispatch.
- `[<change-dir>]`, `[N]`, and `[TASK_TITLE]` identify one exact active task.
- `[BASE_SHA]` and `[HEAD_SHA]` are the full range printed by the task diff package.
- `[DIFF_FILE]` is the scratch package produced for Task `[N]`.
- `[TASK_ACCEPTANCE_AND_CITED_CONSTRAINTS]` is copied verbatim from that task and its cited
  requirements or design sections.
- `[PROJECT_STANDARDS]` supplies the applicable project standards for the task.
- `[TDD_EVIDENCE]` supplies the task-local red/green/refactor evidence or justified exception.
- `[LOCATED_EVIDENCE_OR_NONE]` is `none` for an ordinary pass or the exact named cross-task
  evidence that resolves one prior canonical unresolved item for same-Head re-feedback.
