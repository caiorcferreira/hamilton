# Hook System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `write_task_output` reminder loop with a generic, extensible hook system at six lifecycle points.

**Architecture:** Hook files in `~/.hamilton/hooks/` export named functions matching lifecycle points. A `HookLoader` scans and validates them at runtime. The engine runs hooks sequentially via `runHooks()` at each lifecycle point, supporting observe, intercept (cancel/fail), and transform (modified context data).

**Tech Stack:** TypeScript, Effect-TS, bun, vitest, `@effect/schema`, Pi SDK

---

## File Map

| File | Responsibility | Action |
|------|---------------|--------|
| `src/paths.ts` | Add `hooksDir()` path helper | Modify |
| `src/types.ts` | Add `hooks` field to `WorkflowSpec` | Modify |
| `src/schemas.ts` | Add `hooks` field to `WorkflowSpecSchema` | Modify |
| `src/hook/types.ts` | `HookResult`, all context types, `HookPoint`, `HookFunction`, `LoadedHook` | Create |
| `src/hook/loader.ts` | `HookLoader` Effect: scans `~/.hamilton/hooks/`, `import()`s, validates exports | Create |
| `src/hook/runner.ts` | `runHooks()` function: collects matching hooks, runs sequentially, handles errors/actions | Create |
| `src/hook/integration.ts` | `HookRuntime` type + helpers for wiring hooks into engine | Create |
| `bundle/hooks/reminder.ts` | The built-in `on_agent_exit` reminder hook | Create |
| `src/workflow/runner.ts` | Wire `on_workflow_start` and `on_workflow_completed` | Modify |
| `src/workflow/task-executor.ts` | Wire `on_task_start` and `on_task_completed` | Modify |
| `src/executors/pi/pi-executor.ts` | Wire `on_agent_enter` and `on_agent_exit`, remove hardcoded reminder | Modify |
| `src/workflow/loader.ts` | Pass `hooks` through from YAML to spec | Modify |
| `src/cli/commands/setup.ts` | Copy `bundle/hooks/` to `~/.hamilton/hooks/` during setup | Modify |
| `src/cli/commands/install-logic.ts` | `hooksDir` in `ensureHamiltonHome` dirs list | Modify |
| `tests/hook/types.test.ts` | Type-level tests for hook contexts | Create |
| `tests/hook/loader.test.ts` | HookLoader unit tests | Create |
| `tests/hook/runner.test.ts` | runHooks unit tests | Create |
| `tests/hook/reminder.test.ts` | Reminder hook unit tests | Create |
| `tests/hook/integration.test.ts` | Integration: hooks fire at correct lifecycle points | Create |

---

### Task 1: Hook types

**Files:**
- Create: `src/hook/types.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
import type { Effect } from "effect"
import type { WorkflowSpec, WorkflowTask } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"

export type HookAction = "continue" | "cancel" | "fail"

export interface HookResult<D = Record<string, unknown>> {
  action: HookAction
  data: D
}

export type HookPoint =
  | "on_workflow_start"
  | "on_task_start"
  | "on_agent_enter"
  | "on_agent_exit"
  | "on_task_completed"
  | "on_workflow_completed"

export const HOOK_POINTS: readonly HookPoint[] = [
  "on_workflow_start",
  "on_task_start",
  "on_agent_enter",
  "on_agent_exit",
  "on_task_completed",
  "on_workflow_completed"
] as const

export interface PiSessionLike {
  isActive: () => boolean
  prompt: (msg: string) => Promise<unknown>
}

export interface WorkflowStartContext {
  runId: string
  spec: WorkflowSpec
  parameters: Record<string, unknown>
}

export interface TaskStartContext {
  runId: string
  taskId: string
  instanceName: string
  task: WorkflowTask
  env: WorkflowEnv
}

export interface AgentEnterContext {
  runId: string
  taskId: string
  agentId: string
  session: PiSessionLike
  prompt: string
}

export interface AgentExitContext {
  runId: string
  taskId: string
  session: PiSessionLike
}

export interface TaskCompletedContext {
  runId: string
  taskId: string
  result: Record<string, unknown>
  env: WorkflowEnv
}

export interface WorkflowCompletedContext {
  runId: string
  status: string
  taskResults: Record<string, string>
  summary: Record<string, unknown>
}

export type HookContext =
  | { point: "on_workflow_start"; ctx: WorkflowStartContext }
  | { point: "on_task_start"; ctx: TaskStartContext }
  | { point: "on_agent_enter"; ctx: AgentEnterContext }
  | { point: "on_agent_exit"; ctx: AgentExitContext }
  | { point: "on_task_completed"; ctx: TaskCompletedContext }
  | { point: "on_workflow_completed"; ctx: WorkflowCompletedContext }

export type HookFunction<C, D = Record<string, unknown>> = (ctx: C) => Effect.Effect<never, never, HookResult<D>>

export interface LoadedHook {
  name: string
  point: HookPoint
  fn: HookFunction<Record<string, unknown>>
}
```

- [ ] **Step 2: Run build to verify types compile**

