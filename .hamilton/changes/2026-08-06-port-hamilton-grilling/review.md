# Review: Task 1 — Port the grilling protocol into `skills/hamilton-grilling/SKILL.md`

## Verdict

**approved**

## Summary

Task 1 ports the grilling dialogue skill from `~/.claude/skills/grilling/SKILL.md` into `skills/hamilton-grilling/SKILL.md` with byte-exact protocol text and appropriate adaptation of frontmatter. All acceptance criteria are met: the four instruction paragraphs are byte-identical to upstream (verified by diff command stripping frontmatter, description, and provenance), the frontmatter carries `name` and `description` only, `description` is wrapped in double quotes per repository style while text remains unchanged, no `disable-model-invocation` key is present enabling skill-to-skill reach, the provenance pointer is appended at file end with em dash (U+2014) exactly as specified, the body is caller-agnostic with no mention of wayfinder, pipeline, artifact, or finding terms, and upstream's `agents/openai.yaml` sidecar is not ported. The implementation is correct and independent; the verify command passed, tests green (24/24 passing), and build clean.

**Note:** This review was recorded on 2026-08-06 after the whole-branch merge gate identified the missing audit-trail entry. The code under review is unchanged from the original pass (commit `8890b29` amended only `progress.md` format; `git diff d03bbc2 8890b29 -- skills/` is empty).

## Blocking Items

None.

## Suggestions

None.

## Notes

- **Protocol integrity.** Lines 6–12 of `skills/hamilton-grilling/SKILL.md` (the four instruction paragraphs separated by single blank lines) are byte-identical to upstream. Verified via the diff command `diff <(grep -vE '^(---|name:|description:|Adapted from |$)' ~/.claude/skills/grilling/SKILL.md) <(grep -vE '^(---|name:|description:|Adapted from |$)' skills/hamilton-grilling/SKILL.md)` which returns no output (success). This filters away frontmatter, description line, provenance line, and blank lines, leaving only the protocol text for comparison.
- **Upstream em dash preserved.** The third instruction paragraph contains the em dash (U+2014) character exactly as in upstream. The implementer's report confirms byte-for-byte copy to preserve this character, and the verify command would catch any substitution of hyphen or other dash variant.
- **Frontmatter: name and description only.** Frontmatter lines 1–4 carry exactly two keys: `name: hamilton-grilling` and `description: "..."`. No `disable-model-invocation` key present (verified by check `! grep -q 'disable-model-invocation' skills/hamilton-grilling/SKILL.md`), ensuring the skill remains reachable by other skills at the model level, satisfying the requirement *Reachable by other skills*.
- **Description text unchanged, wrapped in quotes.** The description text from upstream (`Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.`) is preserved exactly, including the single quotes around 'grill'. It is wrapped in double quotes in YAML frontmatter, matching the style of all nine other `skills/*/SKILL.md` files in the repository per `skills/hamilton-grilling/SKILL.md` (line 3).
- **Provenance line: em dash and format correct.** Line 14 appends the one-line provenance pointer exactly as specified: `Adapted from the "grilling" skill in [mattpocock/skills](https://github.com/mattpocock/skills), used under the MIT License — see the \`NOTICE\` file beside this one.` The em dash between "License" and "see" is U+2014, matching the plan's specification. Backticks around `NOTICE` are present per requirement. The file ends with a newline after this line (diff shows 14 lines added; file ends correctly).
- **Caller-agnostic protocol.** The protocol body (lines 6–12) contains no mention of:
  - Wayfinder, wayfinder-specific terms, or Hamilton-specific vocabulary
  - Pipeline, workflow, or execution-model terms
  - Artifacts, findings, deliverables, or output structures
  - Approaches, methods, or design concepts specific to any caller
  The text is pure protocol: how questions are posed (one at a time), how they are answered (with a recommendation), how facts are resolved (by environment lookup), where decisions lie (with the human), and when action is permitted (after shared understanding is confirmed). This satisfies *The protocol is caller-agnostic*.
- **`agents/openai.yaml` not ported.** The diff and final tree contain only `skills/hamilton-grilling/SKILL.md` and progress.md. Upstream's `agents/openai.yaml` sidecar (which carries display metadata for a different agent host) is correctly excluded per decision: the verbatim rule governs protocol instruction, not packaging metadata, and no Hamilton skill ships an `agents/` file.
- **Tests and build.** The implementer ran `bun run test` (24/24 tests passing, 3 files) and `bun run build` (clean, no typecheck errors) as required. Since `skills/` is outside `bundle/`, `hamilton setup` does not install it, and no test in the repository asserts on skill content, these gates serve to confirm the change touched nothing it should not have. Both passed.
- **File placement and accompanying work.** The new file is created at `skills/hamilton-grilling/SKILL.md` as specified. Task 2 (not reviewed here) creates the accompanying `skills/hamilton-grilling/NOTICE` file with upstream attribution. This two-file pattern is designed to allow the skill directory to travel outside the repository with full provenance intact, per `.hamilton/specs/licensing.md` and `CONTRIBUTING.md`.

