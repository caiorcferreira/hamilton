<!--
  Progress — execution ledger for a change.
  Lives at: .hamilton/changes/<change>/progress.md
  Records what was ACTUALLY done as the plan is implemented — one entry per task attempt,
  appended by the code step (and optionally the review / finish steps).
  plan.md stays declarative (what to do); progress.md is the log (what happened).
  There is no status field on plan.md tasks — this file is the single source of "done".
-->

# Progress: <Change Title>

<!-- Newest entries at the bottom. One block per task attempt. -->

## <Task id>: <title> — <YYYY-MM-DD>

- Outcome: done | blocked
- Changed:
  - Created: <paths, or none>
  - Modified: <paths, or none>
  - Deleted: <paths, or none>
- Verified: `<command>` → <result>
- Notes: <deviations, decisions, anything to flag for review>
