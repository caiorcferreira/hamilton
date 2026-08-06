# Review: Land the wayfinder artifact templates, Task 2 — 2026-08-06

Verdict: approved

## Summary

Task 2 is implemented correctly and completely. The wayfinder ticket template follows Hamilton's template idiom exactly, extends the test coverage correctly, and is verified passing by a full suite run. All constraints from design.md and the plan are honored.

**Verified:**
- Template structure matches plan exactly (lines 105–126): comment block above frontmatter, YAML with three fields in correct order, `## Question` section with inline hint
- **Critical requirement met:** No `## Answer` section (explicitly required by acceptance criteria line 100)
- Frontmatter carries exactly the three required fields: `type` (with default `grilling`), `status` (with default `open`), `blocked_by` (with default `[]`)
- Comment block follows established idiom from Task 1: names artifact, producer (hamilton-wayfinder), location (`.hamilton/maps/<effort>/tickets/NN-slug.md`), and includes deletion instruction
- Two-line explanation "Sized to a single agent session; the answer is appended and the status flipped to resolved when the ticket closes" matches plan specification (line 111) exactly
- Inline hint for `## Question` section is present and correctly scoped
- Template does not document the frontmatter values via extra fields — design.md states this correctly (lines 36–40): "Templates encode frontmatter syntax, not the mechanics contract," and the frontmatter examples (`type: grilling`, `status: open`) demonstrate valid values without over-specifying
- `WAYFINDER_TEMPLATE_FILES` constant extended on line 21 of `tests/cli/setup.test.ts` with new entry, positioned to support Task 3
- Existing test `it("copies wayfinder artifact templates")` inherited from Task 1 now covers the new template automatically
- All 12 setup tests pass; all 24 tests in full suite pass; build clean with no typecheck errors
- No code comments; no filesystem mocks; uses real temp directories via `HOME` redirection (established seam)

