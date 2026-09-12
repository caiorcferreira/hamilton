---
artifact: feedback
change: <YYYY-MM-DD-change-title>
task: <N>
created: <YYYY-MM-DD>
status: open | resolved
verdict: approved | changes-requested | skipped
decision: accepted | rejected | skipped
base: <full commit identifier>
head: <full commit identifier>
---

<!--
  Code Feedback — review history for one plan task.
  Produced by: hamilton-code-feedback (step 4).
  Lives at: .hamilton/changes/<change>/tasks/task-N/feedback.md
  Whole-branch review belongs in review.md.
  Delete this instruction block and every inline hint before finalizing.
-->

# Code Feedback: Task N — <title> <!-- hint: replace with the exact plan task id and title -->

## Pass N — <YYYY-MM-DD> <!-- hint: replace with the next pass number and current date -->

<!-- Review metadata is recorded in frontmatter. -->

### Blocking

<!-- hint: use "- None." when approval has no blocking findings -->
- [<file>:<loc>] <what is wrong> — <what to change> (violates: <criterion / standard>)

### Suggestions

<!-- hint: use "- None." when there are no suggestions -->
- [<file>:<loc>] <optional improvement>
