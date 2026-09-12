---
artifact: progress
change: <YYYY-MM-DD-change-title>
status: pending | in-progress | blocked | complete
updated: <YYYY-MM-DD>
decision: accepted | rejected | skipped
tasks:
  - id: N
    title: "<task title>"
    status: pending
    progress: tasks/task-N/progress.md
---

<!--
  Progress — root task index for a change.
  Produced by: hamilton-plan (step 2); updated by hamilton-code (step 3).
  Lives at: .hamilton/changes/<change>/progress.md
  Detailed execution history belongs in each linked task progress artifact.
  Allowed task statuses: pending | in-progress | blocked | done
  Delete this instruction block and every inline hint before finalizing.
-->

# Progress: <Change Title>

<!-- Add one `tasks` frontmatter entry per active task in plan order. The frontmatter
     is the machine-readable task ledger; task details remain in linked files. -->
