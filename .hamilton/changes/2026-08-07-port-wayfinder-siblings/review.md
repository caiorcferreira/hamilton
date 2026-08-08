## Task 3: Land hamilton-wayfinder-prototype verbatim — 2026-08-08

Verdict: approved

### Verified

- **Byte-for-byte fidelity:** All three Markdown files (`SKILL.md`, `references/LOGIC.md`, `references/UI.md`) confirmed byte-identical to upstream via cached sources and direct `diff` comparison with no output.
- **NOTICE attribution:** Permission block byte-identical to `skills/hamilton-grilling/NOTICE` with trailing spaces preserved in the MIT indented block (two spaces on blank lines 9, 11, 17, 19); skill name on line 1 correctly changed from `"grilling"` to `"prototype"`.
- **Completeness:** Directory holds `SKILL.md` at root, both reference files in `references/` subdirectory, and sibling `NOTICE`; no omitted files.
- **Verbatim integrity:** Frontmatter `name` remains `"prototype"` (not yet `"hamilton-wayfinder-prototype"`), branch pointers still read `(LOGIC.md)` and `(UI.md)` (not yet `references/` paths), and no provenance line appended — all deferred to Task 4 as designed.
- **No premature re-homing:** The upstream reference to "implementation issue" in line 26 of `SKILL.md` is preserved intact; re-homing is Task 4's responsibility.
- **Regression guards:** `bun run test` passes 24/24; `bun run build` clean (no typecheck errors).
- **Commit structure:** Single commit with four files created (the three Markdown files plus `NOTICE`), progress.md updated, matching design's commit-split requirement for verbatim-first verification.

All design constraints honored; no structural defects.

## Task 4: Re-home prototype capture onto the ticket — 2026-08-08

Verdict: approved

### Verified

- **Adaptation surface compliance:** All six changes in `SKILL.md` are within authorized boundaries — frontmatter `name` field changed to `hamilton-wayfinder-prototype`; two branch pointers fixed to `references/LOGIC.md` and `references/UI.md`; rule 6 re-pointed from "implementation issue" to "resolving ticket's body" and from "the issue or a commit" to "that ticket's `## Answer`"; provenance line appended.
- **Re-homing completeness:** Grep for "docs/adr|CONTEXT.md|issue|where the repo already keeps" across the skill directory returns exit code 1 (no matches), confirming no unfinished re-homing destinations remain. Rule 6's mention of "the verdict and the question it settled" correctly flows into the re-homed context (ticket's `## Answer`), not a deleted section.
- **Reference file integrity:** Both `references/LOGIC.md` and `references/UI.md` remain byte-identical to upstream cached sources; unchanged by this adaptation commit.
- **Provenance line fidelity:** Appended line matches exact format of `skills/hamilton-grilling/SKILL.md`'s closing line with "prototype" substituted for "grilling" — word-for-word copy of attribution structure.
- **Commit scope:** `git show --stat` lists exactly one modified file: `SKILL.md` (6 insertions(+), 4 deletions(-)). References files not touched.
- **NOTICE attribution:** Sibling `NOTICE` file exists with skill name correctly updated to "prototype" on line 1; MIT permission block (lines 6–29) byte-identical to `skills/hamilton-grilling/NOTICE`.
- **Acceptance criteria:** Frontmatter `name` reads `hamilton-wayfinder-prototype`; `description` field unchanged from upstream. Branch pointers now resolve into `references/` directory. Rule 6 no longer names "issue" — context pointer goes in "resolving ticket's body", verdict in "that ticket's `## Answer`". References remain untouched. 
- **Regression guards:** `bun run test` passes 24/24; `bun run build` clean.

All design constraints honored; no departures from upstream beyond authorized adaptation surface.

## Task 5: Land hamilton-wayfinder-domain-modeling verbatim — 2026-08-08

Verdict: approved

### Verified

