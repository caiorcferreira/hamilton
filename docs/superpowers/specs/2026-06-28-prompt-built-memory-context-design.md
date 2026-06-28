# PromptBuilt: Remove guidelineFiles, Add memoryContext

Date: 2026-06-28

## Problem

The `PromptBuilt` event carries `guidelineFiles: ReadonlyArray<string>`, a vestigial field from the pre-memory era when guidelines were passed as static YAML files alongside the prompt. Since memory phase 1, all guidelines flow through the memory store — they're ingested as atoms, retrieved via hybrid search, rendered into a context string, and appended to the system prompt. The `guidelineFiles` field in `PromptBuilt` is always `[]` in the current code path.

Additionally, the rendered memory context injected into the system prompt is not visible in any event, making it impossible to observe which memories influenced a task's behavior.

## Design

### Remove `guidelineFiles` from the pipeline

The `guidelineFiles` concept was a union type hack in `buildAgentsPrompts`: when passed an array, it was treated as guideline files; when passed a string, it was treated as `memoryContext`. Since the only caller (`task-executor.ts`) always passes a string, the array path is dead code.

**Files changed:**

1. **`src/events/bus.ts`** — `PromptBuilt` event:
   - Remove `guidelineFiles: ReadonlyArray<string>`
   - Add `memoryContext: string`

2. **`src/prompts/types.ts`** — `ResolvablePrompt`:
   - Remove `guidelineFiles: Array<{ name: string; content: string }>`
   - Keep `memoryContext: string`

3. **`src/prompts/builder.ts`**:
   - `AgentPrompts`: remove `guidelineFiles`, keep `memoryContext`
   - `buildAgentsPrompts`: change 2nd param from `Array<{name, content}> | string = []` to `memoryContext: string = ""`. Drop the `typeof` switch; delegate `memoryContext` directly to the return value.

4. **`src/executors/pi/pi-executor.ts`**:
   - `PiExecutorConfig.prompt`: remove `guidelineFiles`
   - Destructure only `memoryContext` from config
   - Publish `memoryContext` in the `PromptBuilt` event (the full rendered string)
   - Drop the `guidelineFiles.map(g => g.name)` line

5. **`src/workflow/task-executor.ts`**:
   - Remove `guidelineFiles: agentPrompts.guidelineFiles` from the `executeWithPi` config

6. **`src/observability/subscribers.ts`** — `formatForFile`:
   - Remove `guideline_files` from the output
   - Add `memory_context` to the output

**Test files:**

| File | Change |
|---|---|
| `tests/prompts/builder.test.ts` | Drop the 2 `guidelineFiles` tests. Update `buildAgentsPrompts` calls to pass a string. |
| `tests/workflow/runner.test.ts` | Mock: replace `guidelineFiles` with `memoryContext` |
| `tests/workflow/runner-regression.test.ts` | Mock + assertions: replace `guidelineFiles` with `memoryContext` |
| `tests/workflow/runner-recursion.test.ts` | Mock: replace `guidelineFiles` with `memoryContext` |
| `tests/workflow/task-executor.test.ts` | All 4 mocks: replace `guidelineFiles: []` with `memoryContext: ""` |
| `tests/observability/subscribers.test.ts` | Test case: replace `guidelineFiles` with `memoryContext` |

**What does NOT change:** The memory retrieval pipeline itself (`runner.ts`, `memory/queries.ts`, `memory/context.ts`, `memory/guidelines.ts`). These are the producers of `memoryContext`; this change only affects how that value reaches the `PromptBuilt` event.

### No new events

The `memory_event_log` table already tracks atom lifecycle events (`ingested`, `demoted`, `tombstoned`). No new event type is needed for "injected" — the full rendered context is now observable via `PromptBuilt.memoryContext`.

### Data flow (after change)

```
runner.ts                       task-executor.ts               pi-executor.ts
─────────                       ────────────────               ──────────────
memoryReader.retrieveRelevant()                                
  → memoryAtoms                                              
buildMemoryContext(memoryAtoms)                              
  → memoryContext (string)                                    
                                 executeAgentTask(             
                                   ...memoryContext)             
                                   → buildAgentsPrompts(        
                                       ..., memoryContext)      
                                       → AgentPrompts          
                                         .memoryContext          
                                     → executeWithPi({           
                                         prompt: {                
                                           memoryContext          
                                         }                       
                                       })                        
                                                                const { memoryContext } = config.prompt
                                                                systemPrompt += "\n\n" + memoryContext
                                                                bus.publish({ _tag: "PromptBuilt", memoryContext })
```

## Verification

Run `bun run build` and `bun --bun vitest run` after implementation. No new behavior — the `PromptBuilt` event simply gains a `memoryContext` field that was previously discarded and loses a `guidelineFiles` field that was always empty.