Run: `bun run build`
Expected: No type errors in the new file

- [ ] **Step 3: Commit**

```bash
git add src/hook/types.ts
git commit -m "feat: add hook system type definitions"
```

---

### Task 2: Add hooksDir to paths

**Files:**
- Modify: `src/paths.ts:54-60`

- [ ] **Step 1: Add hooksDir function**

In `src/paths.ts`, add after the `skillsDir` function:

```typescript
export function hooksDir(): string {
  return Path.join(hamiltonHome(), "hooks")
}
```

- [ ] **Step 2: Add hooksDir to ensureHamiltonHome dirs array**

In the `ensureHamiltonHome` function, add `hooksDir()` to the dirs array:

```typescript
export function ensureHamiltonHome(): void {
  const dirs = [
    hamiltonHome(),
    agentsDir(),
    workflowsDir(),
    runsDir(),
    Path.join(hamiltonHome(), "executors", "pi", "agent"),
    guidelinesDir(),
    skillsDir(),
    hooksDir()
  ]
  for (const dir of dirs) {
    if (!Fs.existsSync(dir)) {
      Fs.mkdirSync(dir, { recursive: true })
    }
  }
}
```

- [ ] **Step 3: Run build to verify**

Run: `bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/paths.ts
git commit -m "feat: add hooksDir path helper and ensureHamiltonHome entry"
```

---

### Task 3: HookLoader — scan, import, validate

**Files:**
- Create: `src/hook/loader.ts`
- Create: `tests/hook/loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadHooks } from "../../src/hook/loader.js"
import { HOOK_POINTS } from "../../src/hook/types.js"

describe("loadHooks", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-hooks-test-"))
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createHookFile(name: string, content: string): void {
    const hooksDir = Path.join(tmpDir, ".hamilton", "hooks")
    Fs.mkdirSync(hooksDir, { recursive: true })
    Fs.writeFileSync(Path.join(hooksDir, name), content)
  }

  it("loads a valid hook file", async () => {
    createHookFile("reminder.ts", `
      import { Effect } from "effect"
      export default function on_agent_exit(ctx) {
        return Effect.succeed({ action: "continue", data: {} })
      }
    `)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const hooks = result.value
      expect(hooks).toHaveLength(1)
      expect(hooks[0]!.name).toBe("reminder")
      expect(hooks[0]!.point).toBe("on_agent_exit")
    }
  })

  it("returns empty when hooks dir does not exist", async () => {
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("skips files without a default function export", async () => {
    createHookFile("bad.ts", `export const foo = "bar"`)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("skips files whose function name is not a valid hook point", async () => {
    createHookFile("bad.ts", `
      import { Effect } from "effect"
      export default function not_a_hook(ctx) {
        return Effect.succeed({ action: "continue", data: {} })
      }
    `)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("skips files whose default export is not a function", async () => {
    createHookFile("bad.ts", `export default "string"`)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })

  it("loads multiple valid hooks", async () => {
    createHookFile("reminder.ts", `
      import { Effect } from "effect"
      export default function on_agent_exit(ctx) {
        return Effect.succeed({ action: "continue", data: {} })
      }
    `)
    createHookFile("audit.ts", `
      import { Effect } from "effect"
      export default function on_task_completed(ctx) {
        return Effect.succeed({ action: "continue", data: { result: ctx.result } })
      }
    `)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(2)
    }
  })

  it("ignores non-.ts files", async () => {
    createHookFile("notes.md", "# notes")
    createHookFile("helper.js", `export default {}`)
    const result = await Effect.runPromiseExit(loadHooks)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/hook/loader.test.ts`
Expected: FAIL with "No test files found" or import errors since `src/hook/loader.ts` doesn't exist

- [ ] **Step 3: Write the HookLoader implementation**

```typescript
import { Effect, Console } from "effect"
import * as Fs from "node:fs"
import type { LoadedHook, HookPoint, HookFunction } from "./types.js"
import { HOOK_POINTS } from "./types.js"
import { hooksDir } from "../paths.js"

export const loadHooks: Effect.Effect<LoadedHook[], never, never> = Effect.gen(function* (_) {
  const dir = hooksDir()
  if (!Fs.existsSync(dir)) return []

  const entries = Fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .sort()

  const loaded: LoadedHook[] = []

  for (const entry of entries) {
    const name = entry.name.replace(/\.ts$/, "")
    const filePath = `${dir}/${entry.name}`

    const mod = yield* _(
      Effect.tryPromise({
        try: () => import(filePath),
        catch: (err) => {
          Effect.runSync(Console.log(`Hook "${name}": import failed — ${String(err)}`))
          return null
        }
      })
    )

    if (!mod) continue

    const defaultExport = mod.default
    if (!defaultExport || typeof defaultExport !== "function") {
      yield* _(Console.log(`Hook "${name}": default export is not a function — skipping`))
      continue
    }

    const fn = defaultExport as (...args: unknown[]) => unknown
    const fnName = fn.name

    if (!fnName || !(HOOK_POINTS as readonly string[]).includes(fnName)) {
      yield* _(Console.log(`Hook "${name}": function name "${fnName || "anonymous"}" is not a valid hook point — skipping`))
      continue
    }

    loaded.push({
      name,
      point: fnName as HookPoint,
      fn: fn as HookFunction<Record<string, unknown>>
    })
  }

  return loaded
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/hook/loader.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hook/loader.ts tests/hook/loader.test.ts
git commit -m "feat: add HookLoader — scan, import, and validate hook files"
```

