<!--
  SRS (canonical) — the durable spec for one capability
  Lives at: .hamilton/specs/<capability>.md
  The living source of truth for this capability. It always states CURRENT behavior.

  Written to READ LIKE DOCUMENTATION A HUMAN WROTE — plain prose and tables, at
  altitude (what the capability guarantees, not the mechanism one commit used).
  It does NOT use the change-side Requirement/SHALL/Scenario form; that stays in the
  change's requirements/<capability>.md deltas.

  Produced two ways:
    - hamilton-finish-work folds a change's structured requirement deltas into here.
    - hamilton-compose-spec authors it directly (reformat an old spec, or from code).
  Both apply the altitude + skeleton rules in each skill's references/spec-altitude.md.

  The skeleton below is universal but right-sized: keep the sections a capability
  needs, omit the ones it has nothing for. Write flowing prose — do not hard-wrap at
  a fixed width. Delete this comment block and inline hints before finalizing.
-->

# Capability: <capability-name>

## Overview

<!-- One paragraph, plain prose: what this capability is responsible for and where it
     sits. Orient a reader who has never seen it. -->

## Contract

<!-- The concrete interface a consumer touches. Use tables for anything with a shape:
     persisted schema, request/response bodies, event payloads, config keys, status
     codes, error taxonomy. This is where a data-model capability shows its field
     names and types, and an endpoint capability shows its routes.
     Add domain subheadings (### <event type>, ### <endpoint>) as merge anchors when a
     capability has several distinct contract surfaces. Omit this section if the
     capability exposes no consumer-facing interface. -->

| field | type | notes |
|-------|------|-------|
|       |      |       |

## Behavior

<!-- Narrative input->output prose, including edge and error paths. Then a compact,
     greppable Examples block: each bullet an input/trigger -> observable outcome. The
     Examples are this spec's conformance points (the distilled proto-tests) — keep
     only ones that state durable, black-box behavior. -->

**Examples**

- <input / trigger> -> <observable outcome>

## Invariants

<!-- Properties that hold across all states and over time. This is the one section
     where MUST / NEVER earn their keep. Omit if there are none. -->

-

## Decisions

<!-- Reusable design rules or deliberate decisions future work must follow ("policy,
     not incident"). State the rule, not the one occurrence. Draw from design.md's
     Decisions. Omit if there are none. -->

-
