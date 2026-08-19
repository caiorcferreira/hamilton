<!--
  Review — the review artifact for a change.
  Lives at: .hamilton/changes/<change>/review.md
  Written by the review step each pass: the verdict plus located, actionable feedback the
  coder acts on. Newest pass at the bottom. progress.md keeps the one-line timeline.
  <scope reviewed> is machine-checkable: exactly "Task <N>" or "whole change" —
  finish-work's gate reads these values.
-->

# Review: Wayfinder branching and operation rules

## Task 1 — 2026-08-19

Verdict: approved

Verified against plan.md Task 1 and requirements/ticket-resolution.md ("Branch created before
code", "Standalone invocation"):

- `bundle/scripts/hamilton-prototype-branch.sh` implements all three modes correctly: create
  mode (`<map-name> <ticket-name>` → `prototype/<map-name>/<ticket-name>`), `--standalone
  <slug>` → `prototype/<slug>`, and `--verify <expected-branch>`. Traced the control flow by
  hand: argument-count validation happens before the `require_repo` guard in every branch,
  `main()` has no trailing `exit`, so the script's final exit status is whatever `cmd_switch`/
  `cmd_verify` returned — 0 on create/resume success, 1 only on `--verify` mismatch (via
  `return 1`), 2 via `die()` for usage/environment errors. This matches the plan's exit-code
  contract exactly and mirrors `hamilton-isolate.sh`'s structure (`usage()`/`die()`/
  `require_repo()`, no `set -e`, quoted variable expansions, last line load-bearing).
- Existing-branch resume path (`git show-ref --verify --quiet refs/heads/<branch>` →
  `git switch` + `mode: resumed`) matches the design's "branch is the ticket's identity"
  decision; create path uses plain `git switch -c`, so uncommitted (untracked) changes ride
  along as specified — no stash, no dirty-tree guard, matching the design's accepted
  trade-off.
- `tests/scripts/prototype-branch.test.ts` implements exactly the 8 cases plan.md's Step 1
  enumerates (create+switch, uncommitted file survives, resume, standalone, verify
  success/failure, no-args exit 2, non-repo exit 2), follows `isolate.test.ts`'s structure and
  `helpers.ts`'s `run`/`git`/`makeRepo`/`field` seam (no mocks), and each assertion checks
  observable state (branch via `git branch --show-current`, `mode` field, `lastLine`, file
  survival, exit status) rather than implementation details — would fail if the script
  regressed.
- No comments in the TypeScript test file; the bash script's header/usage comments follow
  `hamilton-isolate.sh`'s own idiom, which the plan explicitly directs ("in the style of
  hamilton-isolate.sh").
- `hamilton-isolate.sh` untouched; no frontier/claim/ticket-type/map-lifecycle files touched.
- The known `tests/cli/setup.test.ts` failure (expected-scripts list missing the new script
  name) is Task 2's responsibility per plan.md and is correctly left untouched here — not a
  Task 1 defect.

### Suggestions

- [`.hamilton/changes/2026-08-19-wayfinder-branching-and-operation-rules/plan.md`] The commit
  bundles a 144-line planning artifact (never committed by the prior planning session) into
  Task 1's commit, alongside the new `progress.md`. The report's stated rationale (nothing
  should stay uncommitted under the change directory, and no later task's Files list claims
  `plan.md`) is reasonable and the content itself is untouched, so this isn't blocking — but it
  is a file outside Task 1's declared Files list (`bundle/scripts/hamilton-prototype-branch.sh`,
  `tests/scripts/prototype-branch.test.ts`). Worth a one-line callout in the commit message or
  progress.md if this pattern recurs, so reviewers don't have to re-derive the rationale each
  time.
- [`tests/scripts/prototype-branch.test.ts:23`] "Carries an uncommitted change along the
  switch" only exercises an *untracked* file (`write()` without `git add`), which `git switch`
  always carries regardless of target branch. A modified-but-uncommitted *tracked* file would
  more directly test the "uncommitted changes ride along" claim (tracked-file edits are the
  case where `git switch` could in principle refuse). Not required by plan.md's Step 1 wording,
  which the test matches literally, so not blocking.

## Task 2 — 2026-08-19

Verdict: approved

Verified against plan.md Task 2 (single commit `5d34756`, diff confined to
`.hamilton/changes/2026-08-19-wayfinder-branching-and-operation-rules/progress.md`,
`docs/skills.md`, `tests/cli/setup.test.ts`):

- `tests/cli/setup.test.ts`'s `SCRIPT_FILES` array gains `"hamilton-prototype-branch.sh"` as
  the 5th entry, after `hamilton-precondition-check.sh` — correct alphabetical position
  (`precondition` < `prototype` at the third differing character, `e` vs `o`). Trailing comma
  added to the preceding line, syntax is valid.
- `docs/skills.md`'s Helper scripts section: "installs four scripts" → "installs five scripts"
  and "Three properties hold across all four" → "...all five", both exactly as the plan
  specifies. The new table row —
  `` `hamilton-prototype-branch.sh` | Create/resume `prototype/<map-name>/<ticket-name>` from
  the current branch (`<map> <ticket>`, `--standalone <slug>`) or confirm the checkout landed
  (`--verify <branch>`) | `wayfinder-prototype` `` — matches the plan's specified wording
  verbatim and follows the existing table's format (backtick-quoted script name and flags,
  em-dash-free prose, single "Called by" skill).
