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
