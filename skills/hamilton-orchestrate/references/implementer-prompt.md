# Implementer dispatch template

Use this when dispatching the implementer subagent for one task. The subagent's whole job is
to run the **hamilton-code** skill on a single task, by reference. Hand it the plan path and
the task id — not the plan's contents — so `hamilton-code` reads only its own task.

Fill every `[BRACKET]`. Choose the model per the SKILL's **Model selection** — an omitted
model silently inherits the controller's most expensive one.

```
Subagent:
  description: "Implement Task [N]: [task title]"
  model: [MODEL — REQUIRED: cheap floor for transcription-plus-testing tasks; standard for
          multi-file / integration tasks]
  prompt: |
    Run the hamilton-code skill to implement exactly one planned task.

    ## Task (by reference)

    - Change directory: [.hamilton/changes/<change>/]
    - Task id: Task [N]

    Read that task from plan.md in the change directory and implement it by following its
    Steps exactly. Do not read or touch any sibling task. Do not redesign, reorder, or add
    work — the plan already did the design.

    ## Context you need that the task cannot know

    [One line on where this task fits in the change.]
    [Interfaces, signatures, or decisions established by earlier tasks that this task builds
    on — the fresh subagent has none of this session's history.]
    [Your resolution of any ambiguity you noticed in the task text.]

    ## Review feedback to address (only on a re-dispatch)

    [Omit on the first pass. On a re-dispatch after review: paste the reviewer's located
    findings verbatim. hamilton-code treats prior-pass feedback as an input and addresses it
    within this same task.]

    ## Your job

    Follow hamilton-code: execute the Steps in order, verify (task Verify + full suite +
    build), check acceptance, run the code-quality self-review, append the progress.md entry,
    and commit with the task's Commit message — the commit must include the change-dir updates
    (progress.md and any other change-dir artifact touched), leaving nothing uncommitted under
    the change directory. If a step is impossible or the task looks wrong, stop and report —
    do not improvise.

    ## Report

    Write your full report to [REPORT_FILE], then return ONLY (under 15 lines):
    - Status: done | blocked
    - Commits created (short SHA + subject)
    - One-line test summary (e.g. "14/14 passing, output pristine")
    - Concerns, if any
    - The report file path

    If blocked, put the specifics in the final message itself — the controller acts on it
    directly. Never silently produce work you are unsure about.
```

**Placeholders**

- `[MODEL]` — required; per the SKILL's Model selection.
- `[.hamilton/changes/<change>/]` — the change directory holding `plan.md` and `progress.md`.
- `[N]` / `[task title]` — the task's stable number and title from `plan.md`.
- `[REPORT_FILE]` — a uniquely named report file for this task (e.g. `…/task-N-report.md`).
