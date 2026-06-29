# Composite task nodes for sequential `forEach` with feedback loops

## Status

Design proposal. Addresses the bug in
[`2026-06-29-sequential-forEach-bug.md`](./2026-06-29-sequential-forEach-bug.md).

## Problem recap

`forEach` template tasks expand all iterations into one flat DAG. The
iteration chains (`code → test → verify`) have no cross-iteration
dependencies, so Kahn's algorithm batches all same-role tasks together and
the serial executor runs all `code`, then all `test`, then all `verify`
([`runner.ts:168-169`](../../../src/workflow/runner.ts),
[`engine.ts:58`](../../../src/workflow/engine.ts)).

The intent is per-iteration sequencing:

```
Story 0: code → test → verify → (feedback loop if needed)
Story 1: code → test → verify → (feedback loop if needed)
```

Two naive fixes fail:

- **Static cross-iteration edges** break the feedback loop. The loop
  (`applyVerificationFeedback`, [`workflow.yml:206-217`](../../../bundle/workflows/feature-dev/workflow.yml))
  is a recursive `template` task that completes *on expansion*
  ([`runner.ts:201`](../../../src/workflow/runner.ts)), so an edge pointing at it
  is satisfied before its spawned retry chain runs — the next iteration races
  the retry. An iteration's true terminal task is not knowable statically
  (the retry recurses up to `max_recursion_depth`).
- **Sort tie-breaking** only reorders the serial frontier; it leaves the
  graph semantically ambiguous and regresses under any future concurrent
  executor.

## Solution: composite nodes with drain-complete semantics

Model task grouping as first-class **composite nodes** (a node is either a
`leaf` or a `composite` that contains a subgraph — the Composite pattern).
Sequencing is expressed as ordinary edges between composite *boundaries*;
correctness under feedback comes from defining a composite's completion at
runtime (drain), not at expansion.

This unifies the two failed approaches: the graph is self-describing and
durable (static edges), while the edge endpoints are dynamic (drain-complete
composites), so the feedback loop is handled by nesting rather than special
cases.

### Node kinds

| kind        | description                                         | completes when                          |
|-------------|-----------------------------------------------------|-----------------------------------------|
| `leaf`      | an `agent` or `script` task                         | the task itself finishes                |
| `composite` | contains a subgraph (a body of leaves/composites)   | its subtree **drains** (see below)      |

A composite carries:

- a **body**: the nodes it contains, with one or more **entry** nodes
  (indegree 0 within the body);
- an **execution policy** over its children: `sequential` (default) or
  `parallel` (future). The initial implementation supports only `sequential`
  — siblings are ordered by ordinary edges that fire on drain. `parallel` is
  a forward-looking seam; the drain-complete rule and invariants are designed
  to work for both policies without change.

### Transitions

There is **one** execution edge type: an ordinary dependency that fires when
its source node *completes*. For a composite source, "completes" already
means drain — no second mechanism is needed.

Two further concepts annotate the graph but are **not** separate execution
mechanisms:

- **Scope entry** (drawn dotted): activates a composite's entry node(s) when
  the composite is scheduled. Drain-complete is a property of the **composite
  node**, consumed by its outgoing ordinary edges — it is *not* a property of
  the entry edge.
- **Guard** (`when`): an optional condition on a transition. The feedback
  retry entry is guarded
  ([`workflow.yml:209`](../../../bundle/workflows/feature-dev/workflow.yml));
  if the guard is false the target is skipped (completed as a no-op).

### Drain-complete rule

> A composite is complete **iff it has no `pending` or `running`
> descendant** (recursively).

Completion is **never** keyed on a designated sink node. When
`applyVerification` yields feedback it spawns a *nested* `implementTask`
composite inside the current one, adding new descendants and a new sink. Only
"subtree empty of live work" is robust to that dynamic growth; "sink
completed" would close the composite early and let the next iteration race
the retry.

### Failure rule

> A composite **fails** as soon as any descendant fails (after that
> descendant's own retries are exhausted). Failure is fail-fast: no further
> children are started, and failure propagates to the parent composite. A
> failed composite is *not* drain-complete and does not enable its successors.

Composites do **not** carry their own `on_failure` configuration. Two
concepts are deliberately kept separate:

- **Retry** — re-executing the same leaf after a transient failure (timeout,
  API error). Handled at the leaf level by `on_failure.max_retries`.
- **Feedback loop** — dynamically spawning a *new* composite with improved
  input after work completed but was not up to standard. This is new work,
  not a retry. Handled at the workflow-authoring level via guarded template
  tasks (e.g., `applyVerificationFeedback → template: implementTask` in
  `feature-dev`). The drain-complete rule naturally keeps the parent composite
  open while this new subtree executes.

The composite boundary's only failure responsibility is propagation: when a
leaf exhausts its retries, the composite fails and no further children start.

In `feature-dev` every leaf already has `on_failure.escalate_to: human`
before it can fail the run; the composite rule governs what happens to the
group once a leaf does fail.

### Invariants

1. **Edges terminate on boundaries, never on leaves.** A cross-iteration /
   downstream edge must target a composite node, never a leaf inside it.
   Flattening a composite to "depend on its last leaf" to feed the flat
   topological sort reintroduces the static-edge bug.
2. **The downstream join must be drain-gated.** Any task after the iteration
   set depends on the `forEach` composite's drain, never on "the last
   iteration" — the iteration count is runtime-determined (the planner emits
   N stories), so there is no statically-known last child.

