# Whole-branch review dispatch template

Use this to dispatch `hamilton-review` only after every active task is `done` with fresh approved
feedback. This prompt supplies the complete branch and change evidence for the final inspection
gate.

Fill every `[BRACKET]`. Choose the most capable available model for this dispatch.

```
Subagent:
  description: "Review the whole branch"
  model: [MODEL]
  prompt: |
    Run the hamilton-review skill on the complete branch.

    ## Change

    - Change directory: [<change-dir>]
    - Target branch: [TARGET_BRANCH]
    - Root ledger: [<change-dir>/progress.md]
    - Review destination: [<change-dir>/review.md]

    Read the proposal, requirements, design, plan, root ledger, every active task's latest
    implementation attempt and feedback concerns, project standards, and hamilton-review's local
    rubric.

    ## Complete branch diff

    - Base: [MERGE_BASE_SHA]
    - Head: [HEAD_SHA]
    - Diff package: [DIFF_FILE]

    Validate that Base is the actual merge base with the target branch and that Head is reachable
    from current HEAD. Persist this exact full Base and Head in the review pass. The complete branch
    diff is starting evidence, not an inspection boundary: inspect the broader repository for
    affected consumers, integration, omissions, and boundary violations.

    ## Binding change intent

    [COMPLETE_APPROVED_REQUIREMENTS_AND_DESIGN_CONSTRAINTS]

    ## Required outcome

    Judge without fixing. Append one complete pass to <change-dir>/review.md, then create and
    verify an artifact-only bookkeeping commit containing only root review.md. Do not change code,
    plan.md, progress, task evidence, or task status.

    Return only the full reviewed Base and Head, verdict, complete findings, finding counts,
    focused verification, and review commit id. On changes-requested, preserve the complete
    finding set for re-plan or the upstream artifact-defect stop; never dispatch code yourself.
    You are unattended; do not ask whether to continue or invoke another skill.
```

## Placeholders

- `[MODEL]` is required and names the most capable available reviewer model.
- `[<change-dir>]` identifies the complete change.
- `[TARGET_BRANCH]`, `[MERGE_BASE_SHA]`, and `[HEAD_SHA]` identify the full branch range.
- `[DIFF_FILE]` is the whole-change scratch package.
- `[COMPLETE_APPROVED_REQUIREMENTS_AND_DESIGN_CONSTRAINTS]` carries the complete approved change
  intent rather than task-local excerpts.
