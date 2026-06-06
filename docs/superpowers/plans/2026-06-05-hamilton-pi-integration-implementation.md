# Pi SDK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `pi-executor.ts` with real Pi agent sessions using `@earendil-works/pi-coding-agent`, split agent prompts into system/task, and wire everything through the runner.

**Architecture:** Three-part change: (1) add `pi-coding-agent` + `pi-ai` dependencies, (2) refactor `buildAgentPrompt` to return `{ systemPrompt, taskPrompt }`, (3) rewrite `executeWithPi` to create real Pi sessions with `AuthStorage`/`ModelRegistry`/`DefaultResourceLoader`/`SessionManager.inMemory()`, extract output from `session.messages`, and stream events to JSONL.

**Tech Stack:** TypeScript 5.x (ESM, Node >=22), effect 3.21.3, @earendil-works/pi-coding-agent 0.78.1 (new), @earendil-works/pi-ai 0.78.1 (new), @earendil-works/pi-agent-core 0.78.1 (existing), vitest 4.1.8

---

## File Structure Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `pi-coding-agent`, `pi-ai` deps |
| `src/agent/activity.ts` | Modify | Split `buildAgentPrompt` → `{ systemPrompt, taskPrompt }` |
| `src/agent/pi-executor.ts` | Rewrite | Real Pi SDK integration |
| `src/workflow/runner.ts` | Modify | Pass split prompts to `executeWithPi` |
| `tests/agent/activity.test.ts` | Modify | Update assertions for `BuiltPrompt` shape |
| `tests/workflow/runner.test.ts` | Verify | Mock still works (vi.mock isolates pi-executor) |
| `tests/e2e/workflows.test.ts` | Verify | Mock still works |

---

### Task 1: Add Pi SDK Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install new dependencies**

```bash
npm install @earendil-works/pi-coding-agent@0.78.1 @earendil-works/pi-ai@0.78.1 --legacy-peer-deps
```

Expected: installs both packages and their transitive deps. Both are peer deps that resolve to 0.78.1 (same version as existing `pi-agent-core`).

- [ ] **Step 2: Verify existing deps are intact**

```bash
npm test
```

Expected: 117 tests pass (27 files). No regressions from new packages.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @earendil-works/pi-coding-agent and @earendil-works/pi-ai dependencies"
```

---

### Task 2: Split buildAgentPrompt into system + task

**Files:**
- Modify: `src/agent/activity.ts`
- Modify: `tests/agent/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Change `tests/agent/activity.test.ts`. The current tests assert `buildAgentPrompt` returns a string. Change them to assert it returns an object with `systemPrompt` and `taskPrompt`:

