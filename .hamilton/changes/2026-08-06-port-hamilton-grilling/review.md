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