## Reference topology

`applyPlan` **is** the `forEach` composite (it carries
`template: implementTask` + `arguments.forEach`,
[`workflow.yml:76-83`](../../../bundle/workflows/feature-dev/workflow.yml)).
There is no separate `forEach` node.

```
plan ──▶ setup ──▶ applyPlan ─────────▶ some other task
                   (composite)   ▲
                   │             │ drain-gated join
                   ⋮ entry       │
                   ▼             │
        ┌──────────────────────────────────────────────┐
        │ applyPlan body (policy: sequential)           │
        │                                               │
        │  implementTask·0 ──▶ implementTask·1 ──▶ …·N   │  ← sibling ordering
        │   (composite)        (composite)              │    (ordinary edges,
        │   ⋮ entry                                      │     fire on drain)
        │   ▼                                            │
        │   code ─▶ test ─▶ verify ─▶ applyVerification  │  ← leaf chain
        │                              │ when feedback   │
        │                              ▼ (guarded entry) │
         │                       implementTask             │  ← nested composite
         │                        (composite, ⋮ entry)    │    (feedback loop)
        └──────────────────────────────────────────────┘

Legend:  ──▶ ordinary edge (fires on source completion / composite drain)
         ⋮   scope entry (descend into composite body)
```

Execution trace (sequential policy):

1. `applyPlan` composite is entered; activates child `implementTask·0`.
2. `implementTask·0` is entered; runs `code → test → verify → applyVerification`.
3. If `applyVerification` emits feedback, a nested `implementTask`
   composite is spawned inside `implementTask·0` as a feedback loop (guarded
   entry). `implementTask·0` is **not** drain-complete until that subtree
   finishes (bounded by `max_recursion_depth`).
4. On `implementTask·0` drain, its ordinary edge to `implementTask·1` fires.
5. … through `implementTask·N`.
6. On `applyPlan` drain (all children complete), the drain-gated edge to
   `some other task` fires.

`parallel` policy drops the `implementTask·i → implementTask·i+1` ordering
edges; children then depend only on composite entry. Correctness of the
downstream join is unchanged (it depends on `applyPlan` drain either way).

## Impact on current code

- **State machine / completion** — the largest change. Today a `template`
  task completes on expansion ([`runner.ts:197-204`](../../../src/workflow/runner.ts)).
  Composites must instead stay open and be re-evaluated for drain as
  descendants finish. Applies at both levels (`applyPlan` and `implementTask`).
- **Schema** — task rows need `kind` (`leaf`/`composite`) and a parent
  pointer so drain can be computed as a subtree query.
- **Sort / reachability** — `topologicalSort` and `collectReachableTasks`
  ([`engine.ts`](../../../src/workflow/engine.ts)) must become composite-aware
  (sort per level / recurse into bodies) or keep the flat sort behind a
  composite drain barrier.
- **Scope ownership** — the ad-hoc `taskScopes` / `iterationOutputs` /
  `currentIteration` plumbing ([`runner.ts:162-164,218-243`](../../../src/workflow/runner.ts))
  becomes state owned by the composite, removing manual threading from the
  runner.
- **Materialization is hybrid.** Iteration *boundaries* can be created eagerly
  when `applyPlan` expands (`itemsCount` and per-story plan data are known
  then). The feedback loop subtree is inherently lazy — its content depends on
  the verifier's runtime feedback, so it is created on demand. Ordering lives
  in the graph (durable in the DB), so pause/resume needs no separate cursor.

## Design decisions

- **Parallel policy** is a forward-looking seam. The initial implementation
  supports only `sequential`. When `parallel` is implemented, it will use
  bounded concurrency via a `maxInFlight` parameter (default 1). Unbounded
  expansion is rejected: it would overwhelm LLM APIs and system resources
  on large `forEach` expansions.
- **Failure is fail-fast only.** No `continueOnError` mode. When a descendant
  fails, the composite fails immediately and no further children start. If
  iterations are truly independent and should continue past failures, that
  is expressed at the workflow-authoring level (e.g., separate `forEach`
  composites with their own error handling), not as an engine feature.
- **Composite boundaries do not carry `on_failure`.** Retries belong to
  leaves (`on_failure.max_retries`). Feedback loops (new work spawned in
  response to quality issues) belong to the workflow author via guarded
  template tasks. The composite boundary only propagates failure upward.