---

### Task 4: runHooks — execution engine

**Files:**
- Create: `src/hook/runner.ts`
- Create: `tests/hook/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { runHooks } from "../../src/hook/runner.js"
import type { LoadedHook, HookPoint } from "../../src/hook/types.js"

function makeHook(name: string, point: HookPoint, impl: (ctx: Record<string, unknown>) => Effect.Effect<never, never, { action: "continue" | "cancel" | "fail"; data: Record<string, unknown> }>): LoadedHook {
  return { name, point, fn: impl as any }
}

describe("runHooks", () => {
  it("returns continue when no hooks match", async () => {
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
      expect(result.value.data).toEqual({})
    }
  })

  it("runs matching hooks sequentially", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("a", "on_task_start", (ctx) => {
        order.push("a")
        return Effect.succeed({ action: "continue", data: { ...ctx, a_ran: true } })
      }),
      makeHook("b", "on_task_start", (ctx) => {
        order.push("b")
        return Effect.succeed({ action: "continue", data: { ...ctx, b_ran: true } })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", { original: true }, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(order).toEqual(["a", "b"])
    }
  })

  it("passes transformed data between hooks", async () => {
    const hooks: LoadedHook[] = [
      makeHook("add", "on_task_start", (ctx) =>
        Effect.succeed({ action: "continue", data: { ...ctx, count: (ctx.count as number || 0) + 1 } })
      ),
      makeHook("multiply", "on_task_start", (ctx) =>
        Effect.succeed({ action: "continue", data: { ...ctx, count: (ctx.count as number) * 2 } })
      )
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", { count: 1 }, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.data.count).toBe(4)
    }
  })

  it("stops chain on cancel action", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("first", "on_task_start", (ctx) => {
        order.push("first")
        return Effect.succeed({ action: "cancel", data: ctx })
      }),
      makeHook("second", "on_task_start", (ctx) => {
        order.push("second")
        return Effect.succeed({ action: "continue", data: ctx })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("cancel")
      expect(order).toEqual(["first"])
    }
  })

  it("stops chain on fail action", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("first", "on_task_start", (ctx) => {
        order.push("first")
        return Effect.succeed({ action: "fail", data: ctx })
      }),
      makeHook("second", "on_task_start", (ctx) => {
        order.push("second")
        return Effect.succeed({ action: "continue", data: ctx })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("fail")
      expect(order).toEqual(["first"])
    }
  })

  it("logs error and continues on hook failure", async () => {
    const order: string[] = []
    const hooks: LoadedHook[] = [
      makeHook("bad", "on_task_start", (_ctx) => {
        order.push("bad")
        return Effect.fail(new Error("boom"))
      }),
      makeHook("good", "on_task_start", (ctx) => {
        order.push("good")
        return Effect.succeed({ action: "continue", data: ctx })
      })
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
      expect(order).toEqual(["bad", "good"])
    }
  })

  it("only runs hooks matching the given point", async () => {
    const hooks: LoadedHook[] = [
      makeHook("exit_hook", "on_agent_exit", (_ctx) =>
        Effect.succeed({ action: "continue", data: {} })
      ),
      makeHook("start_hook", "on_task_start", (ctx) =>
        Effect.succeed({ action: "continue", data: { start_ran: true } })
      )
    ]
    const result = await Effect.runPromiseExit(runHooks("on_task_start", {}, hooks))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.data).toEqual({ start_ran: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/hook/runner.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Write the runHooks implementation**

```typescript
import { Effect, Console, Either } from "effect"
import type { LoadedHook, HookPoint, HookAction, HookResult } from "./types.js"

