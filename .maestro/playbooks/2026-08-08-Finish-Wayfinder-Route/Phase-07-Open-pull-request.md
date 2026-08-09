# Phase 07: Open a pull request

Push the `port-wayfinder-siblings` branch to the remote (`origin` — `git@github.com:caiorcferreira/hamilton.git`) and open a pull request against the default branch (`main`), summarizing the route's completion. This is the final phase: the route is shipped, the whole-branch review passed (or its findings were applied), and the work is ready for the repo's default branch. Uses the **coder** agent for the mechanical push-and-PR work.

## Tasks

- [x] Confirm the branch is ready to ship: the working tree on `port-wayfinder-siblings` is clean, `bun run build` and `bun --bun vitest run` pass, all ten route units show `Status: shipped` in `.hamilton/maps/hamilton-wayfinder/route.md`, and `map.md` reads `shipped`. Confirm the Phase-06 review verdict was `clean` or that all its findings were applied and committed.

  **Done.** All readiness checks pass on `port-wayfinder-siblings`. Working tree clean (`git status` — nothing to commit); branch in sync with `origin/port-wayfinder-siblings` (0 ahead / 0 behind). Gates green: `bun run build` exits 0; `bun --bun vitest run` passes 24/24 tests across 3 files. Route: all ten units carry `Status: shipped` in `.hamilton/maps/hamilton-wayfinder/route.md` (units 1–10 at lines 41, 62, 84, 101, 125, 154, 195, 224, 241, 261; the route header itself shipped at line 3). `map.md` frontmatter reads `status: shipped`. Phase-06 review verdict was `findings` (2 minor) — not `clean`, but both findings were applied by a coder agent and committed in `2f83dd9` (Phase-06 tasks 5 and 6, both marked `[x]`); working tree clean post-commit confirms nothing was left uncommitted. Branch is ready to ship.

- [ ] Dispatch the **coder** agent to push the branch and open the PR. Push `port-wayfinder-siblings` to `origin`, then open a pull request against `main` using `gh`. The PR body must summarize the route completion:
  - **What shipped** — units 6–10 (author `hamilton-wayfinder`; refactor propose + critique onto `hamilton-grilling`; teach propose to read a route; sync framework docs; convert map files to the mechanics contract), plus the whole-branch review outcome.
  - **Map of record** — link `.hamilton/maps/hamilton-wayfinder/route.md` as the route that drove the effort, and note the map reached `shipped`.
  - **Gates** — note `bun run build` and `bun --bun vitest run` pass, and that no test asserts on skill content (per ticket 12).

- [ ] Verify the PR opened: confirm `gh pr view` returns the PR URL and that the base is `main`. Report the PR URL back so it can be shared. Do not merge the PR — leave that to the repo's review process.
