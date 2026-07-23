<!--
  Critique — the design-phase review artifact for a change.
  Lives at: .hamilton/changes/<change>/critique.md
  Written by the hamilton-critique skill: a verdict plus a numbered, located findings list
  over the propose artifacts (proposal.md, requirements/, design.md). Findings are one
  continuous list, ordered most-severe first, so a reply can pick an item by its number.
  Delete this comment block before finalizing.
-->

# Critique: <Change Title> — <YYYY-MM-DD>

## Scope

<!-- What was cross-referenced: which artifacts, against the codebase, the code-quality
     rubric, and each other. -->

Verdict: approved | changes-requested — <one line>

## Findings

<!-- One numbered list, most-severe first. Tag each item [Critical] | [Significant] | [Minor].
     [Critical]    — blocks the gate: would cause implementation confusion or a runtime failure.
     [Significant] — a factual error or YAGNI violation to correct before the gate.
     [Minor]       — a documentation, naming, or completeness gap. -->

1. **[Critical]** <title>
   - Where: <artifact:loc>, <artifact:loc>
   - Problem: <what is wrong and why>
   - Fix: <what to change; sub-number 1./2. when there are options>
2. **[Significant]** <title>
   - Where: <artifact:loc>
   - Problem: <what is wrong and why>
   - Fix: <what to change>
3. **[Minor]** <title>
   - Where: <artifact:loc>
   - Problem: <what is wrong and why>
   - Fix: <what to change>

## Quality Lens

<!-- One row per principle from references/code-quality.md that you exercised. -->

| Principle | Verdict | Notes |
| --- | --- | --- |
| <principle> | ✅ / ⚠️ (→ finding N) / ❌ | <one line> |

## Summary

| Severity | Count | Items |
| --- | --- | --- |
| Critical | <n> | <finding numbers> |
| Significant | <n> | <finding numbers> |
| Minor | <n> | <finding numbers> |

**Recommendation:** <which findings block the gate; what can be deferred>

<!-- When approved, replace the Findings list with a short note of what was verified. -->
