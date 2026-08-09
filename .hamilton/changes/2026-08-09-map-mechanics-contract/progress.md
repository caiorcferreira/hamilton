# Progress: Convert the map's own files to the mechanics contract

<!-- Newest entries at the bottom. One block per task attempt. -->

## Task 1 + Task 2: coder implementation — 2026-08-09

- Outcome: done
- Changed:
  - Created: none
  - Modified: `.hamilton/maps/hamilton-wayfinder/map.md`; all thirteen `tickets/NN-slug.md`; `CONTRIBUTING.md`
  - Deleted: none
- Verified: `rg '^Type:|^Status:|^Blocked by:'` → no matches; `git diff --name-only` → exactly 15 files; `bun run build` exit 0; `bun --bun vitest run` 24/24 exit 0
- Notes: Two commits (`b1f877c`, `720e9dc`). `map.md` carries `status: shipping` only (no `type`) per design Decision 2, overruling the playbook coder note's `type: map` suggestion. CONTRIBUTING.md `## Map mechanics` section added after `## Licensing and attribution`, genuinely isolated.

## Review: Full diff (Task 1 + Task 2) — 2026-08-09

- Verdict: approved (blocking: 0, suggestions: 0) — see review.md