export function runHooks(
  point: HookPoint,
  initialCtx: Record<string, unknown>,
  allHooks?: LoadedHook[]
): Effect.Effect<{ action: HookAction; data: Record<string, unknown> }, never, never> {
  return Effect.gen(function* (_) {
    const matching = (allHooks ?? []).filter((h) => h.point === point)
    let data = { ...initialCtx }

    for (const hook of matching) {
      const result = yield* _(
        Effect.either(hook.fn(data))
      )

      if (Either.isLeft(result)) {
        yield* _(Console.log(`Hook "${hook.name}" failed: ${String(result.left)}`))
        continue
      }

      const output: HookResult = result.right as HookResult

      if (output.action === "cancel") {
        return { action: "cancel", data: { ...data, ...output.data as Record<string, unknown> } }
      }

      if (output.action === "fail") {
        return { action: "fail", data: { ...data, ...output.data as Record<string, unknown> } }
      }

      data = { ...data, ...output.data as Record<string, unknown> }
    }

    return { action: "continue", data }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/hook/runner.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hook/runner.ts tests/hook/runner.test.ts
git commit -m "feat: add runHooks — sequential hook execution with action handling"
```

---

### Task 5: Add hooks field to WorkflowSpec and schema

**Files:**
- Modify: `src/types.ts:123-137`
- Modify: `src/schemas.ts:152-161`
- Modify: `src/workflow/loader.ts:77-139`

- [ ] **Step 1: Add hooks to WorkflowSpec interface**

In `src/types.ts`, add `hooks` to `WorkflowSpec`:

```typescript
export interface WorkflowSpec {
  metadata: {
    version: number
    name: string
    description?: string
  }
  spec: {
    run: RunConfig
    variants?: {
      supported: string[]
    }
    tasks: WorkflowTask[]
  }
  hooks?: string[]
  agentRegistry: Map<string, AgentManifest>
}
```

- [ ] **Step 2: Add hooks to WorkflowSpecSchema**

In `src/schemas.ts`, add `hooks` to the `spec` struct in `WorkflowSpecSchema`:

```typescript
export const WorkflowSpecSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamiltonai.dev/v1alpha1"),
  kind: Schema.Literal("Workflow"),
  metadata: WorkflowMetadataSchema,
  spec: Schema.Struct({
    run: RunConfigSchema,
    variants: Schema.optional(VariantsConfigSchema),
    tasks: Schema.Array(WorkflowTaskSchema),
    hooks: Schema.optional(Schema.Array(Schema.String))
  })
}).pipe(
  Schema.filter(
    (spec: any) => {
      const taskNames = new Set(spec.spec.tasks.map((t: any) => t.name))
      let valid = true
      for (const task of spec.spec.tasks) {
        if (!task.agent && !task.script && !task.template && !task.tasks) {
          valid = false
          break
        }
        if (task.agent && task.script) {
          valid = false
          break
        }
        if (task.template && !taskNames.has(task.template)) {
          valid = false
          break
        }
      }
      return valid
    },
    { message: () => "every task must have agent, script, template, or nested tasks. agent and script are mutually exclusive. template references must be valid task names." }
  )
)
```

- [ ] **Step 3: Pass hooks through in workflow loader**

In `src/workflow/loader.ts`, in the `loadWorkflowSpec` function, after the `composeVariants` call, add hooks to the returned spec. Change the return at line 138:

```typescript
    return { ...spec, hooks: (raw as any).spec?.hooks, agentRegistry } as unknown as WorkflowSpec
```

- [ ] **Step 4: Run build to verify**

Run: `bun run build`
Expected: No errors

- [ ] **Step 5: Run existing loader tests**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: All existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/schemas.ts src/workflow/loader.ts
git commit -m "feat: add hooks field to WorkflowSpec, schema, and loader"
```

---

### Task 6: HookRuntime and integration helpers

**Files:**
- Create: `src/hook/integration.ts`

- [ ] **Step 1: Write the integration module**

```typescript
import { Effect, Ref } from "effect"
import type { LoadedHook, HookPoint, HookAction } from "./types.js"
import { runHooks } from "./runner.js"

export interface HookRuntime {
  readonly hooks: ReadonlyArray<LoadedHook>
  run: (point: HookPoint, ctx: Record<string, unknown>) => Effect.Effect<{ action: HookAction; data: Record<string, unknown> }, never, never>
}

export function makeHookRuntime(hooks: ReadonlyArray<LoadedHook>): HookRuntime {
  return {
    hooks,
    run: (point, ctx) => runHooks(point, ctx, hooks as LoadedHook[])
  }
}

export function mergeHookData<T extends Record<string, unknown>>(
  original: T,
  transformed: Record<string, unknown>,
  blocklist: string[] = []
): T {
  const result = { ...original, ...transformed } as Record<string, unknown>
  for (const key of blocklist) {
    delete result[key]
  }
  return result as T
}
```

- [ ] **Step 2: Run build to verify**

Run: `bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hook/integration.ts
git commit -m "feat: add HookRuntime and mergeHookData integration helpers"
```

---

### Task 7: Built-in reminder hook

**Files:**
- Create: `bundle/hooks/reminder.ts`
- Create: `tests/hook/reminder.test.ts`

- [ ] **Step 1: Create the reminder hook file**

```typescript
import { Effect } from "effect"

export default function on_agent_exit(ctx: { session: { isActive: () => boolean; prompt: (msg: string) => Promise<unknown> } }) {
  return Effect.gen(function* (_) {
    let sent = 0
    const MAX_REMINDERS = 2
    while (ctx.session.isActive() && sent < MAX_REMINDERS) {
      yield* _(Effect.promise(() =>
        ctx.session.prompt("REMINDER: You must call write_task_output to save your work. Call write_task_output now with the JSON task output.")
      ))
      sent++
    }
    return { action: "continue" as const, data: {} }
  })
}
```

- [ ] **Step 2: Write the reminder hook test**

```typescript
import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import reminderFn from "../../bundle/hooks/reminder.js"

describe("reminder hook (on_agent_exit)", () => {
  it("does nothing when session is already inactive", async () => {
    const session = {
      isActive: () => false,
      prompt: async (_msg: string) => { throw new Error("should not be called") }
    }
    const result = await Effect.runPromiseExit(reminderFn({ session }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
    }
  })

  it("sends reminders until session becomes inactive", async () => {
    const prompts: string[] = []
    let callCount = 0
    const session = {
      isActive: () => {
        callCount++
        return callCount < 3
      },
      prompt: async (msg: string) => { prompts.push(msg) }
    }
    const result = await Effect.runPromiseExit(reminderFn({ session }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
    }
    expect(prompts).toHaveLength(2)
    for (const p of prompts) {
      expect(p).toContain("REMINDER: You must call write_task_output")
    }
  })

  it("caps reminders at MAX_REMINDERS (2)", async () => {
    const prompts: string[] = []
    const session = {
      isActive: () => true,
      prompt: async (msg: string) => { prompts.push(msg) }
    }
    const result = await Effect.runPromiseExit(reminderFn({ session }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
    }
    expect(prompts).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --bun vitest run tests/hook/reminder.test.ts`
Expected: FAIL (if the import doesn't resolve) or PASS (since the file already exists)

Actually the file exists, so the test will likely pass on first run. Let's verify.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/hook/reminder.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add bundle/hooks/reminder.ts tests/hook/reminder.test.ts
git commit -m "feat: add built-in reminder hook (on_agent_exit)"
```

---

### Task 8: Wire hooks into runner.ts (on_workflow_start, on_workflow_completed)

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Add hook runtime to runner**

Add imports at top of `src/workflow/runner.ts`:

```typescript
import { loadHooks } from "../hook/loader.js"
import { makeHookRuntime, mergeHookData } from "../hook/integration.js"
```

- [ ] **Step 2: Load hooks and create runtime in runWorkflow**

In the `runWorkflow` function, after `const startedAt` line (line 62), add:

```typescript
    const hooks = yield* _(loadHooks)
    const hookRuntime = makeHookRuntime(hooks)
```

- [ ] **Step 3: Wire on_workflow_start**

After `yield* _(bus.publish({ _tag: "WorkflowStarted", runId: ctx.runId }))` (line 87), add:

```typescript
    const wfStartResult = yield* _(hookRuntime.run("on_workflow_start", {
      runId: ctx.runId,
      spec,
      parameters: initialParameters as Record<string, unknown>
    }))
    if (wfStartResult.action === "cancel" || wfStartResult.action === "fail") {
      yield* _(ctx.fail("cancelled by on_workflow_start hook").pipe(Effect.catchAll(() => Effect.void)))
      return {
        runId: ctx.runId,
        status: "failed" as const,
        taskResults: {},
        env: initialParameters as Record<string, unknown>,
        startedAt,
        completedAt: new Date().toISOString()
      }
    }
```

- [ ] **Step 4: Wire on_workflow_completed**

Before the final `return { runId: ctx.runId, status: finalStatus, taskResults, env: workflowEnv as Record<string, unknown>, startedAt, completedAt }` in the body (around line 235), store the result and add hook:

Change this block in the `body` Effect.gen:
```typescript
      const summary = { runId: ctx.runId, status: finalStatus, taskResults, env: workflowEnv, startedAt, completedAt, totalTokensIn, totalTokensOut, elapsedSeconds }

      yield* _(bus.publish({ _tag: "WorkflowCompleted", runId: ctx.runId, summary }))

      const wfCompleteResult = yield* _(hookRuntime.run("on_workflow_completed", {
        runId: ctx.runId,
        status: finalStatus,
        taskResults,
        summary
      }))
      const finalSummary = mergeHookData(summary, wfCompleteResult.data)

      return { runId: ctx.runId, status: finalStatus, taskResults, env: workflowEnv as Record<string, unknown>, startedAt, completedAt }
```

- [ ] **Step 5: Run build to verify**

Run: `bun run build`
Expected: No errors

- [ ] **Step 6: Run existing tests**

Run: `bun --bun vitest run tests/workflow/task-executor.test.ts`
Expected: Existing tests still PASS

- [ ] **Step 7: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "feat: wire on_workflow_start and on_workflow_completed hooks into runner"
```

---

### Task 9: Wire hooks into task-executor.ts (on_task_start, on_task_completed)

**Files:**
- Modify: `src/workflow/task-executor.ts`

- [ ] **Step 1: Update dispatchTask signature to accept hookRuntime**

Add import at top of `src/workflow/task-executor.ts`:

```typescript
import type { HookRuntime } from "../hook/integration.js"
```

Add `hookRuntime` parameter to `dispatchTask`:

```typescript
export function dispatchTask(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  instanceName: string,
  ctx: WorkflowRuntime,
  spec: WorkflowSpec,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  scriptConfig: { maxOutputBytes: number },
  state: TaskExecutionState,
  hookRuntime: HookRuntime
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
```

- [ ] **Step 2: Wire on_task_start**

In `dispatchTask`, after `yield* _(bus.publish({ _tag: "TaskStarted", ... }))` (line 203), add:

```typescript
    const taskStartResult = yield* _(hookRuntime.run("on_task_start", {
      runId: ctx.runId,
      taskId,
      instanceName,
      task,
      env: taskEnv as Record<string, unknown>
    }))
    if (taskStartResult.action === "cancel") {
      yield* _(ctx.transitionTask(instanceName, "complete"))
      return
    }
    if (taskStartResult.action === "fail") {
      yield* _(ctx.transitionTask(instanceName, "fail"))
      yield* _(Ref.set(state.workflowStatus, "failed"))
      return
    }
```

- [ ] **Step 3: Wire on_task_completed**

In `withTaskLifecycle`, in the `onSuccess` branch, after the `TaskCompleted` event (line 64), add hooks run call. But `hookRuntime` isn't available in `withTaskLifecycle`. We need to thread it through.

Add `hookRuntime: HookRuntime` parameter to `withTaskLifecycle`:

```typescript
function withTaskLifecycle(
  instanceName: string,
  taskId: string,
  ctx: WorkflowRuntime,
  state: TaskExecutionState,
  maxRetries: number,
  hookRuntime: HookRuntime,
  execute: Effect.Effect<any, unknown, EventBus | Scope.Scope>
): Effect.Effect<void, unknown, EventBus | Scope.Scope> {
```

In the `onSuccess` branch, after `yield* _(bus.publish({ _tag: "TaskCompleted", ... }))` add:

```typescript
              yield* _(hookRuntime.run("on_task_completed", {
                runId: ctx.runId,
                taskId,
                result,
                env: state.workflowEnv as Record<string, unknown>
              }).pipe(Effect.catchAll(() => Effect.void)))
```

And update both call sites in `dispatchTask` to pass `hookRuntime`:

Line 210 change:
```typescript
      yield* _(withTaskLifecycle(instanceName, taskId, ctx, state, maxRetries, hookRuntime, execEffect))
```

Line 214 change:
```typescript
      yield* _(withTaskLifecycle(instanceName, taskId, ctx, state, maxRetries, hookRuntime, execEffect))
```

- [ ] **Step 4: Update runner.ts to pass hookRuntime to dispatchTask**

In `src/workflow/runner.ts`, the `dispatchTask` call at line 205, add `hookRuntime`:

```typescript
          yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState, hookRuntime))
```

- [ ] **Step 5: Run build to verify**

Run: `bun run build`
Expected: No errors

- [ ] **Step 6: Run existing tests**

Run: `bun --bun vitest run tests/workflow/task-executor.test.ts`
Expected: Tests may fail because dispatchTask signature changed — we need to update the test mocks

- [ ] **Step 7: Update task-executor tests for new signature**

In `tests/workflow/task-executor.test.ts`, import and create a stub `hookRuntime`:

Add import:
```typescript
import { makeHookRuntime } from "../../src/hook/integration.js"
```

Add stub before `describe` block or in each test setup:
```typescript
const stubHookRuntime = makeHookRuntime([])
```

Update all `dispatchTask` calls to pass `stubHookRuntime` as the last argument. Search for `dispatchTask(` in the test file and add `stubHookRuntime` after `execState`.

For example, a call like:
```typescript
yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState))
```

Becomes:
```typescript
yield* _(dispatchTask(task, taskEnv, task.name, ctx, spec, guidelineFiles, allRules, skillRegistry, templateOptions, scriptConfig, execState, stubHookRuntime))
```

- [ ] **Step 8: Run tests again to verify**

Run: `bun --bun vitest run tests/workflow/task-executor.test.ts`
Expected: All existing tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/workflow/task-executor.ts src/workflow/runner.ts tests/workflow/task-executor.test.ts
git commit -m "feat: wire on_task_start and on_task_completed hooks into task executor"
```

---

### Task 10: Wire hooks into pi-executor.ts (on_agent_enter, on_agent_exit)

**Files:**
- Modify: `src/executors/pi/pi-executor.ts`

- [ ] **Step 1: Update executeWithPi signature to accept hookRuntime**

Add import:
```typescript
import type { HookRuntime } from "../../hook/integration.js"
```

Add `hookRuntime` to `PiExecutorConfig`:

```typescript
export interface PiExecutorConfig {
  prompt: ResolvablePrompt
  taskId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  cwd?: string
  extensions?: Array<unknown>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: import("../../skills/registry.js").SkillEntry[] | null
    retryOnTransient?: boolean
    compactionEnabled?: boolean
  }
  outputSchema?: Record<string, unknown>
  rules?: CompiledRule[]
  hookRuntime?: HookRuntime
}
```

- [ ] **Step 2: Wire on_agent_enter**

In the `executeWithPi` function, after `sessionRef = session` (line 209) and before `try {`, add:

```typescript
    if (config.hookRuntime) {
      const enterResult = yield* _(config.hookRuntime.run("on_agent_enter", {
        runId: config.runId,
        taskId: config.taskId,
        agentId: config.agentId,
        session,
        prompt: taskPrompt
      }))
      if (enterResult.action === "cancel" || enterResult.action === "fail") {
        return {}
      }
    }
```

- [ ] **Step 3: Wire on_agent_exit and remove hardcoded reminder**

Replace the `try` block starting at line 238:

**Remove this code (lines 238-261):**
```typescript
    try {
      yield* _(Effect.promise(() => session.prompt(taskPrompt)))

      const outputPath = taskOutputFile(config.runId, config.taskId)
      const MAX_REMINDERS = 2
      let reminders = 0
      while (!Fs.existsSync(outputPath) && reminders < MAX_REMINDERS) {
        reminders++
        yield* _(
          Effect.promise(() =>
            session.prompt("REMINDER: You must call write_task_output to save your work. Call write_task_output now with the JSON task output.")
          )
        )
      }
      if (!Fs.existsSync(outputPath)) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              taskId: config.taskId,
              message: `Task did not call write_task_output after ${reminders} reminders`
            })
          )
        )
      }

      const raw = Fs.readFileSync(outputPath, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed
    } catch (e) {
      const outputPath = taskOutputFile(config.runId, config.taskId)
      if (Fs.existsSync(outputPath)) {
        const raw = Fs.readFileSync(outputPath, "utf-8")
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return parsed
      }

      return yield* _(
        Effect.fail(
          new PiExecutionError({
            taskId: config.taskId,
            message: e instanceof Error ? e.message : String(e)
          })
        )
      )
    }
