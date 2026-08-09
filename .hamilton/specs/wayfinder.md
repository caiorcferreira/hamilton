# Capability: wayfinder

## Overview

The methodology for charting a map of decision tickets and working them one at a time until the way to the destination is clear. A map is a third kind of artifact under `.hamilton/maps/<effort>/` — alongside `specs/` and `changes/` — that spans several changes and outlives all of them. The skill has two branches: charting a new map from a loose idea, and working an existing map's tickets to resolution. When every ticket is resolved, the map clears and a `route.md` is written as a static handoff to the SDD loop. This capability owns the charting and working processes, the map lifecycle, the frontier and fog-of-war mechanics, and the file-native map mechanics; it defers to `glossary` for what the terms mean and to `ticket-resolution` for how each ticket type is resolved.

## Contract

### Invocation

The skill is user-invoked (`disable-model-invocation: true`). The `description` field is a human-facing one-line summary, not a model-facing trigger list. No other skill needs to reach wayfinder — it is the pre-SDD entry point, always initiated by a person choosing to start planning.

### Ticket-type dispatch

A ticket's `type` frontmatter field decides which skill resolves it. The skill reaches each by name, which is possible because all four are model-invoked:

| ticket type | resolving skill |
|---|---|
| `research` | `hamilton-wayfinder-research` |
| `prototype` | `hamilton-wayfinder-prototype` |
| `grilling` | `hamilton-grilling` + `hamilton-wayfinder-domain-modeling` |
| `task` | driven in-session, or a checklist handed to the human |

### Templates

Format details live in the installed templates, not in the skill body. The skill points at them and never reproduces their structure:

| artifact | template |
|---|---|
| map | `~/.hamilton/templates/wayfinder/map.md` |
| ticket | `~/.hamilton/templates/wayfinder/ticket.md` |
| route | `~/.hamilton/templates/wayfinder/route.md` |

### Map mechanics

The file-native contract for map artifacts. This is the swappable surface — a future tracker backend changes this section and nothing else in the skill.

| frontmatter field | valid values |
|---|---|
| `type` | `research` / `prototype` / `grilling` / `task` |
| `status` (ticket) | `open` / `claimed` / `resolved` |
| `status` (map) | `open` / `cleared` / `shipping` / `shipped` |
| `blocked_by` | comma-separated ticket slugs |

A map lives at `.hamilton/maps/<effort>/` holding `map.md`, a `tickets/` directory of `NN-slug.md` files numbered from `01`, and — once the map clears — `route.md`. Map artifacts are ordinary repo content, versioned and branched like source. A status flip rides the unit's own branch and lands on the default branch at merge. Claiming a ticket sets its status to `claimed` as a signal of intent; it does not affect frontier calculation — a claimed ticket is still open, not resolved.

## Behavior

**Charting.** When a user arrives with a loose idea too big for one session, the skill runs a grilling session to name the destination — what reaching the end of the map looks like. With the destination named, it grills breadth-first across the whole space, surfacing open decisions and first takeable steps. If breadth-first grilling surfaces no fog — the way is already clear for one session — the skill stops and tells the user a map is not needed. When fog is surfaced, it creates the map from the installed template, with Destination and Notes filled in, Decisions so far empty, and the fog sketched into Not yet specified. It creates the tickets that can be specified now from the ticket template, then wires `blocked_by` in a second pass. Research tickets raised during charting fire `hamilton-wayfinder-research` subagents in parallel. Charting is one session's work and resolves no tickets itself.

**Working.** When a user invokes with an existing map, the skill loads the map's low-resolution view. When no ticket is named, it takes the first frontier ticket in order — the first open, unblocked, unclaimed ticket. It sets the ticket's status to `claimed` before any work. It resolves the ticket with the skill its type delegates to, then appends the answer under `## Answer` in the ticket file, flips the ticket's status to `resolved`, and appends a one-line gist to the map's Decisions so far with a link to the ticket. When a resolution makes new tickets specifiable, it creates them and clears the graduated fog from Not yet specified. When a resolution reveals a ticket sits beyond the destination, it closes the ticket and leaves one line in Out of scope. The skill resolves at most one ticket per session, with the exception of research tickets.

**The route.** When every ticket is resolved, the map clears and a `route.md` is written as a static handoff to the SDD loop — a closing act, not grown incrementally. The route lists change-sized units in order with their dependencies; it points at decisions and does not restate them. The map's status progresses `open` → `cleared` → `shipping` → `shipped`: `cleared` when the route is written, `shipping` while the route's units flow through the SDD loop, `shipped` when the last unit lands. Each unit runs the propose→finish-work loop once and flips its own status on its own branch.

