# Spec altitude reference

A rubric for the **altitude** of a canonical spec (`.hamilton/specs/<capability>.md`) — the
level of abstraction at which it states what a capability guarantees. This governs the
**distillation** step: turning a change's proposal, design, and requirements into the canonical
spec. It does **not** govern the change artifacts themselves.

**Change artifacts may be as specific as they need to be.** A `requirements/` delta, a
`design.md`, a `plan.md` — these describe one particular change and can name concrete mechanism,
exact signatures, and even code when that is the clearest way to pin the work down. Do not lift
or strip them.

**The canonical spec is different.** It is the project's durable body of knowledge — the
contracts, behaviors, invariants, decisions, and learnings that outlive any single change. It is
read by everyone who touches the capability next. So it is written **at altitude**: it states
what holds, not the mechanism one commit used to make it hold. A canonical spec pinned to
mechanism becomes false on the next refactor and stops being usable as shared knowledge.

## How to use this

When distilling a change into `.hamilton/specs/` (in `hamilton-finish-work`), run each
requirement you are about to write into the canonical spec through the altitude test and the four
registers below. If it fails, lift it or drop it — pull the durable contract out of the specific
delta, and let the mechanism stay behind in `design.md` and the code. Scale scrutiny to the
change: a schema or an endpoint contract is worth stating precisely; a one-line control-flow
choice never belongs in the canonical spec at all.

## The altitude test

A canonical requirement is at the right altitude when it would **survive a reasonable
reimplementation**: rewrite the feature in another language, with different names and control
flow, keeping the observable behavior — the requirement is still true.

Three litmus checks, sharpest first:

1. **Black-box scenario.** Every requirement carries a scenario. If that scenario cannot be
   written as a test observing only inputs and outputs — if it would have to inspect source, an
   AST, or call structure — the requirement is too low for the canonical spec. You cannot
   black-box-test "uses a `switch`." You can black-box-test "not-found → 404."
2. **The "via / using / as" tell.** A clause like "… via a `BeforeCreate` hook", "… using a
   `switch`", "… as a `json.RawMessage`" almost always names a HOW. Cut the clause; keep the WHAT.
3. **Reason to change.** If the canonical requirement would change for a reason no consumer of the
   contract would care about — an internal rename, a control-flow cleanup, a library swap — it is
   too low.

## The four registers

Everything in a canonical spec is one of these. If a sentence is none of them, it does not belong.

- **Contract** — the interface to consumers: endpoints, request/response shapes, status codes,
  persisted schema, error taxonomy.
- **Behavior** — observable input → output, including edge and error paths.
- **Invariant** — a property that holds across all states and over time.
- **Decision / pattern** — a *reusable* design rule or a deliberate decision the codebase commits
  to, stated normatively so future work follows it. This is where the "learnings and decisions"
  from `design.md` land — distilled to the rule, not the instance.

## The decision/pattern register: policy, not incident

This register most easily drifts low. Record a design detail in the canonical spec **only** if it
is a reusable rule or a decision that constrains future work in more than one place. Test:
*"is this a policy, or an incident?"*

- **Policy (keep, as a rule):** "HTTP handlers depend on a narrow consumer-defined interface,
  never the concrete store." "DB errors are translated to domain sentinels at the repository
  boundary." These recur; a new call site should obey them. Draw them from `design.md`'s
  Decisions.
- **Incident (drop):** "`handleUpdate` uses a `switch`." "The store wraps `*gorm.DB`." True at
  exactly one call site; constrains nothing else. This is where mechanism leaks in.

When you keep a pattern, state the **rule**, not the **occurrence**: "error-to-status mapping
happens at the HTTP boundary via typed sentinels" — not "`handleUpdate` matches `ErrX` and `ErrY`."

Cross-cutting idioms (naming, DI style, error mapping) belong once in a project guideline and are
referenced, not restated in every capability spec. A capability spec states a pattern only when
that capability is where the pattern is established.

## A canonical spec MUST NOT contain

- Control-flow choices (`switch`/`if`, loop shape, early-return style).
- Names of internal/private structs, their field lists, or constructor/factory signatures.
- Library mechanics (ORM hooks, specific SDK calls) — state the **effect**, not the call.
- File paths or package layout **as requirements**. (Fine as an informative aside; a requirement
  anchored to a path is false the day the file moves.)
- Anything whose scenario cannot be a black-box test.

(All of the above are legitimate in the change's `requirements/`, `design.md`, or `plan.md` —
they just do not survive the distillation into the canonical spec.)

## Before → after

A change's `requirements/` delta legitimately said:

> ### Requirement: Remediation job database table
> … The `id` column SHALL be generated as a UUID v4 on insert via a GORM `BeforeCreate` hook …

Distilled into the canonical spec — keep the contract and invariant, drop the mechanism:

> IDs SHALL be server-assigned UUIDs; `status` SHALL be constrained to PENDING/COMPLETED/FAILED.
> *Invariant:* adding fields to a job's payload SHALL NOT require a schema migration.

And a "requirement" that was really a review nit —

> ### Requirement: Error handling in handleUpdate
> The `handleUpdate` method SHALL use a `switch` statement … to return 404 / 400.

— does not enter the canonical spec at all: the behavior ("unknown id → 404") is already the
endpoint's contract, and the `switch` is mechanism.
