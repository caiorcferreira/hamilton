# Code-feedback dispatch template

Use this to dispatch `hamilton-code-feedback` for one exact active task after its root row is
`done` and its latest feedback is absent, malformed, stale, or awaiting evidence-only re-feedback.
The stable task range, task log, and optional located evidence are the complete handoff.

Fill every `[BRACKET]`. Choose the model according to the orchestrator's model roles.

```
Subagent:
  description: "Review Task [N]: [TASK_TITLE]"
  model: [MODEL]
  prompt: |
    Run the hamilton-code-feedback skill for exactly one planned task.

    ## Task

    - Change directory: [<change-dir>]
    - Task id: Task [N]
    - Task log: [<change-dir>/tasks/task-N/progress.md]
    - Feedback destination: [<change-dir>/tasks/task-N/feedback.md]

    Read only Task [N] from plan.md, its cited constraints, its latest physical implementation
    attempt, the supplied package, project standards, and hamilton-code-feedback's local rubric.

    ## Stable task diff

    - Base: [BASE_SHA]
    - Head: [HEAD_SHA]
    - Diff package: [DIFF_FILE]

    Require the package base to equal Task [N]'s recorded checkpoint and persist this exact full
    Base and Head in the feedback pass. Treat the package as the bounded inspection boundary.
    Inspect one concrete named outside risk only under hamilton-code-feedback's rules.

    ## Binding constraints

    [TASK_ACCEPTANCE_AND_CITED_CONSTRAINTS]

    ## Located evidence

    [LOCATED_EVIDENCE_OR_NONE]

    Use `none` for an ordinary feedback pass. A populated value is exact named cross-task evidence
    supplied by the driver after bounded adjudication of a prior `cannot verify from diff`
    Blocking item. Treat it only as supplementary evidence for the same supplied `Head`; it does
    not change the reviewed range or authorize a broader search. Independently judge the item in
    a new physical pass rather than inheriting the prior verdict.

    ## Required outcome

    Judge without fixing. Append one complete pass to
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
- `[LOCATED_EVIDENCE_OR_NONE]` is `none` for an ordinary pass or the exact named cross-task
  evidence that resolves one prior canonical unresolved item for same-Head re-feedback.