```typescript
import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import {
  buildAgentPrompt,
  parseAgentOutput,
  extractContextFromOutput,
  PromptParams
} from "../../src/agent/activity.js"

describe("buildAgentPrompt", () => {
  const baseParams: PromptParams = {
    agentsMd: "You are a coder.",
    identityMd: "",
    soulMd: "",
    stepInput: "Fix the bug",
    context: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      agentsMd: "You are a coder.",
      identityMd: "Senior Developer",
      soulMd: "Concise and direct",
      stepInput: "Fix the bug",
      context: {}
    }
    const result = buildAgentPrompt(params)
    expect(result).toHaveProperty("systemPrompt")
    expect(result).toHaveProperty("taskPrompt")
    expect(result.systemPrompt).toContain("Your role: Senior Developer")
    expect(result.systemPrompt).toContain("Your style: Concise and direct")
    expect(result.systemPrompt).toContain("You are a coder.")
    expect(result.taskPrompt).toContain("Fix the bug")
    expect(result.taskPrompt).toContain("When complete, respond with a JSON object containing your results.")
  })

  it("resolves template expressions in the task prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      stepInput: "Fix bug in {{repo}}",
      context: { repo: "hamilton" }
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("includes context entries in the system prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      context: { branch: "main", status: "approved" }
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("Context from previous steps:")
    expect(result.systemPrompt).toContain("branch: main")
    expect(result.systemPrompt).toContain("status: approved")
  })

  it("omits role and style sections when empty", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).not.toContain("Your role:")
    expect(result.systemPrompt).not.toContain("Your style:")
    expect(result.taskPrompt).toContain("Fix the bug")
  })
})

describe("parseAgentOutput", () => {
  it("parses JSON from code fences", async () => {
    const output = 'Some text\n```json\n{"status": "done"}\n```\nMore text'
    const exit = await Effect.runPromiseExit(parseAgentOutput(output))
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ status: "done" })
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("parses raw JSON", async () => {
    const output = '{"status": "done", "count": 5}'
    const exit = await Effect.runPromiseExit(parseAgentOutput(output))
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ status: "done", count: 5 })
    } else {
      expect.unreachable("Expected success")
    }
  })

  it("fails on invalid JSON", async () => {
    const output = "not json at all"
    const exit = await Effect.runPromiseExit(parseAgentOutput(output))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails on empty string", async () => {
    const exit = await Effect.runPromiseExit(parseAgentOutput(""))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("extractContextFromOutput", () => {
  it("extracts only string-valued entries", () => {
    const output = { status: "done", repo: "hamilton", count: 42, items: [1, 2] }
    const result = extractContextFromOutput(output)
    expect(result).toEqual({ status: "done", repo: "hamilton" })
  })

  it("returns empty object for no string values", () => {
    const output = { count: 1, flag: true }
    const result = extractContextFromOutput(output)
    expect(result).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent/activity.test.ts
```

Expected: FAIL — `result.toHaveProperty("systemPrompt")` fails because `result` is still a string.

- [ ] **Step 3: Modify src/agent/activity.ts**

Add the `BuiltPrompt` interface and change `buildAgentPrompt` to return it:

```typescript
import { Data, Effect } from "effect"
import { resolveTemplate } from "../workflow/context.js"

export interface PromptParams {
  agentsMd: string
  identityMd: string
  soulMd: string
  stepInput: string
  context: Record<string, string>
}

export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
}

export class AgentOutputParseError extends Data.TaggedError("AgentOutputParseError")<{
  message: string
}> {}

export function buildAgentPrompt(params: PromptParams): BuiltPrompt {
  const systemParts: string[] = []

  if (params.identityMd) {
    systemParts.push(`Your role: ${params.identityMd}`)
  }

  if (params.soulMd) {
    systemParts.push(`Your style: ${params.soulMd}`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextLines = Object.entries(params.context)
      .map(([key, value]) => `  ${key}: ${value}`)
      .join("\n")
    systemParts.push(`Context from previous steps:\n${contextLines}`)
  }

  systemParts.push(params.agentsMd)

  const resolvedInput = resolveTemplate(params.stepInput, params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: `${resolvedInput}\n\nWhen complete, respond with a JSON object containing your results.`
  }
}

export function parseAgentOutput(
  output: string
): Effect.Effect<Record<string, unknown>, AgentOutputParseError> {
  return Effect.try({
    try: () => {
      const trimmed = output.trim()
      if (!trimmed) throw new Error("Empty output")

      const fenceMatch = trimmed.match(/```json\s*\n([\s\S]*?)\n```/)
      if (fenceMatch) {
        return JSON.parse(fenceMatch[1])
      }

      return JSON.parse(trimmed)
    },
    catch: (e) => new AgentOutputParseError({
      message: `Failed to parse agent output: ${e instanceof Error ? e.message : String(e)}`
    })
  })
}

export function extractContextFromOutput(
  output: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(output)) {
    if (typeof value === "string") {
      result[key] = value
    }
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/agent/activity.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/activity.ts tests/agent/activity.test.ts
git commit -m "feat: split buildAgentPrompt into systemPrompt and taskPrompt"
```

---

### Task 3: Rewrite pi-executor.ts with Real Pi SDK

