---
artifact: review
change: <YYYY-MM-DD-change-title>
created: <YYYY-MM-DD>
status: open | complete
decision: accepted | rejected | skipped
---

<!--
  Whole-branch Review — verdict for a complete change branch.
  Produced by: hamilton-review (step 5).
  Lives at: .hamilton/changes/<change>/review.md
  Task-scoped feedback belongs in tasks/task-N/feedback.md.
  Delete this instruction block and every inline hint before finalizing.

  Fresh files use identity and lifecycle-only frontmatter with complete pass-local Base, Head, and
  Verdict fields. For the first append to a legacy-global history, validate the legacy-global history
  before one atomic mutation: preserve every existing pass body byte-for-byte, remove exactly the
  global `base`, `head`, and `verdict` fields, and append the next complete pass-local record at the
  physical end in the same mutation. Never copy global provenance into historical passes. Never retain
  global provenance beside an explicit suffix. A fieldless prefix followed by an explicit suffix is
  already transitioned; append normally to that suffix. Fail closed for partial globals, mixed
  global-plus-explicit evidence, missing legacy globals without an explicit suffix, or any fieldless
  pass after the explicit suffix. Never create review-<k>.md.
-->

# Whole-branch Review: <Change Title> <!-- hint: replace with the plan's exact change title -->

## Pass N — <YYYY-MM-DD> <!-- hint: replace with the next pass number and current date -->

Base: <full merge-base commit identifier>
Head: <full head commit identifier>
Verdict: approved | changes-requested | skipped

### Blocking

<!-- hint: use "- None." when approval has no blocking findings -->
- [<file>:<loc>] <what is wrong> — <what to change> (violates: <criterion / standard>)

### Suggestions

<!-- hint: use "- None." when there are no suggestions -->
- [<file>:<loc>] <optional improvement>
