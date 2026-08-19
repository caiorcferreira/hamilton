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

## Review: Task 3 — 2026-08-19
- Verdict: approved (blocking: 0, suggestions: 0) — see review.md

## Task 4: Add Shipping rules section to the route template — 2026-08-19
- Outcome: done
- Changed: modified `bundle/templates/wayfinder/route.md`
- Verified: `grep -n "Shipping rules\|## Units" bundle/templates/wayfinder/route.md` → Shipping rules (line 16) before Units (line 23); `bun run build` → clean; `bun --bun vitest run` → 8 files, 98 tests passed
- Notes: Added `## Shipping rules` section with inline hint explaining how units will be shipped, including branch merge-back target (seeded from map's `branch:` field), commit/merge/PR conventions, and shipping-relevant operation rules. Template idiom preserved (HTML comments, delete-before-finalizing idiom). No frontmatter added per acceptance criteria.

## Review: Task 4 — 2026-08-19
- Verdict: approved (blocking: 0, suggestions: 0) — see review.md

## Task 5: Gate the prototype skill on the prototype branch — 2026-08-19
- Outcome: done
- Changed: modified `skills/hamilton-wayfinder-prototype/SKILL.md`
- Verified: `grep -n "prototype-branch\|Branch gate\|prototype/<" skills/hamilton-wayfinder-prototype/SKILL.md` → gate section, script call, and branch format all present; `bun --bun vitest run` → 8 files, 98 tests passed; `bun run build` → clean
- Notes: Added a `## Branch gate` section between "Pick the shape" and "Rules that apply to every prototype", instructing the create/resume/verify calls to `~/.hamilton/scripts/hamilton-prototype-branch.sh` for both the map-ticket and `--standalone` cases, with the manual `git switch -c` fallback matching hamilton-propose's isolate pattern, and the "no prototype code before this gate" rule stated plainly. Rewrote rule 6 ("Capture it when done") to commit-and-return: commit outstanding prototype work on the `prototype/...` branch, switch back to the starting branch, and fold the validated decision into the real artifact there — no longer "move to a throwaway branch" as a closing act, since the branch gate already put the code on its own branch from the start. Updated the process-flow digraph with a "Branch gate" node between "Pick the shape" and "Build throwaway", and relabeled the terminal node "Commit + return" to match the new closing shape.

## Review: Task 5 — 2026-08-19
- Verdict: approved (blocking: 0, suggestions: 0) — see review.md

## Task 6: Wayfinder charting records branch and operation rules; mechanics gains the branch field — 2026-08-19
- Outcome: done
- Changed: modified `skills/hamilton-wayfinder/SKILL.md`, `CONTRIBUTING.md`
- Verified: `grep -n "branch" skills/hamilton-wayfinder/SKILL.md CONTRIBUTING.md | grep -i "map\|merge"` → field documented in both files; `grep -n "Operation rules" skills/hamilton-wayfinder/SKILL.md` → present in "The map" description and in the new charting step; `bun --bun vitest run` → 8 files, 98 tests passed; `bun run build` → clean
- Notes: "The map" section now lists six sections (added Operation rules) with a short description distinguishing it from Notes. Charting gained a new step 4 ("Ask for operation rules") before map creation, and step 5 ("Create the map", renumbered) now states `branch:` is set to the charting session's current branch — the branch the effort works from and merges back into — with the detached-HEAD edge case (record the default branch, tell the user) called out; Operation rules is filled from the new step. `## Map mechanics`'s Frontmatter paragraph documents `branch:` and its legacy fallback. `CONTRIBUTING.md`'s Map mechanics table gained a `branch` (map) row and its prose was updated to reflect the map's frontmatter order and the legacy fallback, in the same commit as the skill edit per the lockstep-commit constraint. Process-flow digraph gained an "Ask for operation rules" node on the charting path. Work-loop, Route, and Skill dispatch sections were not touched (Task 7's scope). This commit also folds in `review.md`'s Task 5 review section, which was already written in the working tree before this task started (pre-existing, not this task's production content) — same pattern Task 5's own commit used for Task 4's leftover review, kept to satisfy the clean-tree requirement.

## Review: Task 6 — 2026-08-19
- Verdict: approved (blocking: 0, suggestions: 1) — see review.md

## Task 7: Harden the wayfinder work loop and route writing — 2026-08-19
- Outcome: done
- Changed: modified `skills/hamilton-wayfinder/SKILL.md`
- Verified: `grep -n "MUST\|Shipping rules\|ceiling" skills/hamilton-wayfinder/SKILL.md` → imperative dispatch, shipping-rules instruction, and same-session wording all present; `bun --bun vitest run` → 8 files, 98 tests passed; `bun run build` → clean
- Notes: "Skill dispatch"'s intro sentence now reads "A skill MUST be loaded... before any work in its spirit begins". Work-loop step 1 ("Load the map") now also reads the map's `branch:` and Operation rules, stating the session applies each rule to the actions it covers, with the commit-after-resolution and subagent-delegation examples. Step 3 ("Claim it") now states claiming is the start of resolution, not a stopping point — the claiming session resolves the ticket, never a later one. Step 4 ("Resolve it") is now imperative: the resolving skill MUST be loaded before any resolution work, and for a prototype ticket no prototype code exists before `hamilton-wayfinder-prototype` is loaded and its branch gate has run (the gate's mechanics stay in the prototype skill, not duplicated here). The one-ticket-per-session sentence gained "This is a ceiling, not a deferral: the ticket you claim is the ticket you resolve, now." "The route" section now instructs filling the route's `## Shipping rules` section from the map's `branch:` field (merge-back target) plus shipping-relevant Operation rules. The process-flow digraph's work-loop/route nodes were relabeled to match ("Claim ticket\n(start of resolution, same session)", "Load resolving skill, then resolve by type...", "Fold glossary + write route\n+ Shipping rules (closing act)"). Charting and Map mechanics sections (Task 6's territory) were left untouched.
