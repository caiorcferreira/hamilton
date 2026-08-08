---
name: hamilton-wayfinder-domain-modeling
description: Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, record an architectural decision, or when another skill needs to maintain the domain model.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline — challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* the glossary for vocabulary is not this skill — that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

Most repos working a single map:

```
.hamilton/
├── specs/
│   └── glossary.md
└── maps/
    └── <effort>/
        ├── map.md
        ├── glossary.md
        └── tickets/
            ├── 01-event-sourced-orders.md
            └── 02-postgres-for-write-model.md
```

When several efforts are worked against a single canonical glossary:

```
.hamilton/
├── specs/
│   └── glossary.md                    ← canonical language
└── maps/
    ├── ordering/
    │   ├── glossary.md                ← working language
    │   └── tickets/                   ← decisions
    └── billing/
        ├── glossary.md
        └── tickets/
```

Create files lazily — only when you have something to write. The canonical `.hamilton/specs/glossary.md` is the source of truth; each map's working `glossary.md` holds that effort's working language. A decision is written into the resolving ticket's `## Answer` — there is no separate directory to create.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in the canonical `.hamilton/specs/glossary.md` or the map's working `glossary.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update the glossary inline

When a term is resolved, update the map's `glossary.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](references/CONTEXT-FORMAT.md).

The glossary should be totally devoid of implementation details. Do not treat the glossary as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](references/ADR-FORMAT.md). Capture the decision in the resolving ticket's `## Answer`.

Adapted from the "domain-modeling" skill in [mattpocock/skills](https://github.com/mattpocock/skills), used under the MIT License — see the `NOTICE` file beside this one.
