# Review: Remove Wayfinder's one-ticket-per-session gate

## Task 2 — 2026-08-29

Verdict: approved

Verified against `plan.md` Task 2 acceptance criteria and `design.md`'s "Repair the glossary and
source tickets, preserving superseded decisions" decision, using the diff package
(`f55ffa5..c35aec6`, files: `.hamilton/specs/glossary.md`,
`.hamilton/maps/hamilton-wayfinder/tickets/01-map-artifact-layout.md`,
`.hamilton/changes/.../progress.md`):

- `.hamilton/specs/glossary.md` **decision ticket** entry retains file-per-`tickets/NN-slug.md`,
  numbering, stable identity, reading order, link legibility, and map-gist behavior (`## Answer`
  authority via the appended-on-resolution language is unchanged), now defines the file as "one
  ticket-sized working target" and states a session opens each ticket it explicitly claims and may
  work several in file order when the user authorizes a batch. The old one-file/one-session
  equation is gone from this entry. No other glossary entry touched.
- `.hamilton/maps/hamilton-wayfinder/tickets/01-map-artifact-layout.md`'s `### Ticket files`
  subsection carries the same current truth ("one ticket-sized working target ... a session opens
  each ticket it explicitly claims, and may work several authorized targets in ticket file order"),
  while numbering, stable identity, reading order, link legibility, and the concurrency/rejected-
  alternatives rationale (`tickets.md` collision risk, `open`/`resolved` directories) are byte-for-
  byte unchanged. Settled directory and undated effort slug sections are untouched.
- Ticket 01 gained exactly one `## Outdated decisions` section (confirmed `s.count(...) == 1`) with
  a named subsection quoting the exact superseded sentence — "One file is one agent session's
  working target, so a session opens exactly what it claims." — verified present verbatim only
  after the `## Outdated decisions` heading and absent from the current Answer. It links
  `../../../changes/2026-08-29-remove-wayfinder-ticket-gate/requirements/wayfinder.md`, which I
  confirmed resolves relative to the ticket's directory to an existing file, and it explicitly notes
  file-per-ticket layout, numbering, identity, and reading order remain current.
- Diff is confined to the two files the task lists plus `progress.md` (a normal change artifact); no
  `requirements/glossary.md`, template, other glossary entry, or other map ticket (e.g. 04) was
  created or touched.
- Independently re-ran the task's Verify command against the current worktree (already at
  `c35aec6`, clean tree) — printed `decision-ticket vocabulary ok`. Independently re-ran
  `git diff --check f55ffa5 c35aec6` — exit 0. Both match the implementer's report.
- Wrap-style deviation noted in `progress.md` (hard-wrapped paragraphs instead of the change's
  unwrapped-prose convention) is justified: `.hamilton/specs/glossary.md` and existing map ticket
  prose are hard-wrapped throughout (confirmed via line-length sampling), matching the established
  precedent (`42339a1`'s `## Outdated decisions` additions to a sibling map ticket, also hard-
  wrapped). The plan's "All new artifact prose flows unwrapped" note reads as governing this
  change's own new pipeline artifacts (`proposal.md`/`requirements/`/`design.md`/`plan.md`, which
  are visibly unwrapped with very long lines), not edits inside a pre-existing wrapped file. No
  issue.

No blocking issues, no suggestions.
