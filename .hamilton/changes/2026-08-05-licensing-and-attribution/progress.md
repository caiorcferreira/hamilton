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

## Task 3: Declare the licence in package.json — 2026-08-05

- Outcome: done
- Changed:
  - Created: none
  - Modified: `package.json`
  - Deleted: none
- Verified: `node -e 'const p=require("./package.json"); if(p.license!=="Apache-2.0"||p.private!==true) process.exit(1); console.log("ok")'` → ok
- Notes: none

## Task 4: State the licence in the README — 2026-08-05

- Outcome: done
- Changed:
  - Created: none
  - Modified: `README.md`
  - Deleted: none
- Verified: `tail -8 README.md` → shows the `## License` section with links to both `[LICENSE](LICENSE)` and `[NOTICE](NOTICE)`, no prose describing origin of wayfinder skills
- Notes: none
