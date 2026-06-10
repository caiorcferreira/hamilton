# Workflow Variants — Design Spec

## Problem

20 workflow YAML files exist for 5 base workflows due to variant suffixes (`-merge`, `-worktree`, `-github-pr`, `-merge-worktree`). Each variant file is ~90% duplicate of the base. Adding a new variant creates combinatorial explosion (e.g., `feature-dev-merge-worktree`).

## Solution

Workflows declare supported variants in YAML. Variant tasks + agents are defined in TypeScript (not YAML). The user enables variants via `--variants` CLI flag. A compose function merges variant tasks into the base DAG, handling capability-based deduplication.

---

## Types

```typescript
type VariantPlacement = "start" | "end"

interface VariantCapabilities {
  provides: string[]
  replaces: string[]
}

interface VariantTask {
  placement: VariantPlacement
  capabilities: VariantCapabilities
  task: WorkflowTask
}
```

`WorkflowTask` is unchanged — no `variants` field on it.

## YAML Schema

```yaml
# workflows/feature-dev/workflow.yml
name: feature-dev
version: 5
run:
  entrypoint: plan
  timeout: 300s
variants:
  supported: [branchout, merge, worktree, github_pr]

agents: [...]
tasks: [...]
```

`variants.supported` is a flat array of variant name strings. Order matters — variant tasks are composed in this order.

## Variant Registry

`src/workflow/variants.ts` — a `Record<string, VariantDefinition>` mapping variant names to their agents and tasks.

```typescript
interface VariantDefinition {
  agents: WorkflowAgent[]
  tasks: VariantTask[]
}
```

### Four variants

**branchout** — creates a feature branch.
- Placement: `start`
- Task: `create-branch` — `provides: ["workspace-created"]`
- Agent: none (reuses `agents.setup`)

**worktree** — isolated git worktree.
- Placement: `start` — `create-worktree` — `provides: ["workspace-created"]`, `replaces: ["workspace-created"]`
- Placement: `end` — `cleanup-worktree` — deletes the worktree
- Agent: `worktree-handler`

**merge** — squash-merge into original branch.
- Placement: `end`
- Task: `finalize-merge` — rebases + squash-merges, handles retry loop internally via `on_failure`
- Agent: `merger`

**github_pr** — creates and reviews a GitHub PR.
- Placement: `end`
- Tasks: `create-pr` then `review`
- Agents: `reviewer`

No `capture-original-branch` task — variant tasks that switch branches return the original branch in their output.

## CLI

```
hamilton workflow run feature-dev --variants branchout,merge,worktree
```

`src/cli/commands/run.ts` parses `--variants` as comma-separated, validates each name against `variants.supported`.

## Composition Algorithm

In `src/workflow/variants.ts`, exported function `composeVariants(spec, activeVariants) -> WorkflowSpec`:

1. **Validate** active variants ⊆ `spec.variants.supported`
2. **Collect** variant `VariantTask`s from `VARIANT_REGISTRY` in `variants.supported` order
3. **Apply replaces:** if task A `replaces` capability C, drop any task B (from another variant) that `provides` C. Never drops base workflow tasks.
4. **Merge agents:** variant agents into `spec.agents` (dedup by `name`)
5. **Inject start tasks:** chain sequentially in order. First has `dependencies: []` (ignores any explicit deps — start tasks are always chained). Each subsequent depends on previous. Entrypoint dependencies extended: `[...existing, last-start-task]`
6. **Inject end tasks:** chain sequentially in order. First end task depends on all current topological DAG leaves — defined as tasks with no dependents in the static graph. A `forEach` dispatcher is a static node and counts as a leaf; the runner ensures dependents wait for all dynamic instances. Subsequent end tasks depend on previous end task. Explicit `dependencies` on end tasks are ignored.

## Migration

**YAML consolidation** — each workflow family collapses:

| Before | After |
|---|---|
| `feature-dev/` + 4 variants | `feature-dev/` with `variants.supported: [branchout, merge, worktree, github_pr]` |
| `bug-fix/` + 4 variants | `bug-fix/` with same |
| `security-audit/` + 4 variants | `security-audit/` with same |
| `quarantine-broken-tests/` + 2 variants | `quarantine-broken-tests/` with `variants.supported: [merge, worktree]` |
| `greenfield/`, `do/` | unchanged |

**Base workflow refactoring:**
- `setup` task: remove branch-creation instructions (handled by `branchout`/`worktree` variants)
- `test` task: remove retry-feedback for rebase (merge handles its own retry through `finalize-merge`)
- `run.workspace: worktree` removed from YAML — derived at runtime from active variants
- Prompt references to `original_branch` removed from base tasks

**Resolver simplification** — `src/workflow/resolver.ts` no longer maps `--merge`/`--worktree` etc. to directory suffixes. Strips `--variants` suffix, matches base name.

**Breaking change** — variant-suffixed workflow directories removed. `--merge` becomes `--variants merge`.

## Error Handling

- Unknown variant in `--variants` → error listing `variants.supported`
- `replaces` targeting base task → compose-time error (forbidden)
- Agent referenced by variant task not found in variant's agent list → compose-time error
- Circular dependency from variant injection → caught by existing `topologicalSort`
- Schema: `variants.supported` validated by `WorkflowSpecSchema` (optional array of strings)

## Implementation Order

1. Types: `VariantTask`, `VariantCapabilities`, `VariantPlacement` in `src/types.ts`
2. Registry + compose: `src/workflow/variants.ts` with `VARIANT_REGISTRY` and `composeVariants()`
3. Schema: update `WorkflowSpecSchema` in `src/schemas.ts`
4. CLI: `--variants` flag in `src/cli/commands/run.ts`
5. Loader: plug `composeVariants` into `src/workflow/loader.ts`
6. Tests: unit tests for compose algorithm, variant registry, schema, resolver
7. YAML refactor: consolidate workflow YAMLs, simplify base tasks
8. Remove old resolver suffix logic
9. Remove variant-suffixed workflow directories
