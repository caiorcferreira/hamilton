---
artifact: finish
change: <YYYY-MM-DD-change-title>
status: pending | completed | blocked
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
strategy: local-merge | pull-request | no-op
result: completed | blocked | pending
decision: accepted | rejected | skipped
---

<!--
  Finish History — completion history for a change.
  Produced by: hamilton-finish-work (step 6).
  Lives at: .hamilton/changes/<change>/finish.md
  Created after the task and whole-branch gates pass.
  Delete this instruction block and every inline hint before finalizing.
-->

# Finish History: <Change Title> <!-- hint: replace with the plan's exact change title -->

## Attempt N — <YYYY-MM-DD> <!-- hint: replace with the next attempt number and current date -->

- Passed preconditions: <gates and verification evidence>
- Specification synchronization: <committed canonical-spec result>
- Strategy: <local merge | pull request | no-op>
- Intended workspace result: <expected branch and tree state>
- Route intent: <route target, or none>