```

**Replace with:**

```typescript
    try {
      yield* _(Effect.promise(() => session.prompt(taskPrompt)))

      if (config.hookRuntime) {
        yield* _(config.hookRuntime.run("on_agent_exit", {
          runId: config.runId,
          taskId: config.taskId,
          session
        }))
      }

      const outputPath = taskOutputFile(config.runId, config.taskId)
      if (!Fs.existsSync(outputPath)) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              taskId: config.taskId,
              message: "Task did not call write_task_output"
            })
          )
        )
      }

      const raw = Fs.readFileSync(outputPath, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed
    } catch (e) {
      const outputPath = taskOutputFile(config.runId, config.taskId)
      if (Fs.existsSync(outputPath)) {
        const raw = Fs.readFileSync(outputPath, "utf-8")
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return parsed
      }

      return yield* _(
        Effect.fail(
          new PiExecutionError({
            taskId: config.taskId,
            message: e instanceof Error ? e.message : String(e)
          })
        )
      )
    }
```

- [ ] **Step 4: Pass hookRuntime from buildAgentExecEffect to executeWithPi**

In `src/workflow/task-executor.ts`, update `buildAgentExecEffect` to accept `hookRuntime` and pass it to `executeWithPi`.

Add `hookRuntime: HookRuntime` parameter to `buildAgentExecEffect`:

```typescript
function buildAgentExecEffect(
  task: WorkflowTask,
  taskEnv: WorkflowEnv,
  spec: WorkflowSpec,
  ctx: WorkflowRuntime,
  guidelineFiles: Array<{ name: string; content: string }>,
  allRules: CompiledRule[],
  skillRegistry: ReturnType<typeof import("../skills/registry.js").loadSkillRegistry>,
  templateOptions: TemplateOptions,
  agent: NonNullable<ReturnType<WorkflowSpec["agentRegistry"]["get"]>>,
  taskId: string,
  hookRuntime: HookRuntime
): Effect.Effect<unknown, unknown, EventBus | Scope.Scope> {
```

In the `executeWithPi` call within `buildAgentExecEffect`, add `hookRuntime`:

```typescript
        hookRuntime
```

As a new field in the config object passed to `executeWithPi`:

```typescript
    return yield* _(
      executeWithPi({
        prompt: {
          systemTemplate: agentPrompts.systemTemplate,
          taskTemplate: agentPrompts.taskTemplate,
          guidelineFiles: agentPrompts.guidelineFiles
        },
        taskId,
        agentId: agent.metadata.name,
        runId: ctx.runId,
        timeoutSeconds,
        model,
        outputSchema: outputSchema?.content,
        rules: allRules.length > 0 ? allRules : undefined,
        hookRuntime,
        settings: {
          skills: resolveSkills(resolved.skills, skillRegistry),
          thinking: undefined,
          tools: undefined,
          retryOnTransient: undefined,
          compactionEnabled: undefined
        }
      }).pipe(
        Effect.timeout(Duration.seconds(timeoutSeconds))
      )
    )
```

- [ ] **Step 5: Update dispatchTask to pass hookRuntime to buildAgentExecEffect**

In `dispatchTask`, line 209, add `hookRuntime`:

```typescript
      const execEffect = buildAgentExecEffect(task, taskEnv, spec, ctx, guidelineFiles, allRules, skillRegistry, templateOptions, agent, taskId, hookRuntime)
```

- [ ] **Step 6: Run build to verify**

Run: `bun run build`
Expected: No errors

- [ ] **Step 7: Run existing tests**

Run: `bun --bun vitest run tests/workflow/task-executor.test.ts tests/executors/pi/workflow-extension.test.ts`
Expected: Task executor tests may still need hookRuntime in mock calls — verify and fix

- [ ] **Step 8: Commit**

```bash
git add src/executors/pi/pi-executor.ts src/workflow/task-executor.ts
git commit -m "feat: wire on_agent_enter and on_agent_exit hooks, remove hardcoded reminder"
```

---

### Task 11: Copy bundled hooks during setup

**Files:**
- Modify: `src/cli/commands/setup.ts`

- [ ] **Step 1: Add copyHooks function**

Add after `copyGuidelineManifests` in `src/cli/commands/setup.ts`:

```typescript
function copyHooks(options?: { force?: boolean }): Effect.Effect<void, SetupError> {
  return Effect.gen(function* () {
    const srcDir = Path.join(PROJECT_ROOT, "bundle", "hooks")
    if (!Fs.existsSync(srcDir)) return

    const destHooks = Path.join(hamiltonHome(), "hooks")

    yield* Effect.try({
      try: () => Fs.cpSync(srcDir, destHooks, { recursive: true, force: true }),
      catch: (e) =>
        new SetupError({ message: `Failed to copy hooks: ${String(e)}` })
    })
  })
}
```

- [ ] **Step 2: Call copyHooks in setupHamilton**

Add after `yield* copyGuidelineManifests(options)`:

```typescript
    yield* copyHooks(options)
```

- [ ] **Step 3: Run build to verify**

Run: `bun run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/setup.ts
git commit -m "feat: copy bundled hooks to ~/.hamilton/hooks/ during setup"
```

---

### Task 12: Integration test — hooks fire at correct lifecycle points

**Files:**
- Create: `tests/hook/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Ref } from "effect"
import { loadHooks } from "../../src/hook/loader.js"
import { makeHookRuntime } from "../../src/hook/integration.js"
import type { HookPoint } from "../../src/hook/types.js"

