# Bug: `max_recursion_depth` never engages for templated recursion

**Date:** 2026-07-05
**Status:** Draft / confirmed by code reading
**Severity:** High — the only guard against runaway template recursion is inert
**Area:** `src/workflow/runner.ts`, `src/workflow/template-expander.ts`, `src/workflow/when-guard.ts`

---

## Summary

The workflow engine advertises a `max_recursion_depth` safety limit for recursive
`template` + `when` patterns (a task whose template re-instantiates an ancestor template).
The expander is written to accumulate depth as it nests tasks, but the **runner calls the
expander with a hardcoded base depth of `0` on every expansion**. As a result the stored
`depth` of a re-expanded template never climbs, `checkRecursionDepth` never trips, and the
limit is effectively disabled for exactly the case it exists to protect.

Because a second, independent bug (logical task references do not resolve inside nested
scopes — see the companion variable-environment report) currently prevents these loops from
firing at all, this bug is latent today. The moment the environment bug is fixed and a
self-referential template actually loops, this bug turns "should stop after N rounds" into
"runs until the workflow `timeout`."

## Expected behavior

For a workflow like the edited `bugfix` design:

```yaml
run:
  max_recursion_depth: 3
tasks:
  - name: deepWork
    template: workLoop
  - name: workLoop
    tasks:
      - { name: plan, ... }
      - { name: applyPlan, template: fixTask, arguments: { forEach: ... } }
      - { name: review, ... }
      - name: reworkIfNeeded
        template: workLoop                       # re-instantiates the whole loop
        when: 'inputs.tasks.review.outputs.verdict == "changes-requested"'
```

Each time `reworkIfNeeded` re-expands `workLoop`, the newly inserted tasks should be recorded
at a **greater** depth than their parent. When that depth reaches `max_recursion_depth`,
`checkRecursionDepth` should stop the recursion.

## Actual behavior

Every re-expansion inserts tasks at a **fixed** depth (composite at `1`, subtasks at `2`),
regardless of how many levels deep the recursion already is. `checkRecursionDepth` compares a
depth that is permanently `≤ 2` against a limit of `3`, so it always returns `"proceed"`. The
recursion is bounded only by the `when` condition eventually becoming false — never by the
depth limit.

## Root cause

The expander is designed to accumulate. In
[`src/workflow/template-expander.ts`](../../src/workflow/template-expander.ts) it inserts the
composite instance at `depth + 1` and each subtask at `depth + 2`:

```ts
// template-expander.ts (composite branch)
yield* _(ctx.insertDynamicTask(instanceName, "composite", depth + 1, ..., "composite"))
// ...
yield* _(ctx.insertDynamicTask(subInstanceName, subRef, depth + 2, ..., subKind))
```

But the **caller never passes the expanding task's real depth**. Both call sites in
[`src/workflow/runner.ts`](../../src/workflow/runner.ts) pass the literal `0`:

```ts
// runner.ts — composite-entering branch (~line 240)
if (task.template) {
  const parentName = (task as any).parentTaskName ?? undefined
  yield* _(expandTemplate(ctx, task, spec, workflowEnv, 0, undefined, parentName))
  //                                                    ^ hardcoded base depth
}

// runner.ts — leaf template branch (~line 248)
if (task.template && (task as any).kind !== "composite") {
  const parentName = (task as any).parentTaskName ?? undefined
  yield* _(expandTemplate(ctx, task, spec, workflowEnv, 0, undefined, parentName))
  //                                                    ^ hardcoded base depth
}
```

So `depth` inside `expandTemplate` is always `0`, and `depth + 1` / `depth + 2` are always
`1` / `2`. The accumulation code is real but starved of its input.

The depth lookup that the guard relies on reads the stored value directly, with **no
parent-chain traversal** — [`run-state-machine.ts`](../../src/workflow/run-state-machine.ts),
`getTaskDepth`:

```ts
getTaskDepth(taskName) {
  const compoundId = this._compoundTaskIds.get(taskName)
  if (!compoundId) return null
  const depthRow = this._db.prepare("SELECT depth FROM tasks WHERE id = ?").get(compoundId)
  return depthRow?.depth ?? null   // whatever was stored at insert time — i.e. 1 or 2
}
```

