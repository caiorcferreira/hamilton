# Phase 05: Convert the map's own files to the mechanics contract (Route Unit 10)

Convert `map.md` and all thirteen tickets in `.hamilton/maps/hamilton-wayfinder/` from loose `Key: value` header lines to YAML frontmatter with `type`, `status`, and `blocked_by`, then give the `## Map mechanics` contract a written home. This is dogfooding cleanup that touches only this map's own files, and it is the **last unit in the route** — when it ships, the map reaches its destination and `map.md` moves to `shipped`. Mechanical frontmatter conversion, so it uses the **coder** agent. One choice is deliberately left open by ticket 04 (the home for the mechanics contract — `CONTRIBUTING.md` or a dedicated `MECHANICS.md` under `.hamilton/maps/`); the propose step settles it rather than the implementer deciding mid-change. No skills change this unit, so there is no `writing-great-skills` pass.

## Tasks

- [x] Load the unit's context. Read the `### 10. Convert the map's own files to the mechanics contract` section of `.hamilton/maps/hamilton-wayfinder/route.md` and its backing ticket `tickets/04-map-mechanics-in-files.md`. Also read `map.md` (note its current loose `Status: shipping` line) and all thirteen ticket files (each has loose `Type:`, `Status:`, `Blocked by:` lines) to see the exact conversion surface. Note ticket 04's contract: YAML frontmatter with `type` (`grilling` / `research` / `prototype` / `task`), `status` (tickets: `open` / `resolved`; maps: `cleared` / `shipping` / `shipped` per ticket 06's three-stage lifecycle, which supersedes ticket 04's `open` / `cleared` for maps), and `blocked_by` (list of ticket numbers). Note the one open choice: where the `## Map mechanics` contract lives — `CONTRIBUTING.md` or a dedicated `MECHANICS.md` under `.hamilton/maps/`.

  **Context loaded.** Read route.md §10, ticket 04, `map.md` (loose `Status: shipping`), and all thirteen ticket files. Conversion surface confirmed — every ticket has loose `Type:` / `Status:` / `Blocked by:` lines; `map.md` has a loose `Status:` line. Contract per ticket 04: YAML frontmatter `type` / `status` / `blocked_by`; map status uses ticket 06's three-stage `cleared` / `shipping` / `shipped` (supersedes ticket 04's `open` / `cleared`). Open choice for propose: `CONTRIBUTING.md` vs `.hamilton/maps/MECHANICS.md` as the home for the `## Map mechanics` contract. Images analyzed: 0.

- [x] Establish an isolated workspace for this unit off `port-wayfinder-siblings`: create a worktree on a dedicated branch (e.g. `unit-10-map-mechanics-contract`) and `cd` into it, confirming `git rev-parse --show-toplevel` ends in that worktree.

  **Workspace established.** Created worktree at `/Users/caio.cavalcante/personal/hamilton/.worktrees/unit-10-map-mechanics-contract` on branch `unit-10-map-mechanics-contract`, based off `port-wayfinder-siblings` (ebdb755). Confirmed `git rev-parse --show-toplevel` resolves to the new worktree path. Parent worktree (`port-wayfinder-siblings`) was clean apart from untracked Auto Run docs.

- [ ] Run `hamilton-propose` for this unit. Propose may now read the route itself (unit 8 shipped the map-aware entrypoint in Phase 03); if not, feed the unit 10 goal and ticket 04's decisions as the change request. The proposal must **settle the one open choice** — the home for the `## Map mechanics` contract (`CONTRIBUTING.md` vs a dedicated `MECHANICS.md` under `.hamilton/maps/`) — with reasoning, since ticket 04 deliberately left it for propose. The scope is `map.md` + the thirteen tickets only (route.md is not in this conversion per the route). Answer any HITL questions from the ticket context so the phase is autonomous.

- [ ] Run `hamilton-plan` on the approved propose artifacts to produce the ordered task ledger for the conversion.

- [ ] Dispatch the **coder** agent to implement the conversion, giving it the propose + plan artifacts:
  - Convert `map.md`'s loose header to YAML frontmatter (`type: map`, `status: shipping` — it will flip to `shipped` at finish-work since this is the last unit).
  - Convert all thirteen `tickets/NN-slug.md` files' loose `Type:` / `Status:` / `Blocked by:` lines to YAML frontmatter (`type`, `status`, `blocked_by`), preserving each ticket's existing resolved values.
  - Write the `## Map mechanics` contract to the home propose settled, documenting the three frontmatter fields, their valid values, and the boundary a future tracker backend would swap.

- [ ] Run `hamilton-review` on the unit's diff, confirming every map and ticket file was converted (no loose header lines left behind) and the mechanics contract is genuinely isolated so a future backend can swap it. Address any blocking findings.

- [ ] Run `hamilton-finish-work` with the **`local-merge`** strategy, merging the unit's branch back into **`port-wayfinder-siblings`** (not `main`), from the `port-wayfinder-siblings` worktree. **This is the last unit** — as part of this same diff, flip `map.md`'s frontmatter `status` to `shipped` (the map reaches its destination) and the route's top-level `Status:` to `shipped`. Tear down the unit worktree after the merge; confirm the spec sync and `progress.md` finish entry ride into `port-wayfinder-siblings`.

- [ ] Verify the route is complete: in `.hamilton/maps/hamilton-wayfinder/route.md` the `### 10.` section's `Status:` line reads `shipped`, and `map.md`'s status reads `shipped` — the destination reached through Hamilton's own loop. Run the repo gates — `bun run build` and `bun --bun vitest run` — and confirm both pass.