describe("hook system integration", () => {
  let tmpDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-hooks-int-"))
    process.env.HOME = tmpDir
    Fs.mkdirSync(Path.join(tmpDir, ".hamilton", "hooks"), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loaded hooks fire correctly at their lifecycle points", async () => {
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "test_start.ts"), `
      import { Effect } from "effect"
      export default function on_workflow_start(ctx) {
        return Effect.succeed({ action: "continue", data: { hook_start_fired: true } })
      }
    `)

    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "test_complete.ts"), `
      import { Effect } from "effect"
      export default function on_workflow_completed(ctx) {
        return Effect.succeed({ action: "continue", data: { hook_complete_fired: true } })
      }
    `)

    const hooks = await Effect.runPromise(loadHooks)
    const runtime = makeHookRuntime(hooks)

    expect(hooks).toHaveLength(2)

    const startResult = await Effect.runPromise(runtime.run("on_workflow_start", { runId: "test", spec: {}, parameters: {} }))
    expect(startResult.action).toBe("continue")
    expect(startResult.data.hook_start_fired).toBe(true)

    const completeResult = await Effect.runPromise(runtime.run("on_workflow_completed", { runId: "test", status: "completed", taskResults: {}, summary: {} }))
    expect(completeResult.action).toBe("continue")
    expect(completeResult.data.hook_complete_fired).toBe(true)
  })

  it("global hooks loaded from settings take effect", async () => {
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "global.ts"), `
      import { Effect } from "effect"
      export default function on_task_start(ctx) {
        return Effect.succeed({ action: "continue", data: { global_hook_ran: true } })
      }
    `)

    const hooks = await Effect.runPromise(loadHooks)
    const runtime = makeHookRuntime(hooks)

    const result = await Effect.runPromise(runtime.run("on_task_start", { runId: "test", taskId: "t1", instanceName: "t1", task: {}, env: {} }))
    expect(result.action).toBe("continue")
    expect(result.data.global_hook_ran).toBe(true)
  })

  it("cancel action stops the workflow", async () => {
    Fs.writeFileSync(Path.join(tmpDir, ".hamilton", "hooks", "blocker.ts"), `
      import { Effect } from "effect"
      export default function on_workflow_start(ctx) {
        return Effect.succeed({ action: "cancel", data: { reason: "blocked by test" } })
      }
    `)

    const hooks = await Effect.runPromise(loadHooks)
    const runtime = makeHookRuntime(hooks)

    const result = await Effect.runPromise(runtime.run("on_workflow_start", { runId: "test", spec: {}, parameters: {} }))
    expect(result.action).toBe("cancel")
    expect(result.data.reason).toBe("blocked by test")
  })
})
```

- [ ] **Step 2: Run integration test**

Run: `bun --bun vitest run tests/hook/integration.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/hook/integration.test.ts
git commit -m "test: add hook system integration tests"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun --bun vitest run`
Expected: All 155+ tests PASS (including new hook tests)

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: No errors

- [ ] **Step 3: Verify reminder hook is bundled**

Run: `ls bundle/hooks/`
Expected: `reminder.ts` exists

- [ ] **Step 4: Commit final cleanup if needed**

```bash
git add -A
git commit -m "chore: final verification and cleanup for hook system"
```