- **Byte-for-byte fidelity:** All three Markdown files (`SKILL.md`, `references/CONTEXT-FORMAT.md`, `references/ADR-FORMAT.md`) confirmed byte-identical to upstream via fresh `curl` fetch and direct `diff` comparison with no output. SKILL.md (74 lines), CONTEXT-FORMAT.md (60 lines), ADR-FORMAT.md (47 lines) match exactly.
- **NOTICE attribution:** Permission block byte-identical to `skills/hamilton-grilling/NOTICE` with trailing spaces preserved in the MIT indented block (two spaces on blank lines 9, 11, 17, 19, 25, 27); skill name on line 1 correctly changed from `"grilling"` to `"domain-modeling"`. Lines 2-28 compared post-hoc with grilling's NOTICE and verified identical.
- **Directory structure and completeness:** Directory holds `SKILL.md` at root, both reference files in `references/` subdirectory (not flat beside SKILL.md), and sibling `NOTICE`. Four files created; no omitted files and no sidecar files (no `agents/openai.yaml` or other metadata).
- **Verbatim integrity:** Frontmatter `name` remains `"domain-modeling"` (not yet `"hamilton-wayfinder-domain-modeling"`), file pointers in prose still read `[CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md)` and `[ADR-FORMAT.md](./ADR-FORMAT.md)` (flat references, not yet `references/` paths), and no provenance line appended — all deferred to Task 6 as designed.
- **Upstream re-homing terms present (as expected):** Grep for "CONTEXT.md", "CONTEXT-MAP.md", "docs/adr/" across the skill directory returns multiple hits — this is correct and expected for verbatim Task 5. These references are upstream's original prose and will be re-homed in Task 6. The presence of these terms is not a defect; their re-pointing is Task 6's responsibility.
- **Commit scope:** `git show --stat` lists exactly five files changed: `progress.md` (updated), `SKILL.md` (74 lines added), `references/CONTEXT-FORMAT.md` (60 lines added), `references/ADR-FORMAT.md` (47 lines added), `NOTICE` (28 lines added). No modifications outside the skill directory except progress.md.
- **Regression guards:** `bun run test` passes 24/24; `bun run build` clean (no typecheck errors).
- **Commit message and progress:** Single commit `c3b5425` with message "feat: port the domain-modeling skill verbatim"; progress.md entry records task completion, verified sources, and correct handling of trailing spaces in NOTICE MIT block.

All design constraints honored; Task 5 correctly lands verbatim upstream content with no adaptation.

## Task 6: Re-home the domain model onto the map — 2026-08-08

Verdict: approved

### Verified

