# Capability: framework-docs

## Overview

The documentation that presents Hamilton's SDD pipeline and its skills to a reader. Two surfaces carry it: `docs/skills.md`, the skills reference a contributor or user reads to learn what each skill does, where it sits, and how the pipeline runs; and the **Mapping Code to Docs** table in `CONTRIBUTING.md`, which tells a contributor changing a given code area which doc they must update in the same change. Together they are the map between the pipeline's behaviour and the prose a reader holds.

## Contract

Two document surfaces form the capability. Their filenames are the interface, not incidental paths — a contributor is sent to `docs/skills.md` or to `CONTRIBUTING.md` by name.

| surface | carries |
|---------|---------|
| `docs/skills.md` | the skills reference: the pipeline diagram and identity phrasing, then one entry per skill |
| `CONTRIBUTING.md` — Mapping Code to Docs table | one row per code change area, mapping it to the doc a contributor updates |

### Skill entry shape

Every skill entry in `docs/skills.md` follows one shape: a `### \`hamilton-...\`` heading carrying a short role plus a step tag (e.g. `*(step 1, optional)*`, `*(optional pre-change planning stage)*`), a one-to-two-sentence intro, then `- **When:**` / `- **Inputs:**` / `- **Produces:**` / `- **Notes:**` bullets, ending with a `- Source:` link to the skill's own `SKILL.md`. The shape is the contract a reader relies on to scan the reference; a new entry conforms to it rather than inventing its own structure.

### Pipeline identity

The pipeline is phrased as six core skills in fixed sequence, plus an optional pre-change planning stage (wayfinder). The six core skills are `init`, `propose`, `plan`, `code`, `review`, and `finish-work`; wayfinder is the optional stage that sits upstream of per-change work, not a seventh core skill.

## Behavior

A reader who opens `docs/skills.md` finds the pipeline diagram (`init ──▶ [ propose ] ──▶ plan ──▶ code ──▶ review ──▶ finish-work`) followed by the identity phrasing, then one entry per skill in the fixed shape. The entries are ordered by lifecycle: the once-per-project setup skill (`init`), then the per-change stages beginning with the optional planner (`wayfinder`), then the optional heavyweight front door (`propose`), through the required `plan` and the `code`/`review` loop to `finish-work`.

`hamilton-wayfinder` is the optional pre-change planning stage. Its entry sits immediately before `hamilton-propose` and carries the one-sentence boundary between the two stages: wayfinder breaks a complex goal into clear, realizable units, and `hamilton-propose` transforms each route unit into a concrete change spec ready for autonomous implementation. The entry also carries the skill's fork provenance in prose — it names the upstream (`mattpocock/skills`) and its licence (MIT) and links to `NOTICE` for the full legal credit, without reproducing the licence text inline.

A contributor changing a code area consults the **Mapping Code to Docs** table in `CONTRIBUTING.md` to find which doc to update. Wayfinder-related surfaces occupy two distinct rows: artifact *templates* shipped in `bundle/templates/wayfinder/` map to `docs/skills.md`, and *map artifacts* authored under `.hamilton/maps/` also map to `docs/skills.md`. The two are separate because they are different change areas — one ships with the repo, the other is authored per-project — and conflating them would misdirect a contributor.

The six-skill diagram in `README.md` and `docs/sdd-framework.md` is not redrawn to insert wayfinder. Wayfinder is an optional skill in the pipeline, not a philosophical addition to the framework, and the diagram staying as it is is a deliberate decision.

**Examples**

- open `docs/skills.md` for a skill -> an entry in the fixed shape: heading + role/step tag, intro, When/Inputs/Produces/Notes, Source link to the skill's `SKILL.md`
- read the pipeline paragraph -> "six core skills in fixed sequence, plus an optional pre-change planning stage (wayfinder)"; wayfinder is not counted among the six
- look up `hamilton-wayfinder` -> entry immediately before `hamilton-propose`, carrying the one-sentence rule and the fork provenance with a `NOTICE` link; no licence text reproduced inline
- change a map artifact under `.hamilton/maps/` -> the mapping table sends the contributor to `docs/skills.md`, on a row distinct from the `bundle/templates/wayfinder/` templates row
- inspect the diff of a framework-docs change -> only `docs/skills.md` and `CONTRIBUTING.md` touched; `README.md` and `docs/sdd-framework.md` unchanged

## Invariants

- The pipeline identity counts six core skills. `hamilton-wayfinder` is the optional pre-change planning stage and is NEVER counted as a seventh core skill.
- A forked skill's provenance in `docs/skills.md` is prose naming the upstream and its licence with a link to `NOTICE`. The licence text is NEVER reproduced inline in the skills reference — legal credit stays in `NOTICE`.
- `hamilton-wayfinder`'s entry MUST sit immediately before `hamilton-propose`, naming it as the optional pre-change planning stage.

## Decisions

- **Entry order groups by lifecycle, not conceptual flow.** The pipeline diagram shows conceptual flow (wayfinder before `init`); the entry order groups by lifecycle — the once-per-project `init` first, then the per-change stages starting with the optional planner. The two orderings are different concerns and need not match.
- **Provenance lives in the Notes bullet, not a subsection.** The established entry shape has no subsections; ancillary facts live in Notes. A dedicated provenance subsection would over-structure a single sentence.
- **The pipeline phrasing replaces the identity sentence, not the diagram.** The diagram already marks `propose` as optional; the identity sentence carries the count. Adjusting the sentence preserves the pipeline's identity while naming wayfinder as the optional stage, without redrawing the diagram.
- **Related mapping rows stay adjacent but distinct.** Map artifacts (`.hamilton/maps/`) and artifact templates (`bundle/templates/wayfinder/`) are different change areas that point at the same doc; they sit together for scanning but are never merged into one row.
- **The six-skill diagram in `README.md` and `docs/sdd-framework.md` is deliberately not redrawn to insert wayfinder.** Wayfinder is an optional pipeline skill, not an addition to the framework's philosophy; the diagram staying as it is is the decision, not an oversight. Future docs changes resist widening this scope.
- **Docs are verified by reading, not by automated tests.** No test asserts on `docs/` content; `bun run build` and `bun --bun vitest run` guard code and bundled templates, and a docs change is verified by reading the edited sections and inspecting `git diff --name-only`.