**Files:**
- Modify: `src/agent/pi-executor.ts`
- Test: No new test file (covered by runner.test.ts + e2e via mocks; the real implementation requires a running Pi with API key)

- [ ] **Step 1: Overwrite src/agent/pi-executor.ts**

```typescript
import { Effect, Data } from "effect"
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { getModel } from "@earendil-works/pi-ai"
import { subscribePiEvents } from "../observability/streaming.js"
import { appendStepLog } from "../observability/run-dir.js"
import { parseAgentOutput } from "../agent/activity.js"

export interface PiExecutorConfig {
  systemPrompt: string
  taskPrompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  extensions?: Array<(pi: unknown) => void>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[]
  }
  cwd?: string
}

export class PiExecutionError extends Data.TaggedError("PiExecutionError")<{
  stepId: string
  message: string
}> {}

function parseModelString(model?: string): [string, string] {
  if (!model) return ["anthropic", "claude-sonnet-4-20250514"]
  const parts = model.split("/")
  return [parts[0], parts[1]]
}

function mapThinkingLevel(level?: string): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  const valid = new Set(["off", "minimal", "low", "medium", "high", "xhigh"])
  return valid.has(level ?? "") ? (level as any) : "off"
}

function extractTextContent(msg: any): string {
  if (!msg) return ""
  if (typeof msg.content === "string") return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
  }
  return ""
}

export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError> {
  return Effect.gen(function* () {
    const authStorage = AuthStorage.create()
    const modelRegistry = ModelRegistry.create(authStorage)
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false }
    })

    const [provider, modelId] = parseModelString(config.model)
    const model = getModel(provider, modelId)

    const loader = new DefaultResourceLoader({
      cwd: config.cwd ?? process.cwd(),
      systemPromptOverride: () => config.systemPrompt,
      extensionFactories: config.extensions ?? [],
      settingsManager,
    })

    yield* Effect.promise(() => loader.reload())

    const { session } = yield* Effect.promise(() =>
      createAgentSession({
        model: model ?? undefined,
        thinkingLevel: mapThinkingLevel(config.settings?.thinking),
        tools: config.settings?.tools ?? ["read", "bash", "edit", "write"],
        authStorage,
        modelRegistry,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
        settingsManager,
      })
    )

    const eventHandler = subscribePiEvents({
      runId: config.runId,
      stepId: config.stepId,
      onLog: (event) => appendStepLog(config.runId, config.stepId, event),
      onTokenEvent: () => Effect.void
    })

    const unsubscribe = session.subscribe((event: any) => {
      Effect.runPromise(eventHandler(event as any)).catch(() => {})
    })

    try {
      yield* Effect.promise(() => session.prompt(config.taskPrompt))

      const assistantMsgs = (session.messages as Array<{ role: string; content: unknown }>)
        .filter((m: any) => m.role === "assistant")
      const lastMsg = assistantMsgs[assistantMsgs.length - 1]
      const text = extractTextContent(lastMsg)

      const output = yield* parseAgentOutput(text).pipe(
        Effect.mapError((e) => new PiExecutionError({
          stepId: config.stepId,
          message: e.message
        }))
      )

      return output
    } finally {
      unsubscribe()
      session.dispose()
    }
  })
}
```

- [ ] **Step 2: Verify imports resolve**

```bash
npx tsc --noEmit
```

Expected: no type errors from the new imports. (`pi-coding-agent` and `pi-ai` must be installed; done in Task 1.)

- [ ] **Step 3: Run all tests to verify mocks still work**

```bash
npm test
```

Expected: all existing tests pass (117 tests). The `vi.mock` in `runner.test.ts` and `e2e/workflows.test.ts` replace `pi-executor` before it's imported, so the real implementation is never executed in tests.

- [ ] **Step 4: Commit**

```bash
git add src/agent/pi-executor.ts
git commit -m "feat: implement real Pi SDK integration in pi-executor"
```

---