- Confirmed by direct file read (`sed -n '250,282p' docs/skills.md`) that the row sits
  correctly among the other four and that "Three properties hold across all five" reads
  naturally with the table above it.
- Scope: diff touches only the two files plan.md's Files list names plus the change's own
  `progress.md` (Task 2 entry + prior review's one-liner, consistent with the established
  per-task journaling pattern from Task 1). No production TypeScript beyond the test file, no
  `hamilton-isolate.sh`, no wayfinder skill files — all binding constraints held.
- `bundle/scripts/hamilton-prototype-branch.sh` (created in Task 1, already approved) is
  present and executable on disk, so the setup-test claim the implementer reports (15/15,
  full suite 98/98) is plausible; test execution itself was not independently re-run per
  review instructions.
- Cross-checked the report at
  `/private/tmp/claude-502/.../scratchpad/task-2-report.md` against the diff — its description
  of changes matches exactly what the diff shows; no discrepancies between claimed and actual
  changes.

No blocking issues, no suggestions.

## Task 3 — 2026-08-19

Verdict: approved

Verified against plan.md Task 3 and requirements/artifact-templates.md ("Map template
installed", "Operation rules distinguished from Notes"); diff confined to a single commit
(`094f552`) touching `bundle/templates/wayfinder/map.md` and this change's `progress.md` only:

- Frontmatter gains `branch:` (empty, to be filled at map creation) directly under
  `status: open`, followed by a hint comment: "branch names the branch the effort works from
  and merges back into, set at map creation" — matches the requirement's field meaning
  verbatim. The hint sits on its own line immediately after the closing `---`, following the
  same blank-line/hint-line/blank-line rhythm every other section hint in this file already
  uses (confirmed by diffing spacing against the Destination/Notes hints) — this is the only
  frontmatter field with a hint anywhere in `bundle/templates/`, so there's no competing
  precedent for a same-line YAML-comment style, and adopting the established HTML-comment
  idiom here is the more consistent choice, not a deviation from it.
- `## Operation rules` inserted between `## Notes` and `## Decisions so far`, with a hint
  stating it holds "prescriptive, per-session-binding rules on how working sessions operate
  (e.g. commit after resolving a ticket, delegate a job class to a named subagent), may be
  empty, and distinguished from Notes' orienting context" — reproduces the plan's required
  hint content and the requirement's "distinguish it from Notes" instruction word for word.
- Body section order confirmed by direct read: Destination, Notes, Operation rules, Decisions
  so far, Not yet specified, Out of scope — exactly the six sections in the required order,
  no seventh.
- Header comment block (including "Delete this comment block and every inline hint comment
  before finalizing") and the HTML-comment/delete-before-finalizing hint idiom are untouched
  and preserved throughout.
- Scope: `git diff --stat` confirms only `bundle/templates/wayfinder/map.md` and the change's
  own `progress.md` changed — no `route.md`, no skill files, no `CONTRIBUTING.md`, matching
  the plan's Files list and the binding constraint that only these two may change for this
  task. `requirements/` untouched (confirmed empty diff on that path).
- Cross-checked the implementer's report
  (`/private/tmp/claude-502/.../scratchpad/task-3-report.md`) against the actual diff — its
  line numbers and claims match what's on disk; no discrepancies.
- Test/build claims (98/98, clean build) not independently re-run per review instructions;
  plausible given the change is template-text-only with no code paths touched.

No blocking issues, no suggestions.

## Task 4 — 2026-08-19

Verdict: approved

Verified against plan.md Task 4 and requirements/artifact-templates.md ("Route template
installed"); diff (`094f552..d36ca17`) confined to `bundle/templates/wayfinder/route.md`
(7 insertions) and this change's `progress.md` (9 insertions) — `git diff --stat` confirms
no other file changed, matching the binding constraint.

- `## Shipping rules` (route.md:16) sits between the preamble hint (ends line 14) and
  `## Units` (line 23) — the required position.
- Hint (route.md:18-21): "how the units will be shipped — the branch units merge back into
  (seeded from the map's `branch:` field), commit and merge/PR conventions, and any standing
  shipping constraint every unit inherits, including shipping-relevant operation rules
  carried over from the map." — matches the plan's required hint content and the
  requirement's "seeded from the map's `branch:` field and shipping-relevant operation
  rules" clause word for word; covers branch/merge-back target, commit and merge/PR
  conventions, standing shipping constraints, and carried-over operation rules, i.e. all
  four elements the acceptance criterion lists.
- No frontmatter added — confirmed by reading the full file; the header comment block
  starts directly at `# Route — <Effort Name>` with no `---` YAML block, unchanged from
  before.
- Template idiom preserved: the new hint uses the same `<!-- hint: ... -->` HTML-comment
  style, indentation, and blank-line rhythm as every other section hint in the file (Units
  hint, preamble hint); no change to the header comment block or the
  delete-before-finalizing convention.
- Section body is otherwise empty (hint only, to be filled at route-writing time) —
  consistent with every other template section in this repo, which ship as hint-only
  scaffolding, not pre-filled prose.
- Cross-checked the implementer's report (task-4-report.md) against the diff: line numbers
  (16 for the heading, 23 for Units) match; claims of "16 insertions" vs. actual 7 in the
  route.md hunk is a minor report inaccuracy (the report's number appears to include the
  progress.md hunk lines too) but the file-level claims and grep output are otherwise
  accurate and don't affect the verdict.
- Test/build claims (98/98, clean build) not independently re-run per review instructions;
  plausible given the change is template-text-only with no code paths touched.

No blocking issues, no suggestions.
