# Working glossary.md format

This bare Markdown format applies only to `.kepler/maps/<effort>/glossary.md`, which is outside
artifact lint. The canonical `.kepler/specs/glossary.md` is a `requirements-spec` artifact:
create or edit it using the canonical spec template, then run
`kepler workbench lint --file <spec-path>`. Do not reject a lint-valid canonical glossary because it differs from this
working-note format.

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

## Working and canonical scope

Guidance for the skill, not part of the glossary a session writes.

Read the project's committed terms from `.kepler/specs/glossary.md` when it exists. Each current
effort may keep a working glossary under its own `.kepler/maps/<effort>/`; create that file
lazily when the first working term is resolved. Never read another effort's working glossary.
When an effort closes, the Wayfinder closing act folds resolved terms into the canonical spec
using its lint-valid requirements-spec format. The presence or absence of a working file does
not change the canonical artifact's format.
