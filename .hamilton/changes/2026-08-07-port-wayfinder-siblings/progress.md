# Progress: Port the three wayfinder siblings

## Task 1: Land hamilton-wayfinder-research verbatim — 2026-08-07

- Outcome: done
- Changed:
  - Created: `skills/hamilton-wayfinder-research/SKILL.md`, `skills/hamilton-wayfinder-research/NOTICE`
  - Modified: none
  - Deleted: none
- Verified: `diff <(curl -sS https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/research/SKILL.md) skills/hamilton-wayfinder-research/SKILL.md` → no output, exit 0. `sed 1,2d skills/hamilton-grilling/NOTICE | diff - <(sed 1,2d skills/hamilton-wayfinder-research/NOTICE)` → no output (MIT block byte-identical); `bun run test` → 24/24 tests passing (3 files); `bun run build` → clean, no typecheck errors
- Notes: Upstream SKILL.md copied byte-for-byte from mattpocock/skills/main/skills/engineering/research/, including trailing newline. NOTICE file created by copying skills/hamilton-grilling/NOTICE and changing only line 1 from `"grilling"` to `"research"`, preserving MIT license text and all other lines exactly. Two files created, no other changes.

## Task 1: Land hamilton-wayfinder-research verbatim — re-pass — 2026-08-07

- Outcome: done
- Changed:
  - Created: none
  - Modified: `skills/hamilton-wayfinder-research/NOTICE`
  - Deleted: none
- Verified: `sed 1,2d skills/hamilton-grilling/NOTICE > /tmp/t1-a.txt && sed 1,2d skills/hamilton-wayfinder-research/NOTICE > /tmp/t1-b.txt && diff /tmp/t1-a.txt /tmp/t1-b.txt` → no output (MIT block byte-identical with trailing spaces); `cat -A skills/hamilton-wayfinder-research/NOTICE` shows `··␊` on all four blank lines inside MIT block; `bun run test` → 24/24 tests passing; `bun run build` → clean
- Notes: NOTICE file re-homed by copying grilling/NOTICE byte-for-byte (via cp), then using `sed -i '' '1s/"grilling"/"research"/'` to change only line 1, preserving all trailing whitespace. The four blank lines inside the MIT block now correctly have two trailing spaces each, matching grilling/NOTICE exactly. This addresses the blocking review feedback.
