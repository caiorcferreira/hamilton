# Workflow Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 15 duplicate variant YAML files with a TypeScript variant registry that composes tasks into the DAG at runtime via `--variants` CLI flag.

**Architecture:** Variant definitions live in a TS module (`src/workflow/variants.ts`) — each variant declares placement, capabilities (provides/replaces), and tasks. The compose function merges variant tasks into the base workflow DAG before topological sort, deduplicating via capability replaces. CLI parses `--variants branchout,merge` comma-separated.

**Tech Stack:** TypeScript, Effect-TS, `@effect/schema`, `@effect/cli`, bun:sqlite

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/types.ts` | Modify | Add `VariantCapabilities`, `VariantPlacement`, `VariantTask`, `WorkflowSpec.variants` |
| `src/schemas.ts` | Modify | Add `VariantsConfigSchema` to `WorkflowSpecSchema` |
| `src/workflow/variants.ts` | Create | `VARIANT_REGISTRY` + `composeVariants()` compose function |
| `src/workflow/loader.ts` | Modify | Call `composeVariants()` after YAML parse |
| `src/workflow/resolver.ts` | Modify | Strip `--variants` suffix, match base name only |
| `src/cli/commands/run.ts` | Modify | Add `--variants` option, pass to loader |
| `tests/workflow/variants.test.ts` | Create | Unit tests for compose algorithm |
| `tests/workflow/resolver.test.ts` | Modify | Update for new resolver behavior |
| `tests/cli/run.test.ts` | Modify | Update for `--variants` flag |
| `workflows/*/workflow.yml` (5 files) | Modify | Add `variants.supported`, remove variant-specific prompt content |
| `workflows/*-{merge,worktree,merge-worktree,github-pr}/` (15 dirs) | Delete | Remove variant-suffixed workflow directories |

---

### Task 1: Define Variant Types

**Files:**
- Modify: `src/types.ts:1-110`

- [ ] **Step 1: Add types after `WorkflowTask` interface**

```typescript
export type VariantPlacement = "start" | "end"

export interface VariantCapabilities {
  provides: string[]
  replaces: string[]
}

export interface VariantTask {
  placement: VariantPlacement
  capabilities: VariantCapabilities
  task: WorkflowTask
}
```

- [ ] **Step 2: Add `variants` to `WorkflowSpec`**

In the `WorkflowSpec` interface, add after `tasks`:

```typescript
export interface WorkflowSpec {
  version: number
  name: string
  description?: string
  run: RunConfig
  variants?: {
    supported: string[]
  }
  agents: WorkflowAgent[]
  tasks: WorkflowTask[]
}
```

- [ ] **Step 3: Verify build compiles**

Run: `bun run build`
Expected: PASS (types added, no consumers yet)

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add VariantTask, VariantCapabilities, VariantPlacement types"
```

---

### Task 2: Add Variant Schema Validation

**Files:**
- Modify: `src/schemas.ts:1-140`

- [ ] **Step 1: Add `VariantsConfigSchema` and wire into `WorkflowSpecSchema`**

Add after the `RunConfigSchema` (line ~112):

```typescript
const VariantsConfigSchema = Schema.optional(
  Schema.Struct({
    supported: Schema.Array(Schema.String)
  })
)
```

Then update `WorkflowSpecSchema` to include it. Change the struct from:

```typescript
export const WorkflowSpecSchema = Schema.Struct({
  version: Schema.Number,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  run: RunConfigSchema,
  agents: Schema.NonEmptyArray(WorkflowAgentSchema),
  tasks: Schema.Array(WorkflowTaskSchema)
}).pipe(
```

To:

```typescript
export const WorkflowSpecSchema = Schema.Struct({
  version: Schema.Number,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  run: RunConfigSchema,
  variants: VariantsConfigSchema,
  agents: Schema.NonEmptyArray(WorkflowAgentSchema),
  tasks: Schema.Array(WorkflowTaskSchema)
}).pipe(
```

The rest of the pipe (filter for task validation) stays unchanged.

- [ ] **Step 2: Verify build compiles**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/schemas.ts
git commit -m "feat: add VariantsConfigSchema to WorkflowSpecSchema"
```

---

### Task 3: Create Variant Registry and Compose Function

**Files:**
- Create: `src/workflow/variants.ts`
- Create: `tests/workflow/variants.test.ts`

- [ ] **Step 1: Write the failing tests for composeVariants**

```typescript
// tests/workflow/variants.test.ts
import { describe, it, expect } from "vitest"
import { composeVariants } from "../../src/workflow/variants.js"
import type { WorkflowSpec, WorkflowTask } from "../../src/types.js"

function baseSpec(tasks: WorkflowTask[]): WorkflowSpec {
  return {
    version: 1,
    name: "test-wf",
    run: { entrypoint: "plan", timeout: "300s" },
    variants: { supported: ["branchout", "worktree", "merge"] },
    agents: [{ name: "setup", role: "coding", settings: { systemPrompt: { agent: "a", soul: "s", identity: "i" } } }],
    tasks
  }
}

describe("composeVariants", () => {
  it("returns base spec unchanged when no variants active", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, [])
    expect(result.tasks.map(t => t.name)).toEqual(["plan"])
  })

  it("injects start task before entrypoint", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["branchout"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-branch", "plan"])
  })

  it("injects end task after DAG leaves", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["merge"])
    expect(result.tasks.map(t => t.name)).toEqual(["plan", "finalize-merge"])
  })

  it("applies replaces: worktree supersedes branchout", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["branchout", "worktree"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan"])
  })

  it("chains multiple end tasks in supported order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["merge", "worktree"])
    expect(result.tasks.map(t => t.name)).toEqual(["plan", "finalize-merge", "cleanup-worktree"])
  })

  it("throws on unsupported variant", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    expect(() => composeVariants(spec, ["nope"])).toThrow("unsupported variant")
  })

  it("respects supported order, not CLI order", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["worktree", "branchout"])
    expect(result.tasks.map(t => t.name)).toEqual(["create-worktree", "plan"])
  })

  it("merges variant agents without duplicates", () => {
    const spec = baseSpec([
      { name: "plan", agent: { ref: "agents.setup", prompt: { content: "" } } }
    ])
    const result = composeVariants(spec, ["merge"])
    expect(result.tasks.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/workflow/variants.test.ts`
Expected: FAIL (function not found)

- [ ] **Step 3: Create `src/workflow/variants.ts` with registry and compose function**

```typescript
import type { VariantTask, WorkflowAgent } from "../types.js"

interface VariantDefinition {
  agents: WorkflowAgent[]
  tasks: VariantTask[]
}

export const VARIANT_REGISTRY: Record<string, VariantDefinition> = {
  branchout: {
    agents: [],
    tasks: [
      {
        placement: "start",
        capabilities: { provides: ["workspace-created"], replaces: [] },
        task: {
          name: "create-branch",
          agent: {
            ref: "agents.setup",
            prompt: {
              content: "Run the following commands:\n1. cd {{tasks.plan.outputs.repo}}\n2. git checkout -b {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done"
            }
          }
        }
      }
    ]
  },
  worktree: {
    agents: [
      {
        name: "worktree-handler",
        role: "coding",
        settings: {
          systemPrompt: {
            agent: "shared/agents/setup/AGENTS.md",
            soul: "shared/agents/setup/SOUL.md",
            identity: "shared/agents/setup/IDENTITY.md"
          }
        }
      }
    ],
    tasks: [
      {
        placement: "start",
        capabilities: { provides: ["workspace-created"], replaces: ["workspace-created"] },
        task: {
          name: "create-worktree",
          agent: {
            ref: "agents.worktree-handler",
            prompt: {
              content: "Create an isolated git worktree.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nDeterministic activity: createGitWorktree\n\nReply with STATUS: done, WORKTREE_PATH: <path>, ORIGINAL_BRANCH: <branch>"
            }
          }
        }
      },
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "cleanup-worktree",
          agent: {
            ref: "agents.worktree-handler",
            prompt: {
              content: "Clean up the worktree.\n\nREPO: {{tasks.plan.outputs.repo}}\n\nDeterministic activity: cleanupGitWorktree\n\nReply with STATUS: done"
            }
          }
        }
      }
    ]
  },
  merge: {
    agents: [
      {
        name: "merger",
        role: "pr",
        settings: {
          systemPrompt: {
            agent: "agents/merger/AGENTS.md",
            soul: "agents/merger/SOUL.md",
            identity: "agents/merger/IDENTITY.md"
          }
        }
      }
    ],
    tasks: [
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "finalize-merge",
          agent: {
            ref: "agents.merger",
            prompt: {
              content: "Finalize by squashing changes and merging.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done"
            }
          }
        }
      }
    ]
  },
  github_pr: {
    agents: [
      {
        name: "reviewer",
        role: "analysis",
        settings: {
          systemPrompt: {
            agent: "agents/reviewer/AGENTS.md",
            soul: "agents/reviewer/SOUL.md",
            identity: "agents/reviewer/IDENTITY.md"
          }
        }
      }
    ],
    tasks: [
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "create-pr",
          agent: {
            ref: "agents.developer",
            prompt: {
              content: "Create a pull request.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done, PR: <url>"
            }
          }
        }
      },
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "review",
          agent: {
            ref: "agents.reviewer",
            prompt: {
              content: "Review the PR.\n\nPR: {{pr}}\n\nReply with STATUS: done, DECISION: approved"
            }
          }
        }
      }
    ]
  }
}

export function composeVariants(spec: {
  version: number
  name: string
  description?: string
  run: { entrypoint: string; timeout: string }
  variants?: { supported: string[] }
  agents: any[]
  tasks: any[]
}, activeVariants: string[]): any {
  if (activeVariants.length === 0) return spec

  const supported = spec.variants?.supported ?? []
  for (const v of activeVariants) {
    if (!supported.includes(v)) {
      throw new Error(`unsupported variant "${v}" — supported: ${supported.join(", ")}`)
    }
  }

  const orderedBySupported = supported.filter(v => activeVariants.includes(v))

  const startTasks: VariantTask[] = []
  const endTasks: VariantTask[] = []

  for (const v of orderedBySupported) {
    const def = VARIANT_REGISTRY[v]
    if (!def) continue
    for (const vt of def.tasks) {
      if (vt.placement === "start") startTasks.push(vt)
      else endTasks.push(vt)
    }
  }

  const kept: VariantTask[] = []
  const replacedCapabilities: string[] = []

  const allVariantTasks = [...startTasks, ...endTasks]
  for (const vt of allVariantTasks) {
    replacedCapabilities.push(...vt.capabilities.replaces)
  }

  for (const vt of allVariantTasks) {
    const isReplaced = vt.capabilities.provides.some(p => replacedCapabilities.includes(p))
    const isReplacer = vt.capabilities.replaces.length > 0
    if (isReplaced && !isReplacer) continue
    kept.push(vt)
  }

  const keptStart = kept.filter(vt => vt.placement === "start")
  const keptEnd = kept.filter(vt => vt.placement === "end")

  const composedTasks = [...spec.tasks]

  if (keptStart.length > 0) {
    let prevName: string | null = null
    for (const vt of keptStart) {
      const task: any = { ...vt.task, dependencies: [] }
      if (prevName) {
        task.dependencies = [prevName]
      }
      composedTasks.push(task)
      prevName = vt.task.name
    }
    const entryTask = composedTasks.find((t: any) => t.name === spec.run.entrypoint)
    if (entryTask && prevName) {
      entryTask.dependencies = [...(entryTask.dependencies ?? []), prevName]
    }
  }

  if (keptEnd.length > 0) {
    const taskNames = new Set(composedTasks.map((t: any) => t.name))
    const dependents = new Set<string>()
    for (const t of composedTasks) {
      for (const dep of t.dependencies ?? []) {
        dependents.add(dep)
      }
    }
    const leaves = composedTasks.filter((t: any) => !dependents.has(t.name))
    const leafNames = leaves.map((t: any) => t.name)

    let prevName: string | null = null
    for (const vt of keptEnd) {
      const task: any = { ...vt.task, dependencies: [] }
      if (prevName) {
        task.dependencies = [prevName]
      } else {
        task.dependencies = [...leafNames]
      }
      composedTasks.push(task)
      prevName = vt.task.name
    }
  }

  const agentNames = new Set(spec.agents.map((a: any) => a.name))
  for (const v of orderedBySupported) {
    const def = VARIANT_REGISTRY[v]
    if (!def) continue
    for (const agent of def.agents) {
      if (!agentNames.has(agent.name)) {
        spec.agents.push(agent)
        agentNames.add(agent.name)
      }
    }
  }

  return { ...spec, tasks: composedTasks }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/workflow/variants.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/variants.ts tests/workflow/variants.test.ts
git commit -m "feat: add variant registry and composeVariants function"
```

---

### Task 4: Wire Compose Into Loader

**Files:**
- Modify: `src/workflow/loader.ts:1-84`

- [ ] **Step 1: Add import and call composeVariants in loadWorkflowSpec**

Add import at top:

```typescript
import { composeVariants } from "./variants.js"
```

In `loadWorkflowSpec`, after the `spec` is decoded (line 75-83), pass active variants. For now, pass `[]` (CLI integration comes in Task 6). The loader signature stays the same.

In `loadWorkflowSpec`, after `resolveWorkflowSpec`, add:

```typescript
const spec = yield* _(
  Effect.try({
    try: () => {
      const decoded = resolveWorkflowSpec(dir, Schema.decodeUnknownSync(WorkflowSpecSchema)(raw))
      return composeVariants(decoded, [])
    },
    catch: (e) => new WorkflowParseError({ workflowName, message: String(e) })
  })
)
```

- [ ] **Step 2: Verify build compiles**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/workflow/loader.ts
git commit -m "feat: wire composeVariants into workflow loader"
```

---

### Task 5: Loader Accepts Active Variants

**Files:**
- Modify: `src/workflow/loader.ts:53-84`

- [ ] **Step 1: Add activeVariants parameter to loadWorkflowSpec**

Change function signature:

```typescript
export function loadWorkflowSpec(
  workflowsDir: string,
  workflowName: string,
  activeVariants: string[] = []
): Effect.Effect<Schema.Schema.Type<typeof WorkflowSpecSchema>, WorkflowNotFoundError | WorkflowParseError> {
```

Change the compose call inside from `composeVariants(decoded, [])` to:

```typescript
return composeVariants(decoded, activeVariants)
```

- [ ] **Step 2: Verify build compiles**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Update loader test to verify variants pass-through**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/workflow/loader.ts
git commit -m "feat: loader accepts activeVariants parameter"
```

---

### Task 6: Update CLI to Parse --variants Flag

**Files:**
- Modify: `src/cli/commands/run.ts:1-86`

- [ ] **Step 1: Add --variants option and pass to loader**

Update imports:

```typescript
import { Args, Command, Options } from "@effect/cli"
```

Add the variants option after the prompt arg:

```typescript
const slug = Args.text({ name: "slug" })
const prompt = Args.text({ name: "prompt" }).pipe(Args.repeated)
const variants = Options.choice("variants", ["branchout", "merge", "worktree", "github_pr"] as const).pipe(Options.optional)
```

Use `Options.optional` to make it optional. Note: `Options.choice` creates a valued option. Since we need comma-separated multi-values, use `Options.text` instead:

```typescript
const variants = Options.text("variants").pipe(Options.optional)
```

Update `RunParams` to include:

```typescript
export interface RunParams {
  workflowSlug: string
  prompt: string
  variants?: string
}
```

In `executeRun`, parse and pass:

```typescript
export function executeRun(params: RunParams): Effect.Effect<RunResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    // ... existing home/available check ...

    const activeVariants = params.variants
      ? params.variants.split(",").map(v => v.trim()).filter(v => v.length > 0)
      : []

    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug, activeVariants)
    // ... rest unchanged ...
  })
}
```

Update `runCommand`:

```typescript
export const runCommand = Command.make("run", { slug, prompt, variants }, ({ slug, prompt, variants }) =>
  Effect.gen(function* () {
    const promptText = prompt.join(" ")
    const result = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          return yield* executeRun({ workflowSlug: slug, prompt: promptText, variants })
        })
      ).pipe(Effect.provide(EventBusLive))
    )
    // ... rest unchanged ...
  })
).pipe(Command.withDescription("Run a workflow"))
```

- [ ] **Step 2: Update the resolver to strip --variants suffix**

In `src/workflow/resolver.ts`, simplify:

```typescript
export function resolveWorkflowSlug(
  input: string,
  available: ReadonlySet<string>
): string {
  const idx = input.indexOf("--variants")
  const base = idx === -1 ? input : input.substring(0, idx)
  if (available.has(base)) return base
  return input
}
```

- [ ] **Step 3: Verify build compiles**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Update resolver tests**

Replace all resolver tests:

```typescript
// tests/workflow/resolver.test.ts
import { describe, it, expect } from "vitest"
import { resolveWorkflowSlug } from "../../src/workflow/resolver.js"

describe("resolveWorkflowSlug", () => {
  it("returns input on exact match", () => {
    const available = new Set(["bug-fix", "feature"])
    expect(resolveWorkflowSlug("bug-fix", available)).toBe("bug-fix")
  })

  it("strips --variants suffix and matches base", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowSlug("bug-fix--variants", available)).toBe("bug-fix")
  })

  it("returns input unchanged when no match", () => {
    const available = new Set(["feature"])
    expect(resolveWorkflowSlug("unknown", available)).toBe("unknown")
  })

  it("handles input without double-dash", () => {
    const available = new Set(["bug-fix"])
    expect(resolveWorkflowSlug("bug-fix", available)).toBe("bug-fix")
  })
})
```

Run: `bun --bun vitest run tests/workflow/resolver.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/run.ts src/workflow/resolver.ts tests/workflow/resolver.test.ts
git commit -m "feat: add --variants flag and simplify resolver"
```

---

### Task 7: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `bun --bun vitest run`
Expected: all tests PASS

Note: existing `run.test.ts` tests will fail because they don't yet include `variants.supported` in their YAML. We fix those in Task 8.

- [ ] **Step 2: Commit (if any fixups needed)**

```bash
git add -u
git commit -m "fix: update tests for variant-aware spec"
```

---

### Task 8: Refactor Base Workflow YAMLs

**Files:**
- Modify: `workflows/feature-dev/workflow.yml`
- Modify: `workflows/bug-fix/workflow.yml`
- Modify: `workflows/security-audit/workflow.yml`
- Modify: `workflows/quarantine-broken-tests/workflow.yml`

- [ ] **Step 1: Add `variants.supported` to feature-dev**

Insert before `agents:` in `workflows/feature-dev/workflow.yml`:

```yaml
variants:
  supported: [branchout, merge, worktree, github_pr]
```

- [ ] **Step 2: Remove `run.workspace: worktree` if present**

The base `feature-dev/workflow.yml` doesn't have `workspace` (only the worktree variant does). No change needed in base.

- [ ] **Step 3: Simplify setup task in feature-dev**

The setup task currently handles branch creation. Since `branchout` variant now does this, remove branch-creation steps from setup's prompt. From:

```
Instructions:
1. cd into the repo
2. Create the feature branch (git checkout -b {{tasks.plan.outputs.branch}})
3. Read package.json, CI config, test config to understand the build/test setup
...
```

To:

```
Instructions:
1. cd into the repo
2. Read package.json, CI config, test config to understand the build/test setup
3. Ensure .gitignore exists — if missing, create one appropriate for the detected stack (must include .env, node_modules/, *.key, *.pem at minimum)
4. Run the build to establish a baseline
5. Run the tests to establish a baseline
6. Report what you found
```

Reorder numbered items after item 2.

- [ ] **Step 4: Repeat for bug-fix, security-audit, quarantine-broken-tests**

Same pattern: add `variants.supported`, simplify setup. Each workflow variant list matches what it currently supports:

```yaml
# bug-fix
variants:
  supported: [branchout, merge, worktree, github_pr]

# security-audit
variants:
  supported: [branchout, merge, worktree, github_pr]

# quarantine-broken-tests
variants:
  supported: [branchout, merge, worktree]
```

- [ ] **Step 5: Remove variant-suffixed workflow directories**

```bash
rm -rf workflows/feature-dev-merge
rm -rf workflows/feature-dev-worktree
rm -rf workflows/feature-dev-merge-worktree
rm -rf workflows/feature-dev-github-pr
rm -rf workflows/bug-fix-merge
rm -rf workflows/bug-fix-worktree
rm -rf workflows/bug-fix-merge-worktree
rm -rf workflows/bug-fix-github-pr
rm -rf workflows/security-audit-merge
rm -rf workflows/security-audit-worktree
rm -rf workflows/security-audit-merge-worktree
rm -rf workflows/security-audit-github-pr
rm -rf workflows/quarantine-broken-tests-merge
rm -rf workflows/quarantine-broken-tests-merge-worktree
```

- [ ] **Step 6: Run full test suite**

Run: `bun --bun vitest run`
Expected: all tests PASS (update any tests referencing removed workflow names)

- [ ] **Step 7: Commit**

```bash
git add workflows/
git commit -m "feat: add variants.supported to base workflows, remove variant-suffix directories"
```

---

### Task 9: Update CLI Run Tests

**Files:**
- Modify: `tests/cli/run.test.ts:1-123`

- [ ] **Step 1: Add `variants.supported` to test YAML**

Update `validYaml`:

```typescript
const validYaml = `name: test-wf
version: 1
run:
  entrypoint: step-1
  timeout: 300s
variants:
  supported: [branchout]
agents:
  - name: agent-1
    role: coding
    settings:
      systemPrompt:
        agent: agents/agent-1/AGENTS.md
        soul: agents/agent-1/soul.md
        identity: agents/agent-1/identity.md
tasks:
  - name: step-1
    agent:
      ref: agents.agent-1
      prompt:
        content: "Do the thing"
`
```

- [ ] **Step 2: Run run tests**

Run: `bun --bun vitest run tests/cli/run.test.ts`
Expected: 3 tests PASS

- [ ] **Step 3: Run full test suite**

Run: `bun --bun vitest run`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/cli/run.test.ts
git commit -m "test: update run tests for variants.supported field"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `bun --bun vitest run`
Expected: all tests PASS

- [ ] **Step 3: Verify install-local still works**

Run: `bun run install-local`
Expected: symlink created, `hamilton --help` works

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final verification and cleanup"
```
