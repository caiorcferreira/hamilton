# Progress: Adopt Apache 2.0 and the attribution convention

## Task 1: Add the Apache 2.0 licence text — 2026-08-05

- Outcome: done
- Changed:
  - Created: `LICENSE`
  - Modified: none
  - Deleted: none
- Verified: `head -2 LICENSE && grep -c 'APPENDIX: How to apply' LICENSE && wc -l LICENSE` → `Apache License` / `Version 2.0, January 2004` header, count 1, 202 lines
- Notes: file is byte-identical to published Apache text; appendix placeholder `Copyright [yyyy] [name of copyright owner]` left untouched as required

## Task 2: Add the root NOTICE with upstream attribution — 2026-08-05

- Outcome: done
- Changed:
  - Created: `NOTICE`
  - Modified: none
  - Deleted: none
- Verified: MIT text diff (empty), copyright line count: 1
- Notes: MIT text is byte-identical to upstream source after 2-space indent removal; NOTICE file structure complete with Hamilton copyright and mattpocock/skills attribution
