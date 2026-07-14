# Feature: scoped variable environment for task outputs

**Date:** 2026-07-05
**Status:** Draft / design proposal
**Area:** `src/workflow/env.ts`, `runner.ts`, `task-executor.ts`, `template-expander.ts`, `arguments.ts`, `when-guard.ts`, `src/cel/evaluate.ts`, `src/prompts/template.ts`
**Related:** `2026-07-05-recursion-depth-not-accumulated.md` (coupled fix)

---

## Problem

Task outputs live in a single flat namespace keyed by **instance name**
([`task-executor.ts`](../../src/workflow/task-executor.ts)):

```ts
state.workflowEnv.tasks[instanceName] = { outputs: result }
```

But workflow authors reference tasks by **logical name**, e.g.
`inputs.tasks.review.outputs.verdict`. Nothing sits between the two. Linear workflows work
only by accident: at the top level `instanceName === logicalName` (a task named `review` is
stored as `tasks.review`).

The moment a task is nested inside a templated/composite scope, its instance name is mangled
by [`buildTaskInstanceName`](../../src/workflow/engine.ts) (`parent/index` for numeric
children, `parent-child` for named children). A `review` inside `workLoop` becomes
`deepWork/0-review`, so `inputs.tasks.review` resolves to nothing. Concretely this breaks:

- **`when` guards** — `evaluateWhen` returns `false` for any missing path
  ([`evaluate.ts`](../../src/cel/evaluate.ts), `pathExists`), so a nested
  `reworkIfNeeded.when: inputs.tasks.review...` is silently always false → the rework never
  fires.
- **`forEach` refs** — `resolveArguments` falls back to `[undefined]` when
  `inputs.tasks.plan.outputs.tasks` misses ([`arguments.ts`](../../src/workflow/arguments.ts)),
  so a fan-out over a nested plan collapses to a single empty iteration.
- **Prompt templating** — `inputs.tasks.plan.outputs.progress_file` renders empty inside a
  nested task.

There is a vestigial half-mechanism for this: `env.ts` declares a `currentIteration.tasks`
field ([`env.ts:8`](../../src/workflow/env.ts)), but it is **never populated anywhere in
`src/`**. The expander even computes the reverse map we need (`originalNames`:
instance → logical) and then **throws it away** — it is returned from `expandTemplate` but no
consumer reads it. `when` is additionally evaluated against the *global* env
([`runner.ts` ~line 221](../../src/workflow/runner.ts)), so it cannot see iteration-local
state even in principle.

### Why this matters

Beyond the immediate breakage, it blocks an entire class of workflow designs — recursive
review/rework loops, nested fan-out, any pattern where a logical name must mean "the instance
in *my* scope." Authors currently have to hoist everything to the top level and hand-wire
instance names, which defeats the purpose of `template`.

## Goals

1. **Keep linear workflows trivial** — `inputs.tasks.review.outputs.x` must keep working
   unchanged, with zero regression to shipped workflows.
2. **Make nested/recursive references resolve correctly** — a logical name resolves to the
   instance in the *current* scope, falling back outward to ancestors and finally the root.
3. **Enable recursion to terminate** — a nested `reworkIfNeeded` must read *its own
   iteration's* review verdict, not a stale global one, so the loop ends when that round
   passes.
4. **Preserve the flat store as the source of truth** — persistence, resume, and unique
   addressing must not change.

## Non-goals

- Changing how outputs are persisted (the flat instance-keyed store stays authoritative).
- A general expression language beyond the existing dotted-path + CEL surface.
- Cross-iteration accumulation (previous-iteration access) — noted as a *separate*, optional
  capability below, not part of the core.

## Design: lexical scope resolution over the flat store

Treat logical-name lookup like variable lookup in nested function scopes: resolve against the
innermost scope first, then walk outward to the root. Keep the flat instance-keyed store
exactly as-is; add a **resolution layer** on top.

Everything required is already persisted or already computed:

| Piece needed | Source | Status today |
|---|---|---|
| Scope chain (task → parent composite → … → root) | `parent_task_name` column (set in `insertDynamicTask`) | persisted, unused for resolution |
| Logical → instance index per scope | `originalNames` in `expandTemplate` | computed, then discarded |
| Outputs store | `workflowEnv.tasks` (instance-keyed) | exists, unchanged |

### The resolver

```ts
// scopeChain(fromInstance): innermost composite → … → root, from parent_task_name pointers.
// logicalIndex: Map<scopeKey, Map<logicalName, instanceName>>, built from originalNames.

function resolveTaskRef(fromInstance: string, logicalName: string): string {
  for (const scope of scopeChain(fromInstance)) {   // innermost → root
    const hit = logicalIndex.get(scope)?.get(logicalName)
    if (hit) return hit
  }
  return logicalName    // root fallback === today's linear behavior
}
```

The root fallback is what preserves goal #1: at the top level the logical name *is* the
instance name, so existing references pass straight through.

### Scoped env view

Build a scoped view of `inputs.tasks` once per task, and use the **same** scoped env for both
the `when` guard and dispatch (this also fixes the current global-env bug):

