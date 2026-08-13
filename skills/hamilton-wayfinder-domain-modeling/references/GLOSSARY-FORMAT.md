# glossary.md Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Single vs multi-context repos

Guidance for the skill — not part of the glossary a session writes.

**Single context** (most repos): one `glossary.md` at `.hamilton/specs/`.

**Multiple contexts:** each effort under `.hamilton/maps/` keeps its own working `glossary.md` — the current effort's scratch language only. Only the current effort's working glossary is ever read; never read another effort's working glossary. When an effort closes, the wayfinder closing act folds its resolved terms into the canonical `.hamilton/specs/glossary.md` — the accumulated language the project has committed to.

The skill infers which structure applies:

- If this effort's `glossary.md` exists, read it for this effort's working language — no other effort's glossary is read.
- If only `.hamilton/specs/glossary.md` exists, single context.
- If this effort has no `glossary.md`, create one lazily when the first term is resolved.

When both exist, infer which one the current topic relates to. If unclear, ask.