### Task 4: Update Runner to Pass Split Prompts

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Verify tests still pass with split prompts**

The runner currently builds a single `prompt` variable and passes it to `executeWithPi`. We need to change it to build a `BuiltPrompt` and pass `systemPrompt` + `taskPrompt`:

Read the current code at `src/workflow/runner.ts:104-131`:

```typescript
const prompt = buildAgentPrompt({
  agentsMd: persona.agents,
  identityMd: persona.identity,
  soulMd: persona.soul,
  stepInput: step.input,
  context: runningContext
})

yield* appendStepLog(runId, stepId, { event: "prompt_built" })

const rtkExtension = createRtkExtension({
  model: model ?? agentSettings.model,
  disabled: process.env.RTK_DISABLED === "1"
})

const output = yield* executeWithPi({
  prompt,
  stepId,
  agentId: agent.id,
  runId,
  timeoutSeconds: timeoutSeconds,
  model,
  extensions: [rtkExtension],
  settings: {
    thinking: agentSettings.thinking,
    tools: agentSettings.tools,
    skills: agentSettings.skills
  }
})
```

Replace with:

```typescript
const built = buildAgentPrompt({
  agentsMd: persona.agents,
  identityMd: persona.identity,
  soulMd: persona.soul,
  stepInput: step.input,
  context: runningContext
})

yield* appendStepLog(runId, stepId, { event: "prompt_built" })

const rtkExtension = createRtkExtension({
  model: model ?? agentSettings.model,
  disabled: process.env.RTK_DISABLED === "1"
})

const output = yield* executeWithPi({
  systemPrompt: built.systemPrompt,
  taskPrompt: built.taskPrompt,
  stepId,
  agentId: agent.id,
  runId,
  timeoutSeconds: timeoutSeconds,
  model,
  extensions: [rtkExtension],
  settings: {
    thinking: agentSettings.thinking,
    tools: agentSettings.tools,
    skills: agentSettings.skills
  }
})
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: PASS (117 tests). The mocks in runner.test.ts and e2e don't inspect the prompt fields — they just match by `stepId` — so they continue working.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "feat: pass split systemPrompt and taskPrompt to Pi executor"
```

---

### Task 5: Run Full Test Suite + Build Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: 117 tests pass (27 files), 0 failures.

- [ ] **Step 2: Run TypeScript build**

```bash
npm run build
```

Expected: builds without errors.

- [ ] **Step 3: Verify CLI help still works**

```bash
node dist/cli/main.js
```

Expected: prints Hamilton help text with all commands.

---

## Self-Review

**1. Spec coverage:**
- Add `pi-coding-agent` + `pi-ai` deps → Task 1 ✓
- Split `buildAgentPrompt` → Task 2 ✓
- Rewrite `pi-executor.ts` with real SDK → Task 3 ✓
- Update `runner.ts` for split prompts → Task 4 ✓
- Update tests → Task 2 (activity test), Tasks 3-4 (runner + e2e mocks verified) ✓
- Build verification → Task 5 ✓

**2. Placeholder scan:** No TBD, TODO, or "implement later" patterns. All code is fully specified.

**3. Type consistency:**
- `BuiltPrompt` defined in Task 2, used in Task 4 — consistent
- `PiExecutorConfig.systemPrompt` and `taskPrompt` defined in Task 3, used in Task 4 — consistent
- `parseModelString` and `mapThinkingLevel` and `extractTextContent` — all used within Task 3, no cross-task references

**Note:** The mocks in `runner.test.ts` and `e2e/workflows.test.ts` use `vi.mock` to replace the entire `pi-executor` module before it's imported. This means the real `executeWithPi` is never called in tests. The mock's `vi.fn` doesn't inspect which fields are passed (`systemPrompt` vs `prompt`), so the rename from `prompt` to `systemPrompt` + `taskPrompt` is transparent to existing tests — they pass as long as the mock returns `Effect.succeed({ status: "done" })`.