# Review: Task 2 — Add the sibling `NOTICE` for `hamilton-grilling`

## Verdict

**approved**

## Summary

Task 2 creates the sibling `NOTICE` file for the `hamilton-grilling` skill with byte-exact compliance to the template in `CONTRIBUTING.md`. All acceptance criteria are met: the permission block is reproduced byte-for-byte (including trailing whitespace on blank lines), all three placeholders are correctly substituted in the header, Hamilton's modification copyright line is present, no unshipped skill directories are asserted, and the file ends with a newline. The verify command passes without error. No issues found.

## Blocking Items

None.

## Suggestions

None.

## Notes

- **Trailing whitespace verification**: The blank lines within the MIT block carry exactly two trailing spaces, matching the source template in `CONTRIBUTING.md` (verified with `cat -A`). This is the most fragile aspect of the task and was handled correctly.
- **Placeholder substitution**: All three placeholders in lines 1–2 are correctly replaced:
  - `<upstream skill name>` → `grilling`
  - `<upstream project>` → `mattpocock/skills`
  - `<upstream project URL>` → `https://github.com/mattpocock/skills`
- **Scope compliance**: The file makes no assertion of skill directories beyond the upstream "grilling" skill, satisfying `.hamilton/specs/licensing.md` invariant (line 52): "A notice file MUST NOT assert the existence of a skill directory that has not shipped."
- **File structure**: The NOTICE file is correctly placed at `skills/hamilton-grilling/NOTICE` alongside `SKILL.md`, and the SKILL.md file already carries the required provenance pointer referencing this `NOTICE` file.
- **Verify command**: The accept-gate command passes with no diff output, confirming byte-exactness of the permission block and absence of remaining placeholders.

# Review: Task 3 — Flip route unit 4 to shipped

## Verdict

**approved**

## Summary

Task 3 flips the status of unit 4 (Port hamilton-grilling) in the route from `pending` to `shipped`. The change is minimal, precise, and meets all acceptance criteria: the `### 4. Port hamilton-grilling` section now shows `Status: shipped`; the status flip is the only change to `route.md` (one line changed: one insertion, one deletion); and no other unit's status is altered. The commit message conforms to the conventional format. Progress.md correctly documents the task completion. The flip is truthful: Tasks 1 and 2 have established that `skills/hamilton-grilling/SKILL.md` and `skills/hamilton-grilling/NOTICE` exist and ship the grilling protocol with proper attribution as unit 4's description promises.

## Blocking Items

None.

## Suggestions

None.

## Notes

- **Status flip location**: The change occurs under the correct heading `### 4. Port hamilton-grilling` at line 100 of the route, changing `Status: pending` to `Status: shipped`.
- **Singular change to route.md**: Verified via `git diff --stat` showing only 2 lines changed (1 insertion, 1 deletion) and grep showing only one status line modified across the entire file. No other unit's status is affected.
- **Truthfulness of the flip**: Unit 4's description states "Ships with its sibling `NOTICE` and the one-line provenance pointer in `SKILL.md`." Both artifacts are present in the tree (verified via `git show`):
  - `skills/hamilton-grilling/SKILL.md` exists with correct frontmatter, protocol text, and provenance line
  - `skills/hamilton-grilling/NOTICE` exists with correct attribution from mattpocock/skills and Hamilton copyright
  - Both files are verified in Tasks 1 and 2 with diff commands returning `OK` and tests passing
- **Commit convention**: Commit message "docs: flip route unit 4 to shipped" follows the expected `docs:` prefix for bookkeeping changes and matches the plan requirement.
- **Progress.md documentation**: Task 3 entry added with complete and accurate verification results, matching the pattern established in Tasks 1 and 2.
- **Tests and build**: `bun run build` clean, `bun run test` 24/24 passing (3 files) — confirming no unintended side effects.

# Review: Whole-branch merge gate

## Verdict

**changes-requested**

## Summary

The port-hamilton-grilling change is structurally sound and implements the design correctly. All acceptance criteria from the plan are met: the upstream grilling skill is ported byte-identically, the NOTICE is instantiated correctly from the template, the route status is flipped, and all requirement scenarios are satisfied. The skill is caller-agnostic, reachable by other skills, and properly attributed.

However, the per-task review structure is incomplete: Task 1's formal review verdict is missing from `review.md` and `progress.md`. Tasks 2 and 3 both have explicit formal reviews recorded with "approved" verdicts, and each earned a separate review-recording commit. Task 1 has neither a formal review entry in `review.md` nor a review-recording commit. The Verify command passed and the implementation is correct, but the audit trail is incomplete.

This is a structural issue with the change directory documentation itself, not the implementation.

## Blocking Items

1. **Missing Task 1 formal review in review.md**: The file contains formal reviews with verdicts for Tasks 2 and 3 (each starting on separate lines, with explicit "Review: approved" sections in progress.md), but Task 1 is missing. The per-task review structure is incomplete. While the task implementation itself is correct (the SKILL.md protocol is byte-identical to upstream, tests and build passed), the formal review verdict was never recorded. This breaks the audit trail expected by the change structure, where "All review feedback has been addressed" requires all task reviews to exist.

