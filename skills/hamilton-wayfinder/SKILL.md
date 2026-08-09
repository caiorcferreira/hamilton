---
name: hamilton-wayfinder
description: Chart a map of decision tickets for a goal too big for one session, then work them one at a time until the way to the destination is clear.
disable-model-invocation: true
---

## Opening

Some goals are too big for one agent session — not because the work is hard, but because the way to the end is not yet clear. Wayfinding finds that way before the work begins: chart a **map** of the decisions standing between here and the **destination**, then work them one **ticket** at a time until the **frontier** is empty and the **fog of war** ahead has lifted. The map plans the way; the doing comes later, one change at a time.

## The map

The map is an **index**, not a store — it carries just enough to orient every session and points at the tickets that hold the detail. Five sections fix its shape: **Destination** (what reaching the end looks like), **Notes** (domain and standing preferences), **Decisions so far** (one line per resolved ticket, each linking back), **Not yet specified** (the fog), and **Out of scope** (work ruled beyond the destination). Create it from the installed template at `~/.hamilton/templates/wayfinder/map.md`; the template fixes the shape, the skill fixes when to create it.

## Ticket types

Every ticket has a type that promises how it gets answered, and each type delegates to a skill:

- **research** (AFK) — a background investigation. Delegate to `hamilton-wayfinder-research`, which reads primary sources and writes cited findings under the map.
- **prototype** (HITL) — throwaway code that answers one design question. Delegate to `hamilton-wayfinder-prototype`.
- **grilling** (HITL) — one-question-at-a-time dialogue that sharpens the decision and the effort's vocabulary. Run `hamilton-grilling`, with `hamilton-wayfinder-domain-modeling` sharpening terms as the dialogue moves.
- **task** (HITL or AFK) — manual work that unblocks a decision. Drive it directly where you can, or hand the human a precise checklist.

A planning ticket resolves only through live exchange with a human. The agent puts each decision to the human and waits — it never stands in for the human's side of the dialogue. Hamilton's three-tier attendance model (Always / Ask first / Never) governs SDD execution downstream, not this planning stage.

## Fog of war

Not every decision can be stated sharply at the start. The fog of war is the dim view ahead — decisions you can tell are coming but cannot yet pin down, because they hang on questions still open. It lives in the map's Not yet specified, deliberately uncharted. The test separating fog from a ticket is whether the question can be stated precisely now, not whether it can be answered now. When a resolution makes a foggy question specifiable, the fog graduates: it clears from Not yet specified and becomes a new ticket.

## Out of scope

Some work is consciously ruled beyond the destination. It goes in Out of scope and stays there — it never graduates into a ticket, because a ticket exists to advance toward the destination and out-of-scope work does not. Listing it keeps later sessions from re-litigating the boundary.

## Chart the map

Charting is one session's work and resolves no tickets — it names the destination and lays out the frontier.

1. **Name the destination.** Run a `hamilton-grilling` session to fix what reaching the end of the map looks like — the spec, decision, or change the effort is finding its way to.
2. **Map the frontier breadth-first.** Grill across the whole space, surfacing open decisions and first takeable steps rather than chasing the deepest one first.
3. **Check for fog.** If breadth-first grilling surfaces no fog, the way is already clear for one session — stop and tell the user a map is not needed.
4. **Create the map.** Write it from the installed template at `~/.hamilton/templates/wayfinder/map.md`, with Destination and Notes filled in, Decisions so far empty, and the fog sketched into Not yet specified.
5. **Create the tickets that can be specified now.** Write each from the installed template at `~/.hamilton/templates/wayfinder/ticket.md`, then wire each ticket's blocking dependencies in a second pass once the set exists.
6. **Fire research in parallel.** For any research tickets, dispatch `hamilton-wayfinder-research` subagents so the reading happens in the background while charting continues.

## Work through the map

Working is the steady loop that clears the map one ticket at a time.

1. **Load the map.** Read its low-resolution view to orient: the destination, the decisions already made, and the fog still ahead.
2. **Choose the frontier ticket.** Take the first open, unblocked, unclaimed ticket in order — the frontier is the edge of the known.
3. **Claim it.** Mark the ticket in hand before any work begins, so a reader knows it is being worked.
4. **Resolve it.** Delegate to the skill the ticket's type promises: research, prototype, grilling with domain modeling, or drive a task directly.
5. **Record the answer.** Append the resolution under a `## Answer` heading in the ticket, mark the ticket resolved, and append a one-line gist to the map's Decisions so far with a link back to the ticket.
6. **Graduate or close.** If the resolution makes new tickets specifiable, create them and clear the graduated fog from Not yet specified. If it reveals a ticket sits beyond the destination, close the ticket and leave one line in Out of scope.

Resolve at most one ticket per session — with the exception of research tickets, which run in the background and do not consume the session's focus.

## The route

When the last ticket resolves, the map clears and the route is written — once, as a closing act. The route is a static handoff: it lists the change-sized units in order, points at the decisions backing each, and does not restate them. An implementer follows the links back to the tickets, which keeps the source of truth in one place. Write it from the installed template at `~/.hamilton/templates/wayfinder/route.md`.

The map then moves through its lifecycle: open while charting and working, cleared when every ticket is resolved and the route is written, shipping while the route's units flow through the SDD loop, and shipped when the last unit lands. Each unit runs the SDD loop once — propose, plan, code, review, finish-work — and flips its own status on its own branch, so the flip ships with the work it marks.

## Map mechanics

This section is the contract between the wayfinder methodology and its file-native implementation — the only place mechanics are defined. The rest of the skill refers to concepts; a future backend swaps this section and verifies in one pass that nothing above it names a field, a path, or a branching rule.

**Frontmatter.** Every ticket and the map carry YAML frontmatter. Tickets use `type:` (`research` / `prototype` / `grilling` / `task`), `status:` (`open` / `claimed` / `resolved`), and `blocked_by:` (a list of ticket numbers). The map uses `status:` (`open` / `cleared` / `shipping` / `shipped`).

**File layout.** A map lives at `.hamilton/maps/<effort>/` — an undated slug that is the effort's identity — holding `map.md`, `route.md` once the map clears, and `tickets/NN-slug.md` numbered from `01`.

**Claiming.** Setting a ticket's `status:` to `claimed` is a signal of intent: it tells a reader the ticket is in hand. It does not affect frontier calculation — a claimed ticket is still open, not resolved — and it does not prevent a collision; concurrent sessions collide through git, and the claim is how a reader sees the ticket is already being worked.

**Branching.** Map artifacts are ordinary repo content, versioned and branched like source. A status flip rides the unit's own branch and lands on the default branch at merge, so the flip ships with the work it marks. Between merges the route lags on the default branch; that staleness is accepted, not a defect.
