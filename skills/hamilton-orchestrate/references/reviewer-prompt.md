# Reviewer dispatch template

Use this when dispatching the per-task reviewer, and again for the final whole-branch review.
The subagent's whole job is to run the **hamilton-review** skill on a diff and return a
verdict with located feedback. It judges only — it never edits code or `plan.md`.

Fill every `[BRACKET]`. Choose the model per the SKILL's **Model selection** — standard for a
task diff scaled to its risk, most capable for the final whole-branch review.

```
Subagent:
  description: "Review Task [N]" | "Review whole branch"
  model: [MODEL — REQUIRED: standard for a task diff; most capable for the final review]
  prompt: |
    Run the hamilton-review skill to review one diff and return a verdict with feedback
    precise enough to act on without guessing.

    ## Change

    - Change directory: [.hamilton/changes/<change>/]
    - Read plan.md for what was intended, and design.md / requirements/ (if present) for the
      acceptance criteria. For a per-task review, judge only Task [N]; for the final review,
      judge the whole change.

    ## Diff under review

    - Base: [BASE_SHA]
    - Head: [HEAD_SHA]
    - Diff package: [DIFF_FILE]

    Read the diff package once — it holds the commit list, a stat summary, and the full diff
    with context. That is your view of the change; do not crawl the broader codebase except
    to check one concrete, named risk. This review is read-only: do not mutate the working
    tree, index, HEAD, or branch state.

    ## What the implementer claims

    Read the implementer's report: [REPORT_FILE]. Treat it as unverified claims — verify
    against the diff. A stated rationale ("kept it simple per YAGNI") never downgrades a
    finding's severity. The implementer already ran the tests; do not re-run the suite to
    confirm the report — run a focused test only when the code raises a specific doubt.

    ## Binding constraints from the plan

    [Copy verbatim from the plan's Global Constraints / Quality notes (or the design): exact
    values, formats, and the stated relationships between components. This is the attention
    lens. hamilton-review's own rubric already carries the process rules — do not add "check
    all uses" or "run race tests" without a concrete, task-specific reason, and never tell
    the reviewer what not to flag or pre-rate a severity.]

    ## Return

    A verdict (approved | changes requested), and for every issue a file:line, what is wrong,
    why it matters, and what to change — separating blocking issues from suggestions. Report
    a requirement you cannot verify from the diff alone as a "cannot verify from diff" item
    rather than broadening the search; the controller resolves those with cross-task context.

    You are running unattended as a subagent — there is no person in this loop. Do not pause
    to ask whether to proceed; hamilton-review's Handoff returns without asking here. Return
    your verdict and feedback.
```

**Placeholders**

- `[MODEL]` — required; per the SKILL's Model selection.
- `[.hamilton/changes/<change>/]` — the change directory.
- `[N]` — the task under review (omit for the final whole-branch review).
- `[BASE_SHA]` — for a task, the BASE recorded before the implementer ran; for the final
  review, `git merge-base <default-branch> HEAD`. Never `HEAD~1`.
- `[HEAD_SHA]` — current commit.
- `[DIFF_FILE]` — the uniquely named diff package the controller wrote (`git diff --stat` +
  `git diff -U10` for the range).
- `[REPORT_FILE]` — the implementer's report file for this task.
