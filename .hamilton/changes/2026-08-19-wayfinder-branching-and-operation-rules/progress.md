<!--
  Progress — execution ledger for a change.
  Lives at: .hamilton/changes/<change>/progress.md
  Records what was ACTUALLY done as the plan is implemented — one entry per task attempt,
  appended by the code step (and optionally the review / finish steps).
  plan.md stays declarative (what to do); progress.md is the log (what happened).
  There is no status field on plan.md tasks — this file is the single source of "done".
-->

# Progress: Wayfinder branching and operation rules

<!-- Newest entries at the bottom. One block per task attempt. -->

## Task 1: Add hamilton-prototype-branch.sh with behavior tests — 2026-08-19

- Outcome: done
- Changed:
  - Created: `bundle/scripts/hamilton-prototype-branch.sh`, `tests/scripts/prototype-branch.test.ts`
  - Modified: none
  - Deleted: none
- Verified: `bun --bun vitest run tests/scripts/prototype-branch.test.ts` → 8/8 passed; `bun run build` → clean
- Notes: `bun --bun vitest run` (full suite) shows exactly one pre-existing failure, `tests/cli/setup.test.ts > returns installed script filenames`, because that file's hardcoded expected-scripts list does not yet include `hamilton-prototype-branch.sh` — this is Task 2's job per plan.md ("Register the new script in setup expectations and docs"), not touched here per the one-task boundary. `plan.md` was created by the prior planning session but never committed; it is included in this commit since Task 1 is the first commit after planning and no later task's Files list covers it.

## Review: Task 1 — 2026-08-19
- Verdict: approved (blocking: 0, suggestions: 2) — see review.md

## Task 2: Register the new script in setup expectations and docs — 2026-08-19

- Outcome: done
- Changed:
  - Created: none
  - Modified: `tests/cli/setup.test.ts`, `docs/skills.md`
  - Deleted: none
- Verified: `bun --bun vitest run tests/cli/setup.test.ts` → 15/15 passed; `bun --bun vitest run` → 98/98 passed; `bun run build` → clean
- Notes: Added `hamilton-prototype-branch.sh` to the expected-scripts list in tests/cli/setup.test.ts in alphabetical order (5th script). Updated docs/skills.md: changed "four scripts" to "five scripts", updated "Three properties hold across all four" to "Three properties hold across all five", and added the table row describing the script's functionality and called-by relationship to `wayfinder-prototype`.

## Review: Task 2 — 2026-08-19
- Verdict: approved (blocking: 0, suggestions: 0) — see review.md

## Task 3: Add branch field and Operation rules section to the map template — 2026-08-19

- Outcome: done
- Changed:
  - Created: none
  - Modified: `bundle/templates/wayfinder/map.md`
  - Deleted: none
- Verified: `grep -n "branch:\|Operation rules" bundle/templates/wayfinder/map.md` → both present (lines 13 and 30), Operation rules positioned between Notes and Decisions so far; `bun --bun vitest run` → 98/98 passed; `bun run build` → clean
- Notes: Added `branch:` field to frontmatter (line 13) with explanatory hint comment after the frontmatter block. Inserted `## Operation rules` section (line 30) with detailed hint comment explaining its purpose (prescriptive, per-session-binding rules) and distinguishing it from Notes. Preserved the template's idiom: HTML comment block, YAML frontmatter, inline `<!-- hint: ... -->` comments for sections, delete-before-finalizing convention. All sections now in required order: Destination, Notes, Operation rules, Decisions so far, Not yet specified, Out of scope.
