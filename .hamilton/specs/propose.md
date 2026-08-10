# Capability: propose

## Overview

The heavyweight front door of Hamilton's spec-driven pipeline. It turns a change request into the proposal, requirements, and design artifacts through collaborative dialogue — interviewing toward the decisions that shape the change, then writing the artifacts that carry it into planning. It accepts two input shapes: a free-form request, or — when pointed at a wayfinder map folder — a map-aware entrypoint that reads the route, finds the next pending unit, and pulls that unit's backing decisions into context before the dialogue begins. Everything after the entrypoint is the same process in both modes: the dialogue, the approach choice, the design, the self-review, and the approval gate all run unchanged. This capability owns the entrypoint detection and the map-aware context pull; it defers to `dialogue` for how questions are asked and to `wayfinder` for what a route is.

## Contract

### Input shapes

The skill takes a single request, whose shape selects the entrypoint mode:

| request shape | entrypoint mode |
|---|---|
| a free-form change request | free-form mode; the title is derived from the request |
| a path under `.hamilton/maps/<effort>/` whose folder contains a `route.md` | map-aware mode; the title is derived from the next pending unit's slug |

### Route format the entrypoint reads

In map-aware mode the skill reads the route's public format — the same shape the `wayfinder` route template fixes — and nothing beyond it:

| route element | what the skill does with it |
|---|---|
| `### N. <unit name>` | unit heading; the unit name yields the change title |
| `Status: pending` / `in-progress` / `shipped` | per-unit status; scanned in order for the first `pending` |
| `Backed by: tickets/NN-slug.md, …` | decision links; each linked ticket is read for full context |

## Behavior

In free-form mode the skill derives a change title from the request and proceeds into context exploration and dialogue exactly as it always has.

In map-aware mode the skill reads `route.md` from the working tree — the branch the session started on — and scans the units in order for the first whose `Status:` reads `pending`. That unit's slug becomes the change title; its `Backed by:` links are each read and fed into context exploration alongside the specs, docs, and recent commits that exploration already gathers. When the selected unit has no `Backed by:` line, context exploration proceeds on the route entry's goal paragraph alone. When no unit is pending — every unit is `in-progress` or `shipped` — the skill stops and tells the user the route has no next unit, rather than picking an already-active unit or silently falling back to free-form mode.

After the entrypoint, the two modes are indistinguishable. The collaborative dialogue, the approach choice, the design, the self-review, and the approval gate proceed identically regardless of how the change was entered; map-aware mode adds only the front context pull and then merges back into the single process flow.

**Examples**

- request points at `.hamilton/maps/<effort>/` containing a `route.md` -> map-aware mode; route read from the working tree, first `pending` unit selected, title from its slug, backing tickets read into context
- request points at a map folder but every unit is `in-progress` or `shipped` -> the skill stops and tells the user the route has no next unit
- selected unit's `Backed by:` line is empty or absent -> context exploration uses the route entry's goal paragraph alone
- request does not reference a map folder, or the referenced folder has no `route.md` -> free-form mode; the title is derived from the request
- map-aware mode completes its context pull -> the dialogue, design, self-review, and approval gate run identically to free-form mode

## Invariants

- In map-aware mode, `route.md` MUST be read from the working tree on the session's starting branch — the worktree created for the change is based off that branch, so the working tree's copy is the session's copy. The skill MUST NEVER reach for the default branch's copy of the route.
- The change title in map-aware mode MUST derive from the selected pending unit's slug, not from a paraphrase of the request.
- After the entrypoint, the process MUST proceed identically in both modes. The map-aware addition is a front branch only; it adds no step, artifact, or gate beyond what free-form mode runs.

## Decisions

- **Map-aware mode is a conditional branch, not a second process flow.** The two input shapes share one dialogue, one design, one approval gate; duplicating the post-entrypoint process for map-aware mode would repeat identical steps for no gain. The addition is a front branch that merges back into the existing flow, which keeps the "everything after the entrypoint is unchanged" guarantee visible in the text rather than asserted by omission.
- **Detection and context pull land where their concern already lives.** Title derivation joins the existing title-derivation concern; route reading and decision-link navigation join the existing context-exploration concern. Splitting map-aware logic into its own front step would shift every downstream reference for a small addition and give one concern two homes.
- **The entrypoint couples to the route's public format, not to wayfinder's internals.** The skill reads the `### N.` / `Status:` / `Backed by:` shape the route template fixes — the same surface `wayfinder` documents — and nothing beyond it. A route-template change that alters that shape updates this entrypoint in the same change; the coupling is to the published format, not to private mechanism.
- **Unit status is read from the route's plain-text `Status:` line.** The route template carries per-unit status as a plain-text line, not as frontmatter; matching the actual format keeps the skill honest rather than parsing a hypothetical one.
