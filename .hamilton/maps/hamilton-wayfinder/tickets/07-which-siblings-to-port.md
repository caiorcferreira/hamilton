# Which siblings to port, and their Hamilton shape

Type: grilling
Status: open
Blocked by: 02

## Question

Which of `research`, `prototype` and `domain-modeling` come into Hamilton, and what does each look
like once it is a Hamilton skill?

Charting settled that the siblings get ported rather than inlined or soft-depended on. Which ones,
and in what shape, is open — and [Read the three upstream sibling skills](02-read-upstream-siblings.md)
supplies the facts this needs.

Settle, per skill:

- **In or out.** `domain-modeling` is the doubtful one: it writes `CONTEXT.md` and `docs/adr/`,
  which is a parallel durable-truth system next to `.hamilton/specs/` and `AGENTS.md`. Options are
  port it as-is and accept two systems, re-home it onto Hamilton's artifacts, or rule it out of
  scope and have wayfinder's decision tickets lean on `/grilling` alone.
- **Naming.** `hamilton-research` and `hamilton-prototype` follow the `hamilton-*` convention, but
  every existing `hamilton-*` skill is a step in the SDD pipeline. Do these read as pipeline steps
  when they are not? Is there a better prefix or a `references/` home inside `hamilton-wayfinder`?
- **Scope of each port.** Verbatim fork, or trimmed to what wayfinder's ticket types actually
  invoke? `prototype` in particular may carry UI/codegen behaviour beyond what a ticket needs.
- **Standalone or coupled.** Are these usable outside wayfinder — a general Hamilton research skill —
  or strictly wayfinder's internals?
- Whether `grilling` also needs porting, or whether Hamilton relies on the user having it. Note that
  `hamilton-propose` and `hamilton-critique` already encode one-question-at-a-time dialogue, so
  there may be an existing Hamilton answer here.

The answer sets how many units the route gains, so it materially sizes the whole effort.
