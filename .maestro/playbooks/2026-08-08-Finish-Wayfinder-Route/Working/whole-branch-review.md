---
type: report
title: Whole-branch review — Finish Wayfinder Route
created: 2026-08-09
tags:
  - review
  - wayfinder
  - framework
---

# Whole-branch review — Finish Wayfinder Route

## Summary

The branch ships a coherent, well-structured fork. All ten units are `shipped`, the build passes, all 24 tests pass, and every ticket decision verified survived into the shipped artifacts — Apache 2.0 licensing with verbatim upstream NOTICE text, verbatim ports confined to adaptation-surface changes (frontmatter, description, invocation mode, naming, provenance line, re-homed paths), "Judge, don't fix" intact in critique, propose's worktree gate preserved in map-aware mode, and framework-docs scope held to `docs/skills.md` + `CONTRIBUTING.md`. The grilling refactor left no protocol duplication in propose or critique. Two minor findings, both documentation-level inconsistencies with no runtime impact.

> **Review method note.** The `oracle` subagent could not be dispatched — its model (`ifood-messages/kimi-k3-tencent`) was not found after 2 attempts (the prescribed retry cap). The review was performed by a `general` subagent with the same three-axis scope and file set, then independently verified by the dispatching agent (every cited location and contradicting surface was read and confirmed). The reviewer/fixer separation is preserved: this report reviews, a `coder` agent applies fixes.

## Findings

### 1. artifact-templates spec under-specifies the status vocabularies it claims are complete

**Severity:** [Minor]
**Axis:** Axis 1 (internal consistency) / Axis 3 (framework integration)
**Location:** `.hamilton/specs/artifact-templates.md:21-22` — the "wayfinder artifact shapes" table lists ticket `status` as `open` | `resolved` (omitting `claimed`) and map `status` as `open` | `cleared` (omitting `shipping` / `shipped`). The spec's own framing at line 17 asserts "the fields and their vocabularies are what a reader or a skill matches on," claiming the table is the complete vocabulary. Three other canonical surfaces contradict this: `.hamilton/specs/wayfinder.md:41-42`, `skills/hamilton-wayfinder/SKILL.md:68`, and `CONTRIBUTING.md:76-77` all list ticket status as `open` / `claimed` / `resolved` and map status as `open` / `cleared` / `shipping` / `shipped`. `CONTRIBUTING.md:80` even states explicitly that ticket 06's three-stage lifecycle "supersed[es] ticket 04's `open`/`cleared` for maps" — the artifact-templates spec was not updated to reflect that supersession. A skill scanning the frontier matches on `claimed`; a reader tracking the map lifecycle matches on `shipping` / `shipped` — neither appears in this spec's table.
**Fix:** In `.hamilton/specs/artifact-templates.md:21`, change the map `status` cell to `open` | `cleared` | `shipping` | `shipped`. In line 22, change the ticket `status` cell to `open` | `claimed` | `resolved`. Both now match `wayfinder.md`, the wayfinder `SKILL.md`, and `CONTRIBUTING.md`.

### 2. critique step 6 unattended instruction ambiguously skips the report

**Severity:** [Minor]
**Axis:** Axis 1 (internal consistency)
**Location:** `skills/hamilton-critique/SKILL.md:83` — step 6 ends "Unattended, name the next step and return." The verb "return" mirrors the Handoff section's identical phrase at line 172 ("Running unattended, name the next step and return; the driver owns the loop"), where "return" unambiguously means "return from the skill." Read the same way in step 6, the instruction tells the agent to exit before step 7 (Write the report) runs — skipping `critique.md`. This contradicts the process-flow diagram (lines 192-196, which show `changes-requested → Validate → Write numbered findings → Write critique.md` with no unattended shortcut past the report) and the Output section (line 161, "critique.md written to the change directory" with no attendance qualifier). Propose's unattended pattern at the same kind of surface ("record open questions. Do not pass the gate until approved," line 162) does not use "return" — it records and continues. An orchestrator-dispatched unattended critique that reads step 6 literally would produce no report for the driver to act on.
**Fix:** In `skills/hamilton-critique/SKILL.md:83`, replace "Unattended, name the next step and return" with an instruction that skips grilling but continues to step 7 — e.g., "Unattended, skip the validation; the report is written from the unvalidated findings, and the handoff names the next step."

## Verdict

findings