## Suggestions

None arising from the implementation.

## Notes

### Implementation verification—all criteria met

**Protocol integrity.** The instruction text in `skills/hamilton-grilling/SKILL.md` (lines 6–12) is byte-identical to upstream (`~/.claude/skills/grilling/SKILL.md`). The four paragraphs are separated by single blank lines, have no trailing whitespace, and the em dash (U+2014) in the third paragraph is preserved exactly. Verified via diff command: protocol lines stripped of frontmatter and provenance line are identical.

**Frontmatter and name.** The skill's name is `hamilton-grilling` (changed from upstream's `grilling`). The description text is unchanged from upstream, wrapped in double quotes (matching sibling skill style per YAML convention). No `disable-model-invocation` key is present, allowing both direct human invocation and skill-to-skill reach. Frontmatter contains only `name` and `description`.

**Provenance pointer.** The trailing line references the upstream skill name (`grilling`), its license (`MIT License`), and the sibling `NOTICE` file. The em dash is correctly encoded as U+2014.

**Caller-agnostic boundary.** The protocol text contains no mention of wayfinder, pipeline, artifacts, findings, approaches, or any context-specific vocabulary. It is pure protocol: question structure, recommendation-leading, environment lookup, human-side decisioning, shared-understanding gate.

**NOTICE compliance.** The file at `skills/hamilton-grilling/NOTICE` is byte-identical to the template in `CONTRIBUTING.md` (lines 38–65, permission block from "Original work:" to "SOFTWARE.") except for the three placeholder substitutions in the header: `<upstream skill name>` → `grilling`, `<upstream project>` → `mattpocock/skills`, `<upstream project URL>` → `https://github.com/mattpocock/skills`. Trailing whitespace is preserved (the blank lines in the MIT block each carry two trailing spaces). Hamilton's modification copyright line is present and unchanged from template.

**Route status.** The file `.hamilton/maps/hamilton-wayfinder/route.md` shows `Status: shipped` for unit 4 (Port hamilton-grilling). Only this one line changed; no other unit's status was altered.

**Requirement scenarios.**
- *One question at a time*: "Ask the questions one at a time, waiting for feedback on each question before continuing." ✓
- *Every question leads with recommendation*: "For each question, provide your recommended answer." ✓
- *Facts are looked up, decisions are asked*: "If a *fact* can be found by exploring the environment (filesystem, tools, etc.), look it up rather than asking me. The *decisions*, though, are mine — put each one to me and wait for my answer." ✓
- *Human's side never answered for them*: "The *decisions*, though, are mine — put each one to me and wait for my answer." ✓
- *No action before shared understanding*: "Do not act on it until I confirm we have reached a shared understanding." ✓
- *Caller-agnostic*: Protocol owns the how; caller owns the what and when. ✓
- *Reachable by other skills*: No `disable-model-invocation`; frontmatter only; both direct and skill-to-skill reach available. ✓
- *Text is upstream's unmodified*: Verified byte-identical via diff; adaptation surface only. ✓

**Proposal promises.** All goals met: skill exists and is reachable, body is upstream's unmodified, skill owns protocol only and is caller-agnostic, attribution travels with directory (NOTICE + provenance pointer), route unit 4 is shipped. All non-goals properly excluded: no call sites, no docs entry, no unattended mode, no trimming, no tests, no root NOTICE changes.

**Deliberate deviations (recorded in design).** The description ports unpruned despite the route's craft focus (accepted user decision, recorded as risk). The skill ships undocumented pending unit 9 (recorded as risk, noted in proposal Impact). Neither creates a second reason to change or a structural leak; both are explicitly noted.

**Change directory structure.** The directory contains proposal.md, requirements/dialogue.md, design.md, plan.md, progress.md, and review.md (this one), all in place. The skills directory contains exactly two files (SKILL.md and NOTICE), as designed—no extra files, no references/ directory. Architecture & Components section of design.md is satisfied: two leaf files with no dependencies.

**Dependency correctness.** The skill has no runtime dependencies on `.hamilton/`, the pipeline, or wayfinder. It is callable from any context unchanged. This is the property that made placing it at the Hamilton level (rather than inside wayfinder) necessary.

### Documentation gap

**Task 1 review missing.** The `review.md` file (lines 1–58) contains formal reviews for Tasks 2 and 3. Each has a "Verdict" section explicitly marking them "approved". The `progress.md` file has corresponding "Review:" entries for Tasks 2 and 3. Task 1 is absent from both: `review.md` contains no Task 1 review section; `progress.md` Task 1 entry has "Verified:" but no "Review:" field. The git log confirms: commits `e705a09` and `f2e0d88` record Task 2 and Task 3 reviews, but no commit records Task 1's review. This is a structural omission in the audit trail, even though the task's implementation is correct and its Verify command passed.
