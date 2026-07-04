<!--
  SRS (change delta) — Requirements / "What"   (ISO/IEC/IEEE 29148-inspired)
  Produced by: hamilton-propose (step 1). One file per capability.
  Lives at: .hamilton/changes/<change>/requirements/<capability>.md

  This is the DELTA form: it describes how a change alters a capability.
  hamilton-finish-work folds these deltas into the canonical
  .hamilton/specs/<capability>.md (which uses the requirements-spec.md form).

  Each requirement should be: necessary, unambiguous, verifiable, singular, feasible.
  Scenarios (WHEN/THEN) are proto-conformance tests — write them so a test could be
  derived directly. OPTIONAL artifact — skip when a change needs no formal requirements.
  Delete this comment block and inline hints before finalizing.
-->

# Capability: <capability-name>

<!-- One-line statement of what this capability is responsible for. -->

## ADDED Requirements

### Requirement: <short name>

The system SHALL <one normative statement>.

<!-- Use SHALL / MUST for normative rules. Avoid should/may. One requirement =
     one obligation (singular). Split compound requirements into several. -->

- Priority: must / should / could
- Rationale: <optional — why this exists; helps future readers and sync>

#### Scenario: <name>

- WHEN <trigger or precondition>
- THEN <observable, testable outcome>

<!-- Every requirement needs at least one scenario. Add scenarios for edge cases,
     error paths, and boundaries — each is a candidate test case. -->

## MODIFIED Requirements

<!-- Copy the ENTIRE existing requirement block from .hamilton/specs/<capability>.md,
     then edit it to the new behavior. Partial copies lose detail when folded in at
     finish-work. The "### Requirement:" name MUST match the original exactly. -->

## REMOVED Requirements

### Requirement: <name>

- Reason: <why it is being removed>
- Migration: <what consumers should do instead>

## RENAMED Requirements

- FROM: `<old name>` TO: `<new name>`
