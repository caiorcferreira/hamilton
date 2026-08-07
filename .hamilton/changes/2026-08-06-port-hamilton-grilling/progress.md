# Progress: Port hamilton-grilling

## Task 1: Port the grilling protocol into `skills/hamilton-grilling/SKILL.md` — 2026-08-06

- Outcome: done
- Changed:
  - Created: `skills/hamilton-grilling/SKILL.md`
  - Modified: none
  - Deleted: none
- Verified: `diff <(grep -vE '^(---|name:|description:|Adapted from |$)' ~/.claude/skills/grilling/SKILL.md) <(grep -vE '^(---|name:|description:|Adapted from |$)' skills/hamilton-grilling/SKILL.md) && ! grep -q 'disable-model-invocation' skills/hamilton-grilling/SKILL.md && echo OK` → prints `OK`; `bun run build` → clean, no typecheck errors; `bun run test` → 24/24 tests passing (3 files)
- Notes: Upstream file copied byte-for-byte to preserve em dash (U+2014) in third paragraph. Frontmatter `name` changed from `grilling` to `hamilton-grilling`; `description` wrapped in double quotes (matching sibling skills style) while preserving text exactly including single quotes around 'grill'. Provenance line appended referencing MIT License and `NOTICE` file. Protocol text mentions no wayfinder, workflow, pipeline, artifact, or finding term per acceptance.

## Task 2: Add the sibling `NOTICE` for `hamilton-grilling` — 2026-08-06

- Outcome: done
- Changed:
  - Created: `skills/hamilton-grilling/NOTICE`
  - Modified: none
  - Deleted: none
- Verified: `diff <(sed -n '/^Original work:$/,/^  SOFTWARE\.$/p' CONTRIBUTING.md) <(sed -n '/^Original work:$/,/^  SOFTWARE\.$/p' skills/hamilton-grilling/NOTICE) && ! grep -q '<upstream' skills/hamilton-grilling/NOTICE && echo OK` → prints `OK`; `bun run build` → clean; `bun run test` → 24/24 tests passing (3 files)
- Notes: Permission block extracted from CONTRIBUTING.md template (lines 38-65) and copied byte-for-byte preserving trailing whitespace in blank lines within MIT block. Placeholders substituted in first two lines only: `<upstream skill name>` → `grilling`, `<upstream project>` → `mattpocock/skills`, `<upstream project URL>` → `https://github.com/mattpocock/skills`. MIT license text and Hamilton copyright line unchanged from template.
- Review: approved — byte-exact match to template with all placeholders correctly substituted; trailing whitespace preserved; file ends with newline.
