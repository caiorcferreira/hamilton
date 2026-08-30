# Review: Remove Wayfinder's one-ticket-per-session gate

## Task 1 — 2026-08-29

Verdict: approved

Verified the task Verify command passes against the committed `skills/hamilton-wayfinder/SKILL.md`
(commit `f55ffa5`), `git diff --check` exits 0 over `7e5afbf..f55ffa5`, and the one vitest failure
(`tests/scripts/change-context.test.ts` mtime-ordering test) is pre-existing and unrelated to this
diff. Acceptance criteria 1-5, 7, and 8 are met in the rewritten work loop and redrawn process-flow
digraph: the explicit-request gate, fixed-authorization-set/claim-time reevaluation (including the
verbatim `[01, 02]` dependent-batch example), the `claimed`-removes-from-frontier truth, and the
no-auto-advance stop are all present, and the diagram's exhausted-set stop node has no outgoing
edge back to an unrestricted frontier.

Criterion 6's "Examples, Invariants, and Decisions" wording was adjudicated: `SKILL.md` has never
carried those headings (only `.hamilton/specs/wayfinder.md` does, and `plan.md` forbids this task
from editing that file — finish-work owns it). All four required rules are encoded directly in the
rewritten numbered work loop and diagram instead of under new headings foreign to the skill's
established shape. Not a defect; finish-work must still carry these rules into the canonical spec's
real `## Examples`/`## Invariants`/`## Decisions` sections when it distills `requirements/wayfinder.md`.