```ts
function buildScopedEnv(instance: string, globalEnv: WorkflowEnv): WorkflowEnv {
  // Return an env whose `tasks.<logical>` accessor runs resolveTaskRef(instance, logical)
  // and then indexes globalEnv.tasks[resolvedInstanceName].
  // Implementation options: a Proxy over `tasks`, or pre-materialize the logical names
  // reachable from `instance`'s scope chain into a plain object.
}
```

Feed that env into the three read sites that consume `inputs`:

- `resolveArguments` — `forEach.valueFrom.ref` and `parameters[].valueFrom.ref`
  ([`arguments.ts`](../../src/workflow/arguments.ts))
- prompt rendering — `resolveDottedPath` ([`src/prompts/template.ts`](../../src/prompts/template.ts))
- `evaluateWhen` — currently fed the global env at
  [`runner.ts` ~line 221](../../src/workflow/runner.ts); switch it to the scoped env

### Resolution semantics this produces

| Reference site | Resolves to | Outcome |
|---|---|---|
| Linear top-level `tasks.review` | root `review` | unchanged, no regression |
| `applyPlan/3` → `tasks.plan` | walk up to `deepWork/0-plan` | fan-out over the plan works |
| **nested `reworkIfNeeded` → `tasks.review`** | **current iteration's review** | **guard reflects the latest verdict → loop terminates** |
| deep task → `tasks.setup` / `tasks.triage` | walk-up reaches root | ancestor/global refs work |

The third row is the core unlock: "my-scope-first" resolution is precisely what a recursive
rework loop needs.

## Design decisions to lock in

- **Shadowing = innermost wins.** The current iteration's `review` shadows any outer
  `review`. This is the desired default; document it so it is not surprising.
- **Escape hatch for absolute refs.** Occasionally an author wants "root's X regardless of
  shadowing." Add an explicit prefix (e.g. `inputs.root.tasks.setup`) rather than overloading
  the lexical path. Default stays lexical; the escape hatch is opt-in.
- **Previous-iteration access is a different capability.** Lexical resolution gives "my
  iteration." A task that needs the *prior* iteration's output (accumulators, diffs across
  rounds) should use a separate namespace (e.g. `inputs.previous.tasks.<logical>`), seeded
  from the cross-iteration dependency the expander already wires via `previousCompositeName`
  ([`template-expander.ts`](../../src/workflow/template-expander.ts)). Do not conflate the
  two.
- **Persistence / resume.** Add an `original_name` column to the tasks table; rebuild
  `logicalIndex` from `(parent_task_name, original_name)` on load. The scope chain already
  rebuilds from `parent_task_name`, so resume needs no other new state.
- **Kill the vestigial half-mechanism.** Either remove `currentIteration` from `env.ts` or
  repurpose it as the innermost-scope convenience view — do not leave two competing,
  half-built mechanisms.

## Coupling with the recursion-depth bug

This feature makes recursive loops *fire*; the depth-accumulation fix
(`2026-07-05-recursion-depth-not-accumulated.md`) makes them *stop*. Shipping this alone
converts "silently never reworks" into "silently reworks until timeout." **Ship both
together**, and land the graceful-stop semantics (skip + `rework-exhausted` signal, deferring
to `hamilton-finish-work`) alongside.

## Backward compatibility

Existing shipped workflows are all effectively root-scoped for the references that matter, so
the root fallback makes their behavior identical. The only behavior that *changes* is nested
references, which move from "broken/empty" to "resolved." Validate by running the full
existing suite plus the new tests below; there should be no diffs in linear-workflow behavior.

## Testing

- **Linear (regression):** top-level `tasks.review` resolves as today.
- **forEach fan-out:** a templated `forEach` over a nested `plan.outputs.tasks` expands to N
  iterations (not 1).
- **Recursion:** a nested `reworkIfNeeded` reads the current iteration's review and the loop
  terminates when that round returns `approved`.
- **Ancestor/global:** a deeply nested task resolves `setup`/`triage` from the root.
- **Shadowing:** an inner logical name correctly shadows an outer one; the escape-hatch
  absolute ref bypasses shadowing.
- **Resume:** after reload, `logicalIndex` and `scopeChain` rebuild from persisted columns and
  resolution is identical to pre-resume.

## Implementation sketch (file-by-file)

1. **`template-expander.ts`** — stop discarding `originalNames`; persist logical name per
   inserted task (via `insertDynamicTask` → new `original_name` column).
2. **`run-state-machine.ts` / DB** — add `original_name` column; add helpers
   `getScopeChain(taskName)` and `getLogicalIndex()` (or build the index incrementally on
   insert).
3. **New `src/workflow/scope-resolver.ts`** — `resolveTaskRef` + `buildScopedEnv`.
4. **`runner.ts`** — build the scoped env once per task; pass it to the `when` guard *and*
   dispatch; remove the global-env `when` evaluation.
5. **`arguments.ts`, `src/prompts/template.ts`, `when-guard.ts`** — consume the scoped env.
6. **`env.ts`** — remove/repurpose `currentIteration`; add `root` / `previous` namespaces if
   adopting the escape hatch and previous-iteration capability.
7. **Tests** — the matrix above, plus the recursion-termination test shared with the depth
   fix.