**Content verification (against design.md and plan.md):**
- Decision: "Templates encode frontmatter syntax, not the mechanics contract" — template carries the YAML shape and default values, not a restatement of the mechanics contract. Correct. ✓
- Decision: Values documented in comment block or inline hints "whichever reads better" — frontmatter examples show valid values; the comment block documents behavior (lifecycle) not field enumeration. Matches Task 1 pattern and was approved there. ✓
- No route-level status or frontmatter (that constraint is for Task 3's route template). N/A here. ✓

No blocking issues or suggestions.

## Review: Land the wayfinder artifact templates, Task 3 — 2026-08-06

Verdict: approved

## Summary

Task 3 is implemented correctly and completely. The wayfinder route template follows Hamilton's template idiom exactly, correctly carries no frontmatter and no route-level status as required by design and requirements, extends the test coverage correctly, and is verified passing by a full suite run. All constraints are honored and all acceptance criteria satisfied.

**Verified:**
- Template structure matches plan exactly (lines 149–177): comment block with artifact name, producer, location, explanation, deletion instruction; followed by title, preamble hint, and `## Units` section with per-unit structure
- **Critical requirement met:** No frontmatter and no top-level status line (explicitly required by acceptance criteria lines 142, 68–72)
- **Critical requirement met:** Route-level structure carries only title, preamble, and `## Units` — no `## After the route` section or other sections (design.md line 44, plan line 144)
- Comment block follows established idiom from Tasks 1 and 2: names artifact (Route), producer (hamilton-wayfinder), location (`.hamilton/maps/<effort>/route.md`), includes two-line explanation, includes deletion instruction
- Two-line explanation "Written once when the map clears; it points at the decisions that back each unit and does not restate them. Each unit runs the SDD loop once and flips its own status on its own branch" matches plan specification (lines 155–157) exactly
- `## Units` section templates a unit correctly: name (`### 1. <Unit name>`), Status line (`Status: pending`), dependencies line (`Depends on: —`), decision links (`Backed by: [<ticket title>](tickets/NN-slug.md)`), goal paragraph (hinted via inline comment)
- Status field shows example value `pending`, consistent with Task 1 pattern of showing examples rather than enumerating all valid values; the three allowed values (pending|in-progress|shipped) are specified in plan step 3 line 170
- Inline hints present and correctly scoped: preamble hint explains what the preamble section is for; goal hint explains the paragraph is for orientation, not specification
- Template does not template per-unit "suggested entry" field — design.md decision (line 144: "do **not** template it") and plan requirement (line 143) both honored
- `WAYFINDER_TEMPLATE_FILES` constant completed on line 63 of `tests/cli/setup.test.ts` with final entry `"wayfinder/route.md"`, now holding all three wayfinder templates
- Existing test `it("copies wayfinder artifact templates")` (inherited from Task 1, extended by Task 2) automatically covers this template and verifies installation
- All 24 tests pass including the new route template test; build clean with no typecheck errors
- No code comments; no filesystem mocks; uses real temp directories via `HOME` redirection (established seam)

**Design compliance:**
- Decision: "route.md carries no frontmatter and no route-level status" (design.md line 42) — template has no frontmatter, no route-level Status line. Correct. ✓
- Decision: "Templates encode frontmatter syntax, not the mechanics contract" (design.md line 36) — route carries syntax examples (Status, Depends on, Backed by) with no explanation of the mechanics or values. Correct. ✓
- Decision: Status only per unit, not at route level (design.md lines 42–46) — verified no route-level status field. ✓
- Rationale: status belongs to the map's frontmatter and to each unit individually; template correctly reflects this (design.md line 142, plan step requirement line 142). ✓

**Requirements compliance:**
- Requirement: *Nested template installation*, scenario *Templates in a subdirectory are installed* — template file at correct path, will be installed by Task 4's `copyTemplates` change. ✓
- Requirement: *Wayfinder artifact template set*, scenario *The route template carries units, not a route-level status* — template has no frontmatter, no top-level status, units are templated per spec. ✓
- Requirement: *Wayfinder artifact template set*, scenario *Each template follows Hamilton's template idiom* — comment block + inline hints + deletion instruction match established pattern. ✓

**Relationship to prior tasks:**
- Task 1 (map template) and Task 2 (ticket template) established the comment-block idiom and template conventions; Task 3 carries these forward consistently. ✓
- Task 3 completes the `WAYFINDER_TEMPLATE_FILES` array started in Task 1, extended in Task 2, and now finalized with all three templates. ✓
- Task 1 test "copies wayfinder artifact templates" now covers all three templates via the completed array. ✓

No blocking issues or suggestions.

## Review: Land the wayfinder artifact templates, Task 4 — 2026-08-06

Verdict: approved

## Summary

Task 4 is implemented correctly and completely. The `copyTemplates` return expression is refactored exactly as specified to support nested template reporting, the test assertion is meaningful and will catch regressions, and all acceptance criteria are met. The code is verified passing by a full suite run with no typecheck errors. All constraints are honored.

**Verified:**

- **Return expression logic matches plan exactly** (plan step 3, lines 203–208): The three operations (`filter(isFile)`, `map(normalize)`, `sort()`) execute in the correct order with correct semantics.
  - `Fs.readdirSync(destTemplates, { recursive: true })` with `{ recursive: true }` option ✓
  - `.filter((name) => Fs.statSync(Path.join(destTemplates, name)).isFile())` still runs on platform-separator names, so `Path.join` resolves correctly ✓
  - `.map((name) => name.split(Path.sep).join("/"))` normalizes each path to `/` separators after filtering ✓
  - `.sort()` orders the normalized strings for stable output across platforms ✓
  - TypeScript cast `as string[]` (added for type safety) is functionally transparent and necessary for build to pass; documented in progress notes ✓

- **Test assertion quality:** `expect(exit.value).toContain("wayfinder/map.md")` added to `it("returns installed template filenames")`
  - **Would fail if regressed to flat read** — removing `{ recursive: true }` returns only top-level files, so nested `wayfinder/map.md` would be missing ✓
  - **Would fail if normalization was removed** — platform-specific separators (`wayfinder\map.md` on Windows) would not match the expected `wayfinder/map.md` ✓
  - Works in conjunction with existing `expect(exit.value).toContain("plan.md")` assertion, which proves top-level templates retain bare names (the `split().join()` normalization does not affect files with no `Path.sep`) ✓

- **All acceptance criteria met:**
  1. `setupHamilton` returns wayfinder templates in installed list, named by path relative to templates root with `/` separators — ✓ Normalization step ensures this
  2. Top-level templates keep bare names with no prefix — ✓ Unchanged existing assertion `toContain("plan.md")` still passes
  3. Directory entries excluded from report — ✓ `isFile()` filter unchanged and still present
  4. Bundle with no `templates` directory succeeds and reports nothing — ✓ Early return (line 46) unchanged
  5. Nothing else in `copyTemplates` changes; unused `options?: { force?: boolean }` parameter preserved exactly — ✓ Parameter still present, unused, untouched per design constraint (plan line 195, design.md line 81)

- **Code quality:**
  - Function maintains single responsibility: copy templates and report installation ✓
  - No new dependencies or external coupling ✓
  - Existing testable seams unchanged (tests via HOME redirection and HAMILTON_BUNDLE_DIR) ✓
  - No unnecessary abstractions or helpers added ✓
  - No code comments (per AGENTS.md) ✓
  - Linear pipeline fits on screen; no excess complexity ✓

- **Scope adherence:**
  - Only files modified: `src/cli/commands/setup.ts`, `tests/cli/setup.test.ts`, `progress.md` (expected) ✓
  - No changes to `.hamilton/maps/hamilton-wayfinder/`, no SKILL.md edits, no wayfinder prose in `docs/` ✓
  - No stubs, debug output, or commented-out code ✓

- **Test results:** `bun --bun vitest run tests/cli/setup.test.ts` → 12/12 passing; `bun run test` → 24/24 passing; `bun run build` → clean, no typecheck errors ✓

**Design compliance:**

- Decision: "Report the installed set with a recursive directory read" (design.md lines 30–34) — implementation matches the chosen alternative: recursive read, `isFile` filter on native-separator names, normalization after filter and before sort. ✓
- Rationale: "smallest change that makes the report honest, and it preserves the function's existing contract of describing the destination." Implementation honors this: only the return value's shape changes (now includes nested paths), not the function's purpose or interface. ✓
- "Separator normalization matters because Hamilton ships cross-platform binaries and the reported name should match the path a skill would cite" — implementation uses `name.split(Path.sep).join("/")` exactly for this purpose. ✓

**Requirements compliance:**

- Requirement: *Complete installation report*, scenario *Nested templates appear in the report* — nested templates now reported with paths relative to templates root ✓
- Requirement: *Complete installation report*, scenario *Top-level templates keep their bare names* — existing assertion proves this ✓
- Requirement: *Complete installation report*, scenario *The report counts files, not top-level entries* — `isFile()` filter excludes directory entries ✓
- Requirement: *Nested template installation*, scenario *A bundle with no templates directory installs nothing* — early return unchanged ✓

**Relationship to prior tasks:**

- Tasks 1–3 installed three nested templates into `bundle/templates/wayfinder/`; Task 4 enables the report to surface them ✓
- The `WAYFINDER_TEMPLATE_FILES` constant built by Tasks 1–3 is now fully utilized by Task 4's assertion ✓
- No dependencies between Task 4 and Task 5 (both depend on Task 3); Task 4's code changes are fully independent of template content ✓

No blocking issues or suggestions.