No blocking issues. Three non-blocking suggestions were raised (a step-2 title that describes only
the no-request stop rather than set formation; an optional ambiguous-request clause mirroring
`design.md`'s error-handling table; and a mechanics restatement in step 6 that duplicates Map
mechanics' own claim, mandated verbatim by acceptance criterion 5) — none change behavior or block
approval.

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

## Task 3 — 2026-08-29

Verdict: approved

Verified against `plan.md` Task 3 acceptance criteria and `design.md`'s "Claimed means
unresolved but outside the frontier" and "Repair the glossary and source tickets, preserving
superseded decisions" decisions, using the diff package (`c35aec6..9d60233`, spanning commit
`9976f50` — administrative Task 2 review housekeeping, out of Task 3's own scope — and `9d60233`
— Task 3's actual edit to `.hamilton/maps/hamilton-wayfinder/tickets/04-map-mechanics-in-files.md`):

- `## Answer` summary now reads "Claiming is kept: setting a ticket's status to `claimed` removes
  it from the frontier while leaving it unresolved," replacing the old "Tickets drop claiming"
  line; that phrase is gone from current text. Combined with the unchanged `### Claiming stays`
  opening paragraph ("A `Status:` field does not prevent collision, but it signals intent...
  Keep it."), the current text says claiming is retained as an active-work signal, does not
  prevent git collisions, removes the ticket from the frontier, and leaves it unresolved — all
  four properties the criterion requires.
- `### Claiming stays`'s second paragraph replaces "But claiming does not change the frontier
  calculation: a claimed ticket is still open, not unblocked or resolved." with "Claiming removes
  the ticket from the frontier: setting `status: claimed` takes it out of frontier eligibility so
  another request cannot select or start the same ticket, while the ticket itself remains
  unresolved until its `## Answer` is recorded and its status becomes `resolved`." This matches
  `requirements/wayfinder.md`'s "Claimed tickets leave the frontier without resolving" requirement
  verbatim in substance.
- `### Status values` heading and body now list `open`, `claimed`, `resolved` for tickets (was
  `open`, `resolved`); the maps `open`/`cleared` discussion is untouched. Frontmatter syntax (the
  `type`/`status`/`blocked_by` YAML block) and `blocked_by` meaning are unchanged — confirmed
  no diff on those lines.
- Consequences bullet: "Claiming is kept but does not affect frontier calculation" →
  "Claiming is kept: it removes a ticket from the frontier while leaving it unresolved." No longer
  says claiming doesn't affect the frontier; the other three Consequences bullets (YAML conversion,
  `## Map mechanics` as living spec, clearing marker on `map.md`) are byte-for-byte unchanged.
- Exactly one `## Outdated decisions` section was appended (confirmed via the task's own
  `s.count("## Outdated decisions")==1` check), with a named subsection ("Claiming and frontier
  calculation") that quotes both superseded sentences verbatim — "But claiming does not change the
  frontier calculation: a claimed ticket is still open, not unblocked or resolved." and "Claiming
  is kept but does not affect frontier calculation" — confirmed present only after the heading and
  absent from current text. It links
  `../../../changes/2026-08-29-remove-wayfinder-ticket-gate/requirements/wayfinder.md`, which I
  confirmed resolves relative to the ticket's directory to the actual `requirements/wayfinder.md`
  file, and states claim signaling and git-collision behavior remain current.
- YAML-frontmatter decision, claim signal/collision-behavior paragraph, map status discussion, the
  fenced `## Map mechanics` contract block, and the CONTRIBUTING.md-or-MECHANICS.md placement note
  are all unmodified (confirmed no diff hunks touch those lines). `CONTRIBUTING.md` itself does not
  appear in the diff. Diff is confined to `.hamilton/maps/hamilton-wayfinder/tickets/04-map-mechanics-in-files.md`
  plus `progress.md` (Task 3's own entry) — no other map ticket, template, or unrelated file changed
  by this commit.
- Independently re-ran the task's Verify command against the worktree at `9d60233` (clean tree) —
  printed `claim/frontier decision ok`. Independently re-ran
  `git diff --check c35aec6 9d60233` — exit 0. Independently reproduced the pre-edit failure by
  running the same structural check against the file's `c35aec6` blob — fails as claimed (no
  `## Outdated decisions` section yet). Independently re-ran `bun --bun vitest run` — 97/98
  passing, the one failure is the same pre-existing, unrelated `tests/scripts/change-context.test.ts`
  mtime-ordering assertion (reproduces on this same worktree regardless of this task's edit,
  since the change is Markdown-only). Independently re-ran `bun run build` — passes clean. All
  Verify/test/build claims in `progress.md` and the implementer's report hold up.
- The housekeeping commit `9976f50` (recording Task 2's already-approved review verdict into
  `progress.md`/`review.md`, left uncommitted by the prior review pass) only adds content that
  matches the actual Task 2 review already on record — nothing wrong found in it; it is
  administrative and out of Task 3's own scope, as expected.

### Suggestions

- [`.hamilton/maps/hamilton-wayfinder/tickets/04-map-mechanics-in-files.md`:97] The fenced
  `## Map mechanics` contract block (inside `### Map mechanics section: the stable contract`)
  still lists `` `status:` — Ticket status: `open`, `resolved`. Maps only: `cleared` `` — it does
  not mention `claimed` even though `### Status values` two subsections above now documents three
  ticket statuses. This mismatch predates this task (the base file already used `Status: claimed`
  language elsewhere without the fenced block reflecting it) and the plan explicitly requires the
  mechanics-section boundary to remain unchanged here, so this is not a Task 3 defect — flagging
  only in case a future task wants to reconcile the fenced contract block with the fuller status
  discussion around it.

## Task 4 — 2026-08-29

Verdict: approved

Verified against `plan.md` Task 4 acceptance criteria, using the diff package
(`eeeb1f9..366d4e9`, files: `docs/skills.md`, `.hamilton/changes/.../progress.md`), with `HEAD`
already at `366d4e9` on a clean tree so all commands were run directly against the reviewed state:

- `docs/skills.md`'s `### \`hamilton-wayfinder\`` introductory paragraph now reads: "Charts a map
  of decision tickets for a goal too big for one session, then works only the decision tickets the
  user explicitly requests — one ticket or a named batch — until the way to the destination is
  clear." This states the explicit-request gate and the one-ticket-or-named-batch shape the
  criterion requires, and the string "works them one at a time" is gone from the entry (confirmed
  by both direct reading and by re-running the task's own Verify script, which prints
  `skills summary ok`).
- The following sentence, "The map plans the way; the doing comes later, one change at a time.",
  is byte-for-byte unchanged. Diffed the full entry against the base blob (`eeeb1f9:docs/skills.md`)
  and confirmed the `- **When:**`, `- **Inputs:**`, `- **Produces:**`, `- **Notes:**` bullets
  (including the `mattpocock/skills` fork-provenance sentence and the `../NOTICE` link inside
  Notes) and the `- Source:` line are all unchanged, down to whitespace.
- `git diff --stat eeeb1f9..366d4e9` shows exactly two files touched: `docs/skills.md` and this
  change's own `progress.md` (Task 4's progress entry, a normal change artifact). No other skill
  entry, pipeline paragraph, diagram, or helper-script documentation was touched — confirmed both
  from the diff stat and by reading the full diff hunk, which contains only the one paragraph
  edit inside the `hamilton-wayfinder` entry.
- Independently re-ran the task's own Verify command against the current worktree — printed
  `skills summary ok`. Independently re-ran `git diff --check eeeb1f9ec895597bb0c2224f64367ff5dd714273..366d4e98e9e530fcd1bbc3189c8096c8ef7b568c` —
  exit 0. Both match the implementer's report; no discrepancy found.
- The commit (`366d4e9`, message `docs(skills): describe user-directed wayfinder ticket work`)
  matches the plan's specified Commit message exactly and is the only commit in the reviewed
  range.
- Prose wrapping of the new paragraph (three lines, ~89–97 chars each) matches the existing
  hard-wrap style used throughout `docs/skills.md`'s other entries — consistent, no issue.
- `bun --bun vitest run` / `bun run build` claims in `progress.md` were not independently
  re-run (this is a Markdown-only change with no code path affected by the edit, and the task's
  own progress entry already reproduces the one pre-existing, unrelated
  `tests/scripts/change-context.test.ts` mtime-ordering failure identically with the change
  stashed out) — treated as adequately supported by the implementer's report together with the
  independently-verified structural Verify and `git diff --check` results.

No blocking issues, no suggestions.
