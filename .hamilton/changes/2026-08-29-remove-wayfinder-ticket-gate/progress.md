# Progress: Remove Wayfinder's one-ticket-per-session gate

## Task 1: Rewrite the Wayfinder work loop around explicit authorization — 2026-08-29

- Outcome: done
- Changed:
  - Created: none
  - Modified: `skills/hamilton-wayfinder/SKILL.md`
  - Deleted: none
- Verified:
  - Pre-edit: task Verify command → failed as expected (missing all new-authorization phrases; forbidden implicit-selection/one-ticket-per-session text present)
  - `python3 -c '...wayfinder contract ok...'` (task Verify) → `wayfinder contract ok`
  - `git diff --check` → exit 0
  - `bun --bun vitest run` → 97/98 passing; the one failure (`tests/scripts/change-context.test.ts` mtime-ordering test) is pre-existing on this branch, reproduced identically with the SKILL.md change stashed out, unrelated to this task
  - `bun run build` → passes clean
- Notes:
  - Rewrote frontmatter `description`, Opening, and the "Work through the map" introduction to make explicit user authorization — not session count or generic invocation — the ticket-start boundary.
  - Replaced the numbered work loop with an 11-step sequence: load/orient + absorb prior research (explicitly a continuation, not new authorization) → stop if no explicit request → resolve named identifiers / next-frontier request (unknown identifier reported+excluded; empty frontier reported) → form the fixed authorization set ordered by ticket file order → reread each member immediately before its turn → claim if eligible or report+skip without substitution (states the `[01, 02]` dependent-batch example verbatim) → resolve → record answer → consistency pass → graduate/close → advance only within the fixed set or stop when exhausted (route closing folded in here, unchanged trigger: "every ticket on the map resolved").
  - Removed the one-ticket-per-session paragraph and its research exception entirely; its "never park a claimed ticket" obligation was preserved by folding it into the new step 11.
  - Redrew the process-flow digraph end-to-end for the working half, using the required decision-node labels `Ticket work explicitly requested?` and `Authorized member remains?`, with an explicit no-request stop and no-frontier-available stop, a per-member eligibility/skip branch, a loop confined to the fixed authorization set, and the unchanged route-closing path (`Every ticket on the map resolved?` → write route) — no edge leads back to an unrestricted frontier once the set is exhausted (the exhausted-set stop node has no outgoing edge).
  - Chart the map, Ticket types, Skill dispatch (including its "work loop step 1" cross-reference, still valid), Map mechanics (frontmatter/frontier/claiming/branching fields already matched the claimed-removes-from-frontier truth and needed no change), The route, and map lifecycle prose were left intact, matching the plan's non-goals.
  - Deviation: acceptance criterion 6 asks that "Examples, Invariants, and Decisions" sections encode the new rules, but `skills/hamilton-wayfinder/SKILL.md` has never had headed `## Examples` / `## Invariants` / `## Decisions` sections (only the canonical `.hamilton/specs/wayfinder.md` does, and that file is out of this task's scope — finish-work distills it later). No other step in the task instructs creating such headings, and the Verify command does not require them. I satisfied the intent by embedding the same illustrative example (`[01, 02]` batch), invariant-style statements ("never park a claimed ticket," "the set never grows or shrinks," "does not authorize any other ticket"), and durable-rule wording directly into the rewritten numbered work loop and process-flow diagram, rather than inventing new top-level sections foreign to this skill's established shape. Flagging for reviewer attention.

## Task 2: Align decision-ticket sizing at its source — 2026-08-29

- Outcome: done
- Changed:
  - Created: none
  - Modified: `.hamilton/specs/glossary.md`, `.hamilton/maps/hamilton-wayfinder/tickets/01-map-artifact-layout.md`
  - Deleted: none
- Verified:
  - Pre-edit: task Verify command → failed as expected (`AssertionError`; no `## Outdated decisions` section existed yet in ticket 01)
  - `python3 -c '...decision-ticket vocabulary ok...'` (task Verify) → `decision-ticket vocabulary ok`
  - `git diff --check` → exit 0
  - `bun --bun vitest run` → 97/98 passing; the one failure (`tests/scripts/change-context.test.ts` mtime-ordering test) reproduces identically with these two changes stashed out, confirming it is pre-existing and unrelated to this task
  - `bun run build` → passes clean
- Notes:
  - In ticket 01's `### Ticket files` subsection, replaced the one-file/one-session sentence with the current rule from `design.md`: one file is one ticket-sized working target, and a session opens each ticket it explicitly claims and may work several authorized targets in ticket file order. All other rationale (numbering, slugs, `grep`-based frontier, the rejected `tickets.md`/`open`+`resolved` alternatives) is unchanged.
  - Appended one `## Outdated decisions` section to ticket 01 with a named subsection quoting the exact superseded sentence ("One file is one agent session's working target, so a session opens exactly what it claims.") and linking `../../../changes/2026-08-29-remove-wayfinder-ticket-gate/requirements/wayfinder.md` as the superseding contract, explicitly noting that file-per-ticket layout, numbering, identity, and reading order remain current.
  - Updated only the glossary's **decision ticket** paragraph to the same current definition, preserving its existing source link to ticket 01 and every other glossary entry untouched.
  - Kept both edited passages on this file's established hard-wrapped-paragraph style (confirmed against the precedent commit `42339a1` for `## Outdated decisions` sections in map/ticket files), rather than the unwrapped flowing-prose style used in `skills/hamilton-wayfinder/SKILL.md` and this change's own `requirements/`/`design.md` — the quoted superseded sentence itself is kept on one unbroken line so the Verify script's literal substring match holds regardless of wrap.
