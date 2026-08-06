# Progress: Land the wayfinder artifact templates

## Task 1: Land the wayfinder map template — 2026-08-06

- Outcome: done
- Changed:
  - Created: `bundle/templates/wayfinder/map.md`
  - Modified: `tests/cli/setup.test.ts`
  - Deleted: none
- Verified: `bun --bun vitest run tests/cli/setup.test.ts` → 12/12 tests passing including `copies wayfinder artifact templates`; `bun run test` → 24/24 tests passing (3 files); `bun run build` → clean, no typecheck errors
- Notes: none
