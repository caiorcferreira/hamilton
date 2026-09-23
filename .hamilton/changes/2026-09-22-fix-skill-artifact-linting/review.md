---
artifact: review
change: 2026-09-22-fix-skill-artifact-linting
created: 2026-09-23
status: open
decision: rejected
---

# Whole-branch Review: Make Hamilton Artifact Authoring Lint-Valid

## Pass 1 — 2026-09-23

Base: 2512f85a7e0ee092e9f4e3ab6f08bd761a949ffa
Head: 57dc3a3bd99ee481d5cda32bf693ec999bb290d3
Verdict: changes-requested

### Blocking

- [src/workbench/artifact-body.ts:376,465; skills/hamilton-finish-work/SKILL.md:252-257] A first pending finish intent contains only `Attempt 1`, but the generic workflow validator still requires an Outcome and the new pairing check only permits an unmatched attempt when the expected attempt number exceeds one. The required lint gate therefore rejects the first finish intent before it can be committed or executed. Permit precisely the complete, physically final pending `Attempt 1` as well as later pending attempts without requiring an Outcome, while retaining strict pairing for completed histories; add a scoped-lint regression test for the first intent. Focused in-memory `validateArtifactBody` verification returned `missing-section` and `invalid-record` for `status: pending`, `result: pending`, and `Attempt 1` alone. (violates: requirements/workbench.md, “Lint accepts a persisted finish intent awaiting its outcome”; design decision “Align lint with precise legitimate lifecycle states”)
- [skills/hamilton-propose/SKILL.md:153-184; bundle/templates/requirements-change.md:7; bundle/templates/design.md:6] The proposer obtains configured Git name and email only for a new proposal, then creates author-bearing requirements and design artifacts without requiring the same identity. Their installed templates still suggest an agent author, and lint accepts any nonempty author; these two outputs can therefore retain a placeholder or agent attribution while still passing the new lint gate. Require each new proposal, requirements, and design artifact to use the configured Git name and email in the required author format, block on missing values, preserve recorded authors on edits, replace misleading template guidance, and assert all three outputs in the skill contract tests. (violates: requirements/artifact-templates.md, “Populate artifact authors from configured Git identity”; design decision “Populate author metadata from the repository Git identity”)

### Suggestions

- None.