- **Upstream departure verification:** Fetched all three upstream files fresh via `curl` and compared via `diff`. SKILL.md (74 lines upstream, 78 lines local), CONTEXT-FORMAT.md (60 lines upstream, 47 lines local), ADR-FORMAT.md (47 lines upstream, 45 lines local). Line-by-line diffs confirm every change in the commit aligns with one of the eight authorized Steps.
- **Step 1 — frontmatter `name`:** Changed from `domain-modeling` to `hamilton-wayfinder-domain-modeling` ✓
- **Step 2 — opening parenthetical:** Re-pointed from `(Merely *reading* \`CONTEXT.md\` ...)` to `(Merely *reading* the glossary ...)` — one term swap, shape preserved ✓
- **Step 3 — file structure trees:** Both `## File structure` ASCII trees replaced. Single-context tree now shows `.hamilton/specs/glossary.md` and `.hamilton/maps/<effort>/glossary.md`. Multi-context tree shows efforts under `.hamilton/maps/` with each keeping its own working `glossary.md` while canonical lives at `.hamilton/specs/`. Prose re-keyed from "If a CONTEXT-MAP.md exists" to "When several efforts are worked against a single canonical glossary" ✓
- **Step 4 — lazy-creation line:** Replaced `If no \`CONTEXT.md\` exists, create one when the first term is resolved. If no \`docs/adr/\` exists, create it when the first ADR is needed.` with `The canonical \`.hamilton/specs/glossary.md\` is the source of truth; each map's working \`glossary.md\` holds that effort's working language. A decision is written into the resolving ticket's \`## Answer\` — there is no separate directory to create.` ✓
- **Step 5 — challenge against glossary:** Re-pointed to read against both canonical `.hamilton/specs/glossary.md` and map's working `glossary.md`; heading renamed from `### Update CONTEXT.md inline` to `### Update the glossary inline`; body re-pointed to map's working `glossary.md`; two sentences about devoid-of-implementation-details now apply to working glossary ✓
- **Step 6 — reference pointers and CONTEXT-FORMAT.md:** Pointer from `[CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md)` to `[CONTEXT-FORMAT.md](references/CONTEXT-FORMAT.md)`. Title of references/CONTEXT-FORMAT.md changed to `# glossary.md Format`. `## Single vs multi-context repos` body completely replaced with Hamilton's two-level structure (canonical at specs, working at maps/<effort>). The fenced `# Context Map` example document (14 lines) and its `## Relationships` list (6 lines) deleted — this is the one authorized deletion. `## Structure` and `## Rules` sections verified byte-identical to upstream ✓
- **Step 7 — ADR-FORMAT.md re-homing:** Opening line changed from `ADRs live in \`docs/adr/\` and use sequential numbering` to `Decisions are recorded in the resolving ticket's \`## Answer\` section`. Lazy-creation line (`Create the \`docs/adr/\` directory lazily`) and its blank line deleted. In Optional sections, `ADR-NNNN` changed to `ticket NNNN`. Under `## Numbering`, replaced `Scan \`docs/adr/\` for the highest existing number and increment by one.` with `The resolving ticket's own number identifies the decision — there is no separate numbering sequence to maintain.` Sections `## Template`, `## When to offer an ADR`, and `### What qualifies` verified byte-identical to upstream (9 bullet points including "Rejected alternatives..." all intact) ✓
- **Step 8 — provenance line:** Appended `Adapted from the "domain-modeling" skill in [mattpocock/skills](https://github.com/mattpocock/skills), used under the MIT License — see the \`NOTICE\` file beside this one.` — exact pattern match to `skills/hamilton-grilling/SKILL.md`'s closing line ✓
- **Re-homing completeness check:** `grep -rnE "docs/adr|CONTEXT-MAP|CONTEXT\.md|issue|where the repo already keeps" skills/hamilton-wayfinder-domain-modeling/` → exit code 1, no output. No forbidden terms remain ✓
- **Two-level glossary structure:** Canonical `.hamilton/specs/glossary.md` mentioned multiple times (lazy-creation line, Challenge section, CONTEXT-FORMAT.md). Working `.hamilton/maps/<effort>/glossary.md` mentioned in parallel structures, lazy-creation guidance, and CONTEXT-FORMAT.md's multi-context section. Both levels correctly distinguished throughout ✓
- **Reference file structure:** Files placed in `references/` directory and correctly linked via `references/CONTEXT-FORMAT.md` and `references/ADR-FORMAT.md` in SKILL.md ✓
- **Commit scope:** `git show --stat HEAD` lists exactly three files modified (SKILL.md, references/CONTEXT-FORMAT.md, references/ADR-FORMAT.md); no over-broad edits ✓
- **NOTICE file:** Unchanged; present in directory from Task 5; not touched by Task 6 ✓
- **Regression guards:** `bun run test` passes 24/24; `bun run build` clean (tsc no errors) ✓
- **Minimal-patching compliance:** No section deleted except the authorized Context Map example and Relationships list. No sections re-styled while being re-homed. Every re-homing touches only the sentences naming the old destination; surrounding prose unchanged ✓

All eight Steps executed exactly as specified. No structural defects, no deviations from design constraints, and all acceptance criteria met.