**Strict HITL for planning.** A HITL ticket resolves only through live exchange with a human; the agent never stands in for the human's side of a planning dialogue. Hamilton's three-tier attendance model ("Always / Ask first / Never") applies to SDD execution, not to wayfinder's planning phase.

**Examples**

- a loose idea too big for one session -> a grilling session names the destination
- breadth-first grilling surfaces no fog -> the skill stops and tells the user a map is not needed
- fog is surfaced -> the map is created from the template, tickets created, blocking wired
- research tickets are created during charting -> `hamilton-wayfinder-research` fires in parallel
- charting completes -> one session's work, no tickets resolved
- an existing map is loaded with no ticket named -> the first open, unblocked, unclaimed ticket is chosen
- a ticket is chosen -> its status is set to `claimed` before any work
- a ticket is resolved -> the answer is appended under `## Answer`, status flipped to `resolved`, a one-line gist added to Decisions so far
- a resolution makes new tickets specifiable -> the tickets are created and the graduated fog cleared from Not yet specified
- a resolution reveals a ticket beyond the destination -> the ticket is closed and one line left in Out of scope
- a non-research ticket is being worked -> at most one ticket per session
- a research ticket is being worked -> the one-per-session limit does not apply
- every ticket is resolved -> the map clears and `route.md` is written
- a route unit completes its SDD loop -> it flips its own status on its own branch

## Invariants

- The skill MUST be user-invoked (`disable-model-invocation: true`). A model-invoked description would add per-turn context load for a skill that fires only when a person chooses to start planning.
- The `## Map mechanics` section MUST be the only place in the skill body where file-native mechanics — frontmatter fields, file layout, claiming, branching — are defined. The rest of the body MUST refer to concepts without depending on the specific mechanics, so the section is genuinely swappable.
- The skill MUST NEVER reproduce format details that the templates at `~/.hamilton/templates/wayfinder/` already define. It points at the templates; it does not inline them.
- The skill MUST NEVER resolve more than one ticket per session, with the exception of research tickets.
- A HITL ticket MUST NEVER resolve without live human exchange. The agent MUST NEVER answer its own questions during a planning dialogue.
- The skill MUST reach the four ported siblings by name. If a sibling is not reachable, the ticket type that delegates to it is a promise that cannot be kept.
- The `NOTICE` MUST state original authorship under Apache 2.0 and MUST NOT use the "adapted from" pattern, because the skill text is original. The `SKILL.md` MUST NOT carry a provenance line.

## Decisions

- **User-invoked, matching upstream.** No other skill needs to reach wayfinder — it is the pre-SDD entry point, always initiated by a person choosing to start planning. A model-invoked description would add per-turn context load for a long skill that fires rarely. The ported siblings are all model-invoked, so wayfinder reaches them regardless of its own mode.
- **No `references/` directory; all material in the body.** For a user-invoked skill, the body loads only when the skill fires — body length is not a per-turn cost. The two branches (chart, work) share so much conceptual foundation that splitting them into references would create more load, not less. The templates are the external reference for format details.
- **`## Map mechanics` isolated in the body, not in `references/`.** The mechanics are needed every run — the agent reads frontmatter to scan the frontier and writes frontmatter to claim a ticket — so disclosing them behind a context pointer would add load for material that is always reached. The heading itself is the isolation boundary: a future backend swaps the section under that heading without touching the rest. Physical isolation is unnecessary when structural isolation is real.
- **The skill points at templates, never reproduces them.** The templates are the single source of truth for each artifact's shape; restating them in the skill body would duplicate that truth. The skill orients the agent to what each artifact is and when to create it; the template fixes what it looks like.
- **Original `NOTICE`, no provenance line.** The skill text is original — no upstream prose is copied, and ideas and methodologies are not copyrightable. The MIT license does not require attribution for an independent implementation. The root `NOTICE` carries the repo-level upstream attribution; the per-skill `NOTICE` follows the root's own-work copyright pattern.
- **One capability, bounded against two neighbours.** `glossary` defines what a term means (what a map is); `ticket-resolution` defines how each ticket type is resolved and where its artifacts land; `wayfinder` owns how the map is charted and worked — the processes, the lifecycle, and the file-native mechanics.
