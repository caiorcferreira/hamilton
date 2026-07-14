# Fix Effect Language Service Build Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two `@effect/language-service` errors (`missingReturnYieldStar`) that cause `bun run build` to exit non-zero, breaking `install-local` and thus `hamilton setup`.

**Architecture:** Add `return` keyword before `yield*` on two lines where Effects with `never` success type are yielded without an explicit generator exit point. This is a correctness fix — these Effects never produce a value, so `return yield*` tells the type system (and humans) that the generator definitively exits at that point.

**Tech Stack:** TypeScript, Effect-TS, `@effect/language-service` 0.86.2

---

## File Map

| File | Change | Responsibility |
|------|--------|---------------|
| `src/cli/commands/logs.ts:157` | Add `return` before `yield* Effect.never` | Logs follow-mode infinite suspend |
| `src/workflow/loader.ts:134` | Add `return` before `yield* _(Effect.fail(...))` | Agent validation in workflow loading |

---

### Task 1: Fix `logs.ts` — add `return` to `yield* Effect.never`

**Files:**
- Modify: `src/cli/commands/logs.ts:157`
- Test: `tests/cli/logs.test.ts` (existing, verify no regression)

- [ ] **Step 1: Apply the fix**

In `src/cli/commands/logs.ts`, line 157, change:

```typescript
      yield* Effect.never
```

to:

```typescript
      return yield* Effect.never
```

The full context (lines 152–169) should read:

```typescript
export const logsCommand = Command.make("logs", { id: runIdArg, task: taskOpt, follow: followOpt }, ({ id, task, follow }) =>
  Effect.gen(function* () {
    if (follow) {
      const controller = followLogs({ runId: id })
      process.on("SIGINT", () => { controller.stop(); process.exit(0) })
      return yield* Effect.never
    }
    const result = yield* Effect.exit(
      getRunLogs({ runId: id, taskId: task._tag === "Some" ? task.value : undefined })
    )
    if (Exit.isFailure(result)) {
      yield* Console.error(`Logs not found: ${id}`)
      return
    }
    for (const event of result.value) {
      yield* Console.log(JSON.stringify(event))
    }
  })
)
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `bun --bun vitest run tests/cli/logs.test.ts`
Expected: All 4 tests pass.

---

### Task 2: Fix `loader.ts` — add `return` to `yield* _(Effect.fail(...))`

**Files:**
- Modify: `src/workflow/loader.ts:134`
- Test: `tests/workflow/loader.test.ts` (existing, verify no regression)

- [ ] **Step 1: Apply the fix**

In `src/workflow/loader.ts`, line 134, change:

```typescript
        yield* _(Effect.fail(new AgentNotFoundError({ taskName: task.name, executorRef: task.agent.executorRef })))
```

to:

```typescript
        return yield* _(Effect.fail(new AgentNotFoundError({ taskName: task.name, executorRef: task.agent.executorRef })))
```

The full context (lines 132–138) should read:

```typescript
    for (const task of walkTasks((spec as any).spec.tasks as any[])) {
      if (task.agent && !agentRegistry.has(task.agent.executorRef)) {
        return yield* _(Effect.fail(new AgentNotFoundError({ taskName: task.name, executorRef: task.agent.executorRef })))
      }
    }

    return { ...spec, hooks: (raw as any).spec?.hooks, agentRegistry } as unknown as WorkflowSpec
```

**Note:** Adding `return` here changes behavior subtly: previously the `for` loop would continue iterating (though at runtime `Effect.fail` would short-circuit anyway), now it explicitly exits the generator on the first unresolved agent. This matches the runtime behavior — `Effect.fail` immediately fails the Effect, so subsequent iterations never execute regardless. The `return` makes this explicit.

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `bun --bun vitest run tests/workflow/loader.test.ts`
Expected: All 8 tests pass (including the `AgentNotFoundError` test case).

---

### Task 3: Verify full build succeeds

- [ ] **Step 1: Run the build**

Run: `bun run build`
Expected: Exit code 0. The output will still show warnings and messages from the Effect plugin, but zero errors. The final line should NOT show "Found N errors".

- [ ] **Step 2: Run install-local**

Run: `bun run install-local`
Expected: Succeeds, `~/.local/bin/hamilton` symlink is created.

- [ ] **Step 3: Run full test suite**

Run: `bun --bun vitest run`
Expected: All 631+ tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/logs.ts src/workflow/loader.ts
git commit -m "fix: add return to yield* on never-succeeding Effects (fixes build)"
```
