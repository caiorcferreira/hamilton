# Implementer dispatch template

Use this to dispatch `hamilton-code` for one exact active task, either for its first attempt or
after fresh task feedback requests changes. The task's root row is current state; its task-local
progress file is the only detailed implementation report.

Fill every `[BRACKET]`. Choose the model according to the orchestrator's model roles.

```
Subagent:
  description: "Implement Task [N]: [TASK_TITLE]"
  model: [MODEL]
  prompt: |
    Run the hamilton-code skill for exactly one planned task.

    ## Task

    - Change directory: [<change-dir>]
    - Task id: Task [N]
    - Root ledger row: [<change-dir>/progress.md row for Task N]
    - Task log: [<change-dir>/tasks/task-N/progress.md]
    - Task checkpoint: [<change-dir>/tasks/task-N/.base]

    Read only Task [N] from plan.md, its cited constraints, the root row named above, and this
    task's own evidence. Do not read or touch a sibling task. Follow the task's Steps exactly;
    do not redesign, reorder, or add work.

    ## Context

    [ONE_LINE_CONTEXT]
    [EARLIER_INTERFACES_OR_DECISIONS_NEEDED_BY_THIS_TASK]

    ## Feedback for this attempt

    [FIRST_ATTEMPT_OR_READ_THE_LATEST_PHYSICAL_PASS_AT_<change-dir>/tasks/task-N/feedback.md]

    ## Required outcome

    The orchestrator has already established the checkpoint. Validate and preserve the
    already-recorded task-local checkpoint; never create, reset, reconstruct, or replace it.
    Follow hamilton-code completely: transition only Task [N]'s root row, execute and verify the
    task, append exactly one canonical attempt to the task log, and commit the implementation plus
    that synchronized evidence with the task's specified commit message. Leave plan.md, sibling
    evidence, and feedback untouched.

    The task log is the detailed report. Return only concise status and commit information:
    - Status: done | blocked
    - Commit created: full SHA and subject, or none
    - Test summary: one line
    - Concerns: one line, or none

    You are unattended. Do not ask whether to continue and do not invoke the next pipeline
    skill. If a specified step is impossible, use hamilton-code's canonical blocked path.
```

## Placeholders

- `[MODEL]` is required for every dispatch.
- `[<change-dir>]`, `[N]`, and `[TASK_TITLE]` identify one exact active task.
- `[ONE_LINE_CONTEXT]` supplies only scene-setting information the task cannot derive.
- `[EARLIER_INTERFACES_OR_DECISIONS_NEEDED_BY_THIS_TASK]` supplies only required established
  interfaces or decisions.
- `[FIRST_ATTEMPT_OR_READ_THE_LATEST_PHYSICAL_PASS_AT_<change-dir>/tasks/task-N/feedback.md]`
  says `First attempt; no feedback input` or directs a correction to the task's physically last,
  fresh `changes-requested` pass.