And the guard itself — [`when-guard.ts`](../../src/workflow/when-guard.ts),
`checkRecursionDepth`:

```ts
if (depth >= maxDepth) {            // 2 >= 3 is never true
  yield* _(ctx.transitionTask(taskName, "fail"))
  yield* _(ctx.fail(`max recursion depth (${maxDepth}) exceeded`))
  return "fail" as const
}
return "proceed" as const
```

Note also that `checkRecursionDepth` only runs for tasks that carry a `when`
([runner.ts ~line 213](../../src/workflow/runner.ts)). That part is fine for the rework
pattern (the recursive task is `when`-guarded), but it means the depth guard is *only* a
guard on conditional tasks, not on all templated fan-out.

## Why it is latent right now

A self-referential `workLoop` does not currently loop, because logical references such as
`inputs.tasks.review` do not resolve from inside a nested scope (outputs are stored under the
full instance name `deepWork/0-review`, and there is no scope-aware resolver). So
`reworkIfNeeded.when` is always false and the recursion never starts. That is a separate bug,
documented in the companion report. **Fixing the environment bug without also fixing this one
would replace "never reworks" with "reworks until timeout."** They must ship together.

## Impact

- `max_recursion_depth` gives a false sense of safety: it is documented and configurable, but
  does nothing for templated recursion.
- Once recursion works, a stubborn or flaky reviewer (one that keeps returning
  `changes-requested`) produces unbounded re-planning + re-implementation until the workflow
  `timeout` (e.g. `300s`) kills the run — wasting model spend and leaving a half-done tree.
- The failure mode at the limit is a hard `ctx.fail()` that fails the entire run, rather than
  a graceful stop — so even a *correct* depth limit would abort the workflow instead of
  deferring to the `hamilton-finish-work` review gate.

## Proposed fix

### 1. Feed the real base depth into the expander (the core fix)

At both call sites in `runner.ts`, replace the hardcoded `0` with the expanding task's stored
depth:

```ts
const base = (yield* _(ctx.getTaskDepth(task.name))) ?? 0
yield* _(expandTemplate(ctx, task, spec, workflowEnv, base, undefined, parentName))
```

With this, a `reworkIfNeeded` stored at depth `2` expands its children at `3`/`4`, the next
round at `5`/`6`, and `checkRecursionDepth` trips against `max_recursion_depth`.

### 2. Decide depth granularity (author-facing semantics)

Structural nesting adds `2` per rework round (composite + leaf), so `max_recursion_depth: 3`
means "≈1 round," which is unintuitive. Recommended: track a **recursion counter** that
increments by `1` only when the template being expanded is an ancestor instance of the *same
logical template* (a true self-reference), separate from the structural `depth` used for
eligibility. Then `max_recursion_depth: N` means "N rework rounds," which is what an author
expects to configure.

### 3. Prefer graceful stop over run failure

When a `when`-guarded self-template hits the limit, treat it as a `skip` and emit a
"rework-exhausted" signal/output rather than calling `ctx.fail()`. This lets the run complete
and hands the decision to `hamilton-finish-work`'s "review approved" gate, instead of nuking
the whole workflow. (If a hard failure is genuinely desired, make it configurable.)

## Verification / tests to add

The current suite ([`tests/workflow/runner-recursion.test.ts`](../../tests/workflow/runner-recursion.test.ts))
covers flat `when` behavior and asserts `max_recursion_depth` from YAML is *read*, but **no
test exercises a self-referential `template` and asserts it terminates.** Add:

1. **Accumulation:** a self-referential template with `max_recursion_depth: N`; assert the
   stored depth of successive instances increases and that expansion stops at `N`.
2. **Termination as stop, not crash:** assert that hitting the limit ends the run in a
   completed/`rework-exhausted` state (per the chosen semantics), not an errored run — unless
   hard-fail is explicitly configured.
3. **Round semantics:** if the recursion-counter approach is taken, assert `max_recursion_depth: 2`
   yields exactly 2 rework rounds.

## Related

- Companion report: `2026-07-05-scoped-variable-environment.md` — the environment bug that
  currently masks this one; the two fixes are coupled.
