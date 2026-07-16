# Spec altitude reference

A rubric for the **altitude** of a requirement — the level of abstraction at which a spec
states an obligation. Requirements are *authored* at altitude in `hamilton-propose` and
*preserved* at altitude in `hamilton-finish-work` when deltas are folded into the canonical
spec. A spec describes contracts, behaviors, and invariants — **what** the system guarantees —
not the mechanism a given commit used to satisfy them. Mechanism lives in `design.md` and in the
code; a spec pinned to mechanism becomes false the moment the code is refactored, and stops
being usable as intent.

## How to use this

- When authoring a requirement (propose) or folding one into `.hamilton/specs/` (finish-work),
  run it through the altitude test and the four registers below. If it fails, lift it or drop it
  before it lands in the canonical spec.
- Scale scrutiny to the change: a schema or an endpoint contract is worth stating precisely; a
  one-line control-flow choice never is.

## The altitude test

A requirement is at the right altitude when it would **survive a reasonable reimplementation**:
rewrite the feature in another language, with different names and control flow, keeping the
observable behavior — a good requirement is still true.

Three litmus checks, sharpest first:

1. **Black-box scenario.** Every requirement carries a scenario. If that scenario cannot be
   written as a test observing only inputs and outputs — if it would have to inspect source, an
   AST, or call structure — the requirement is too low. You cannot black-box-test "uses a
   `switch`." You can black-box-test "not-found → 404."
2. **The "via / using / as" tell.** A clause like "… via a `BeforeCreate` hook", "… using a
   `switch`", "… as a `json.RawMessage`" almost always names a HOW. Cut the clause; keep the WHAT.
3. **Reason to change.** If the requirement would change for a reason no consumer of the contract
   would care about — an internal rename, a control-flow cleanup, a library swap — it is too low.

## The four registers

Everything in a spec is one of these. If a sentence is none of them, it does not belong.

- **Contract** — the interface to consumers: endpoints, request/response shapes, status codes,
  persisted schema, error taxonomy.
- **Behavior** — observable input → output, including edge and error paths.
- **Invariant** — a property that holds across all states and over time.
- **Pattern / idiom** — a *reusable* design rule the codebase commits to, stated normatively so
  future code follows it.

## The pattern register: policy, not incident

The fourth register is the one that most easily drifts low. Include a design detail **only** if
it is a reusable rule applied in more than one place. Test: *"is this a policy, or an incident?"*

- **Policy (keep, as a rule):** "HTTP handlers depend on a narrow consumer-defined interface,
  never the concrete store." "DB errors are translated to domain sentinels at the repository
  boundary." These recur; a new call site should obey them.
- **Incident (drop):** "`handleUpdate` uses a `switch`." "The store wraps `*gorm.DB`." True at
  exactly one call site; constrains nothing else.

When you keep a pattern, state the **rule**, not the **occurrence**: "error-to-status mapping
happens at the HTTP boundary via typed sentinels" — not "`handleUpdate` matches `ErrX` and `ErrY`."

Cross-cutting idioms (naming, DI style, error mapping) belong once in a project guideline and are
referenced, not restated in every capability spec. A capability spec states a pattern only when
that capability is where the pattern is established.

## A spec MUST NOT contain

- Control-flow choices (`switch`/`if`, loop shape, early-return style).
- Names of internal/private structs, their field lists, or constructor/factory signatures.
- Library mechanics (ORM hooks, specific SDK calls) — state the **effect**, not the call.
- File paths or package layout **as requirements**. (Fine as an informative aside; a requirement
  anchored to a path is false the day the file moves.)
- Anything whose scenario cannot be a black-box test.

## Before → after

Low (folded verbatim from a diff or a review comment):

> ### Requirement: Error handling in handleUpdate
> The `handleUpdate` method SHALL use a `switch` statement … matching `ErrRemediationJobNotFound`
> and `ErrNotFound` to return 404, any other error 400.

At altitude — **drop it**: the behavior is already covered by the endpoint contract ("unknown id
→ 404"). The `switch` and the two sentinel names are mechanism (`design.md`), not a requirement.

Low:

> ### Requirement: Remediation job database table
> … The `id` column SHALL be generated as a UUID v4 on insert via a GORM `BeforeCreate` hook …

At altitude — keep the contract, cut the mechanism:

> IDs SHALL be server-assigned UUIDs; `status` SHALL be constrained to PENDING/COMPLETED/FAILED.
> *Invariant:* adding fields to a job's payload SHALL NOT require a schema migration.

This file is the single authored source for requirement altitude. It is duplicated verbatim into
each skill that applies it (`hamilton-propose`, `hamilton-finish-work`), the same way
`code-quality.md` is — keep the copies in sync when you edit one.
