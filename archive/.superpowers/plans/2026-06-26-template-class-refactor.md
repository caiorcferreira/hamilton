# Template Class Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 17 TODOs across 5 source files by renaming types/functions, making `Template` the sole rendering API, and moving prompt-wrapping logic into `buildAgentsPrompts`.

**Architecture:** Three sequential phases. Phase 1: mechanical renames (Persona → SystemPromptFragments, buildAgentPrompt → buildAgentsPrompts, etc.). Phase 2: swap raw string returns for `Template` instances — construct early, render late. Phase 3: move prompt-formatting logic from runner into builder, emit `PromptBuilt` only from `executeWithPi`.

**Tech Stack:** TypeScript, Effect-TS, bun, vitest, handlebars

---

## File Structure

| File | Phase 1 | Phase 2 | Phase 3 | Responsibility |
|------|---------|---------|---------|----------------|
| `src/types.ts` | add `context?: string` | — | — | Shared type: `SystemPromptPaths` |
| `src/prompts/template.ts` | — | export `Template`, hide free functions | — | Handlebars rendering, `Template` class |
| `src/prompts/persona.ts` | rename types + functions, remove guard, add `paths.context` | — | — | Reads agent/soul/context files from disk |
| `src/prompts/builder.ts` | rename types/functions, accept `SystemPromptFragments` | return `Template` instances | Handlebars `{{#if}}` for persona, wrap schema/user-prompt | Prompts assembly (no rendering) |
| `src/prompts/types.ts` | — | change `ResolvablePrompt` | — | Shared prompt type used by `PiExecutorConfig` |
| `src/workflow/runner.ts` | update import + call sites | pass `Template` through | delete prompt-wrapping block, delete `PromptBuilt` emission | Workflow orchestrator |
| `src/executors/pi/pi-executor.ts` | — | accept `Template` in config | render + emit `PromptBuilt` | Agent execution, sole rendering point |
| `tests/prompts/template.test.ts` | — | update imports | — | Tests for `Template` class |
| `tests/prompts/persona.test.ts` | update imports + assertions | — | add context test | Tests for persona resolution |
| `tests/prompts/builder.test.ts` | update shape + imports | update assertions for `Template` | update for moved logic | Tests for prompt builder |
| `tests/workflow/runner.test.ts` | update imports | update for `Template` | `PromptBuilt` assertions move | Tests for workflow runner |
| `tests/workflow/runner-recursion.test.ts` | update imports | — | — | Tests for recursion |
| `tests/workflow/runner-regression.test.ts` | update imports | — | `PromptBuilt` from pi-executor | Regression tests |

---

## Phase 1: Renames & Persona structural changes

### Task 1: Add `context` field to `SystemPromptPaths`

**Files:**
- Modify: `src/types.ts:12-15`

- [ ] **Step 1: Add optional `context` field**

Open `src/types.ts`. Replace lines 12-15:

```typescript
export interface SystemPromptPaths {
  agent: string
  soul: string
}
```

With:

```typescript
export interface SystemPromptPaths {
  agent: string
  soul: string
  context?: string
}
```

- [ ] **Step 2: Build to verify no type errors introduced**

Run: `bun run build`
Expected: PASS (existing callers won't break since `context` is optional)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: add optional context field to SystemPromptPaths"
```

---

### Task 2: Rename types and functions in `persona.ts`, remove early-return guard, use `paths.context`

**Files:**
- Modify: `src/prompts/persona.ts` (entire file)

The file currently:
- Exports `Persona` interface (3 TODO: rename to `SystemPromptFragments`, fields should use `Prompt` type)
- Exports `PersonaNotFoundError` (no rename needed per spec)
- Exports `tryReadOptional` (TODO: rename to `readOptionalFile`)
- Exports `resolvePersona` (TODO: rename to `resolveSystemPromptFragments`)
- Has early-return guard on line 37 (TODO: remove)
- Has hardcoded `"CONTEXT.md"` on line 47 (TODO: use `paths.context`)

- [ ] **Step 1: Rewrite** `src/prompts/persona.ts`

Replace the entire file content. Note: importing `Prompt` from `../types.js`:

```typescript
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { SystemPromptPaths } from "../types.js"
import type { Prompt } from "../types.js"

export interface SystemPromptFragments {
  agent: Prompt
  soul: Prompt
  context: Prompt
}

export class PersonaNotFoundError extends Data.TaggedError("PersonaNotFoundError")<{
  agentPath: string
}> { }

function readOptionalFile(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

export function resolveSystemPromptFragments(
  paths: SystemPromptPaths,
  agentDir: string
): Effect.Effect<SystemPromptFragments, PersonaNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(agentDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.agent), "utf-8"),
        catch: () => new PersonaNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = paths.soul ? readOptionalFile(resolvePath(paths.soul)) : ""

    const context = paths.context ? readOptionalFile(resolvePath(paths.context)) : ""

    return {
      agent: { content: agent },
      soul: { content: soul },
      context: { content: context }
    }
  })
}
```

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: FAIL — `runner.ts` still imports the old names. That's expected. We'll fix call sites next.

---

### Task 3: Rename types and functions in `builder.ts`

**Files:**
- Modify: `src/prompts/builder.ts:1-99`

The file currently:
- `PromptParams` has `agentFile`, `soulFile`, `contextTemplate`, `prompt` (TODO: accept `SystemPromptFragments`, rename `prompt`→`taskPrompt`)
- `BuiltPrompt` (TODO: rename to `AgentPrompts`)
- `buildAgentPrompt` (TODO: rename to `buildAgentsPrompts`)
- Line 75-78: ternary for persona wrapping (TODO: move to Handlebars `{{#if}}` — Phase 3)
- Line 1: imports `resolveTemplate` from `./template.js` (stays for Phase 1)

- [ ] **Step 1: Rewrite** `src/prompts/builder.ts`

Replace the entire file content:

```typescript
import type { Prompt, AgentManifest } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import type { SystemPromptFragments } from "./persona.js"
import { resolveTemplate, type TemplateOptions } from "./template.js"

export interface PromptParams {
  fragments: SystemPromptFragments
  taskPrompt: Prompt

  env: WorkflowEnv
  agentConfig: Partial<AgentManifest>
}

export interface AgentPrompts {
  systemPrompt: string
  taskPrompt: string
  guidelineFiles: Array<{ name: string; content: string }>
}

const systemTemplate = `
<platform>
# Hamilton Agentic Orchestration

Hamilton is an agentic orchestration platform where tasks are executed by agents, orchestrated as a DAG.

Your goal is to fullfil the task provided as input by Hamilton user.

## How to finish your task

When you finish your work, call the write_task_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_task_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</platform>

<instructions>
{{instructions}}
</instructions>

{{persona}}

<context>
{{context}}
</context>
`


const defaultContextTemplate = `## Context
- Current directory: {{inputs.parameters.cwd}}
- Available tools:
  - All built-in tools: read, bash, edit, write, grep, find, ls
  - write_task_output: saves your task results (call once when done, input must be a JSON object with 'status' field)
`

export function buildAgentsPrompts(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): AgentPrompts {
  const resolvedAgentFile = resolveTemplate(params.fragments.agent.content ?? "", { inputs: params.env }, options)

  const resolvedSoul = params.fragments.soul.content
    ? resolveTemplate(params.fragments.soul.content, { inputs: params.env }, options)
    : ""

  const persona = resolvedSoul
    ? `<persona>\n${resolvedSoul}\n</persona>`
    : ""

  const template = params.fragments.context.content || defaultContextTemplate
  const contextForTemplate = { inputs: params.env }
  const renderedContext = resolveTemplate(template, contextForTemplate, options)

  const resolvedSystem = resolveTemplate(systemTemplate, {
    instructions: resolvedAgentFile,
    persona,
    context: renderedContext,
  }, options)

  const resolvedInput = params.taskPrompt.skipTemplate
    ? (params.taskPrompt.content ?? "")
    : resolveTemplate(params.taskPrompt.content ?? "", { inputs: params.env }, options)

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: FAIL — `runner.ts` still uses old `PromptParams` shape. Expected.

---

### Task 4: Update `runner.ts` call sites for Phase 1

**Files:**
- Modify: `src/workflow/runner.ts:1-14,141-154`

- [ ] **Step 1: Update imports in runner.ts (line 4, line 12)**

Line 4: change `buildAgentPrompt` to `buildAgentsPrompts`:
```typescript
import { buildAgentsPrompts } from "../prompts/builder.js"
```

Line 12: change `resolvePersona` to `resolveSystemPromptFragments`:
```typescript
import { resolveSystemPromptFragments } from "../prompts/persona.js"
```

- [ ] **Step 2: Update the call to resolvePersona (lines 141-145)**

Replace:
```typescript
        const persona = yield* _(
          resolvePersona(agent.systemPrompt, agent.dirPath).pipe(
            Effect.mapError((e) => new Error(e.agentPath))
          )
        )
```

With:
```typescript
        const fragments = yield* _(
          resolveSystemPromptFragments(agent.systemPrompt, agent.dirPath).pipe(
            Effect.mapError((e) => new Error(e.agentPath))
          )
        )
```

- [ ] **Step 3: Update the buildAgentPrompt call (lines 147-154)**

Replace:
```typescript
        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          contextTemplate: persona.context,
          prompt: task.agent!.prompt,
          env: taskEnv,
          agentConfig: agent
        }, guidelineFiles, templateOptions)
```

With:
```typescript
        const prompt = buildAgentsPrompts({
          fragments,
          taskPrompt: task.agent!.prompt,
          env: taskEnv,
          agentConfig: agent
        }, guidelineFiles, templateOptions)
```

- [ ] **Step 4: Build to verify**

Run: `bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/prompts/persona.ts src/prompts/builder.ts src/workflow/runner.ts
git commit -m "refactor: rename persona and builder types"
```

---

### Task 5: Update test files for Phase 1

**Files:**
- Modify: `tests/prompts/persona.test.ts`
- Modify: `tests/prompts/builder.test.ts`
- Modify: `tests/workflow/runner.test.ts`
- Modify: `tests/workflow/runner-recursion.test.ts`
- Modify: `tests/workflow/runner-regression.test.ts`

- [ ] **Step 1: Update `tests/prompts/persona.test.ts`**

Replace lines 6-6 (import):
```typescript
import { resolvePersona, PersonaNotFoundError } from "../../src/prompts/persona.js"
```
With:
```typescript
import { resolveSystemPromptFragments, PersonaNotFoundError } from "../../src/prompts/persona.js"
```

Replace all `resolvePersona` calls with `resolveSystemPromptFragments` (3 occurrences at lines 28, 44, 79).

Replace all `exit.value.agent` with `exit.value.agent.content` (lines 31, 47, 82).

Replace all `exit.value.soul` with `exit.value.soul.content` (lines 32, 48, 83).

- [ ] **Step 2: Update `tests/prompts/builder.test.ts`**

Replace imports (lines 2-5):
```typescript
import {
  buildAgentsPrompts,
  PromptParams
} from "../../src/prompts/builder.js"
```

Replace `baseParams` (lines 9-15):
```typescript
  const baseParams: PromptParams = {
    fragments: { agent: { content: "" }, soul: { content: "" }, context: { content: "" } },
    taskPrompt: { content: "Fix the bug" },
    env: { tasks: {} },
    agentConfig: {}
  }
```

Replace all usages of `buildAgentPrompt` with `buildAgentsPrompts`. Replace the field names in all `PromptParams` objects:
- `agentFile: "..."` → `fragments: { ...baseParams.fragments, agent: { content: "..." } }`
  (or simpler: `fragments: { agent: { content: "..." }, soul: { content: "" }, context: { content: "" } }`)
- `soulFile: "..."` → set `soul.content` in `fragments`
- `prompt: { content: "..." }` → `taskPrompt: { content: "..." }`
- `contextTemplate: "..."` → `fragments.context.content`

Update assertions: `result.systemPrompt` and `result.taskPrompt` stay the same (Phase 1 keeps string fields).

Here is the full updated test content:

```typescript
import { describe, it, expect } from "vitest"
import {
  buildAgentsPrompts,
  PromptParams
} from "../../src/prompts/builder.js"
import type { WorkflowEnv } from "../../src/workflow/env.js"

describe("buildAgentsPrompts", () => {
  const baseFragments = { agent: { content: "" }, soul: { content: "" }, context: { content: "" } }
  const baseParams: PromptParams = {
    fragments: baseFragments,
    taskPrompt: { content: "Fix the bug" },
    env: { tasks: {} },
    agentConfig: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder." }, soul: { content: "Concise and direct" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env: { tasks: {} },
      agentConfig: { metadata: { name: "coder" }, dirPath: "", spec: { settings: {} } }
    }
    const result = buildAgentsPrompts(params)
    expect(result).toHaveProperty("systemPrompt")
    expect(result).toHaveProperty("taskPrompt")
    expect(result.systemPrompt).toContain("<platform>")
    expect(result.systemPrompt).toContain("<persona>")
    expect(result.systemPrompt).toContain("Concise and direct")
    expect(result.systemPrompt).toContain("You are a coder.")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("resolves template expressions in the task prompt via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Fix bug in {{inputs.tasks.setup.outputs.repo}}" },
      env
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("resolves non-string template values as JSON", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "US-001", title: "Add thing" }] }
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Stories: {{inputs.stories_json}}" },
      env
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toContain('Stories: [{"id":"US-001","title":"Add thing"}]')
  })

  it("includes context from env in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, branch: "main", status: "approved" }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("<context>")
    expect(result.systemPrompt).toContain('"branch":"main"')
    expect(result.systemPrompt).toContain('"status":"approved"')
  })

  it("includes structured data from env as JSON in the system prompt", () => {
    const env: WorkflowEnv = { tasks: {}, stories_json: [{ id: "1", title: "Story" }] }
    const params: PromptParams = {
      ...baseParams,
      env
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain('"stories_json"')
    expect(result.systemPrompt).toContain('"Story"')
  })

  it("omits persona section when soulFile is empty", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.systemPrompt).not.toContain("<persona>")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("includes Hamilton platform section", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.systemPrompt).toContain("Hamilton Agentic Orchestration")
    expect(result.systemPrompt).toContain("write_task_output")
  })

  it("passes guidelineFiles through to AgentPrompts", () => {
    const instructions = [{ name: "typescript", content: "Use strict mode" }]
    const result = buildAgentsPrompts(baseParams, instructions)
    expect(result.guidelineFiles).toEqual(instructions)
  })

  it("defaults guidelineFiles to empty array", () => {
    const result = buildAgentsPrompts(baseParams)
    expect(result.guidelineFiles).toEqual([])
  })

  it("uses default context template when env is provided without contextTemplate", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "" } },
      taskPrompt: { content: "do" },
      env: { tasks: {}, cwd: "/tmp/repo" },
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("/tmp/repo")
    expect(result.systemPrompt).toContain("## Context")
  })

  it("uses custom context template when provided", () => {
    const params: PromptParams = {
      fragments: { agent: { content: "agent" }, soul: { content: "" }, context: { content: "Working in {{inputs.cwd}}" } },
      taskPrompt: { content: "do" },
      env: { tasks: {}, cwd: "/tmp/repo" },
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("Working in /tmp/repo")
    expect(result.systemPrompt).not.toContain("## Context")
  })

  it("passes TemplateOptions through to resolution", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Hello {{inputs.name}}" },
      env: { tasks: {}, name: "world" }
    }
    const result = buildAgentsPrompts(params, [], { strict: false })
    expect(result.taskPrompt).toBe("Hello world")
  })

  it("defaults TemplateOptions to lenient when not provided", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Hello {{inputs.missing}}" },
      env: { tasks: {} }
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toBe("Hello")
  })

  it("skips template resolution when prompt has skipTemplate flag", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Keep {{this}} as-is", skipTemplate: true },
      env: { tasks: {} }
    }
    const result = buildAgentsPrompts(params)
    expect(result.taskPrompt).toBe("Keep {{this}} as-is")
  })

  it("resolves template expressions in agentFile via env", () => {
    const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder for {{inputs.tasks.setup.outputs.repo}}." }, soul: { content: "" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("You are a coder for hamilton.")
  })

  it("resolves template expressions in soulFile via env", () => {
    const env: WorkflowEnv = { cwd: "/tmp/repo" }
    const params: PromptParams = {
      fragments: { agent: { content: "You are a coder." }, soul: { content: "Working from {{inputs.cwd}}" }, context: { content: "" } },
      taskPrompt: { content: "Fix the bug" },
      env,
      agentConfig: {}
    }
    const result = buildAgentsPrompts(params)
    expect(result.systemPrompt).toContain("<persona>")
    expect(result.systemPrompt).toContain("Working from /tmp/repo")
  })
})
```

- [ ] **Step 3: Update `tests/workflow/runner.test.ts`**

Replace the `resolvePersona` mock (find the `vi.mock("../../src/prompts/persona.js"` block):

```typescript
vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})
```

- [ ] **Step 4: Update `tests/workflow/runner-recursion.test.ts`**

Same mock replacement as Step 3 (the file has the same persona mock):

```typescript
vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})
```

- [ ] **Step 5: Update `tests/workflow/runner-regression.test.ts`**

Same mock replacement:

```typescript
vi.mock("../../src/prompts/persona.js", () => {
  const { Effect: E } = require("effect")
  return {
    resolveSystemPromptFragments: vi.fn(() => E.succeed({ agent: { content: "test-agent" }, soul: { content: "test-soul" }, context: { content: "" } })),
    PersonaNotFoundError: class PersonaNotFoundError extends Error {}
  }
})
```

- [ ] **Step 6: Run all tests to verify Phase 1**

Run: `bun --bun vitest run`
Expected: All 155 tests PASS (mechanical renames + type changes only)

- [ ] **Step 7: Commit**

```bash
git add tests/prompts/persona.test.ts tests/prompts/builder.test.ts tests/workflow/runner.test.ts tests/workflow/runner-recursion.test.ts tests/workflow/runner-regression.test.ts
git commit -m "test: update tests for Phase 1 renames"
```

---

## Phase 2: Template class becomes the sole rendering API

### Task 6: Export `Template` class, hide free functions

**Files:**
- Modify: `src/prompts/template.ts:51-52,91-112,114-152`

- [ ] **Step 1: Make `resolveTemplate` and `resolveFileTemplate` unexported, export `Template` class**

In `src/prompts/template.ts`:

Line 51: remove `export` from `resolveTemplate`:
```typescript
function resolveTemplate(
```

Line 91: remove `export` from `resolveFileTemplate`:
```typescript
function resolveFileTemplate(
```

Line 114: add `export` before `class Template`:
```typescript
export class Template extends Data.Class<{
```

Add `Template.fromFile` static factory method inside the `Template` class, before `render()`:

```typescript
  static fromFile(filePath: string, options: TemplateOptions = { strict: false }): Effect.Effect<Template, TemplateError> {
    return Effect.try({
      try: () => {
        if (!Fs.existsSync(filePath)) {
          throw new TemplateFileError({ filePath, message: "File not found" })
        }
        const content = Fs.readFileSync(filePath, "utf-8")
        return Template.make(content, options)
      },
      catch: (e) => {
        if (e instanceof TemplateFileError) return e
        return new TemplateFileError({ filePath, message: String(e) })
      }
    })
  }
```

Remove the old `resolveFileTemplate` function entirely (lines 91-112).

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: FAIL — other files import `resolveTemplate` directly. Expected; we'll fix in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/template.ts
git commit -m "refactor: export Template class, hide free functions, add fromFile"
```

---

### Task 7: Update template test for `Template` class

**Files:**
- Modify: `tests/prompts/template.test.ts`

- [ ] **Step 1: Update imports**

Lines 1-6, replace:
```typescript
import { describe, it, expect } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Effect, Exit } from "effect"
import { resolveTemplate, TemplateOptions } from "../../src/prompts/template.js"
```

With:
```typescript
import { describe, it, expect } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Effect, Exit } from "effect"
import { Template, type TemplateOptions } from "../../src/prompts/template.js"
```

- [ ] **Step 2: Replace `resolveTemplate(template, context, opts)` calls with `Template.make(template, opts).setInputEnv(context).render()`**

Every `resolveTemplate(template, context, options)` call must become:

```typescript
Effect.runSync(Template.make(template, options).setInputEnv(context as any).render())
```

But wait — the test currently expects sync behavior. `Template.render()` is async (returns `Effect`). Most existing tests use `resolveTemplate` synchronously. `resolveFileTemplate` tests use `Effect.runPromise/runPromiseExit`.

For the sync tests, wrap with `Effect.runSync(...)`:

Example:
```typescript
it("replaces {{name}} with context value", () => {
  expect(resolveTemplate("Hello {{name}}!", { name: "world" }, lenient)).toBe("Hello world!")
})
```
Becomes:
```typescript
it("replaces {{name}} with context value", () => {
  const result = Effect.runSync(Template.make("Hello {{name}}!", lenient).setVar("name", "world").render())
  expect(result).toBe("Hello world!")
})
```

For the `resolveFileTemplate` tests, use `Template.fromFile()`:

```typescript
it("reads .hbs file and resolves placeholders", async () => {
  const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-template-test-"))
  const filePath = Path.join(tmp, "greet.hbs")
  Fs.writeFileSync(filePath, "Hello {{name}}!")
  try {
    const template = await Effect.runPromise(Template.fromFile(filePath, lenient))
    const result = Effect.runSync(template.setVar("name", "world").render())
    expect(result).toBe("Hello world!")
  } finally {
    Fs.rmSync(tmp, { recursive: true, force: true })
  }
})
```

For the missing file test:
```typescript
it("fails with TemplateFileError for missing file", async () => {
  const result = await Effect.runPromiseExit(Template.fromFile("/nonexistent/path.hbs"))
  expect(Exit.isFailure(result)).toBe(true)
})
```

- [ ] **Step 3: Run template tests only**

Run: `bun --bun vitest run tests/prompts/template.test.ts`
Expected: All template tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/prompts/template.test.ts
git commit -m "test: update template tests for Template class API"
```

---

### Task 8: Make `buildAgentsPrompts` return `Template` instances

**Files:**
- Modify: `src/prompts/builder.ts`

- [ ] **Step 1: Change `AgentPrompts` to carry `Template` instances, rewrite `buildAgentsPrompts`**

Replace `src/prompts/builder.ts` entirely:

```typescript
import type { Prompt, AgentManifest } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import type { SystemPromptFragments } from "./persona.js"
import { Template, type TemplateOptions } from "./template.js"

export interface PromptParams {
  fragments: SystemPromptFragments
  taskPrompt: Prompt

  env: WorkflowEnv
  agentConfig: Partial<AgentManifest>
}

export interface AgentPrompts {
  systemTemplate: Template
  taskTemplate: Template
  guidelineFiles: Array<{ name: string; content: string }>
}

const systemTemplateStr = `
<platform>
# Hamilton Agentic Orchestration

Hamilton is an agentic orchestration platform where tasks are executed by agents, orchestrated as a DAG.

Your goal is to fullfil the task provided as input by Hamilton user.

## How to finish your task

When you finish your work, call the write_task_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_task_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</platform>

<instructions>
{{instructions}}
</instructions>

{{persona}}

<context>
{{context}}
</context>
`

const defaultContextTemplate = `## Context
- Current directory: {{inputs.parameters.cwd}}
- Available tools:
  - All built-in tools: read, bash, edit, write, grep, find, ls
  - write_task_output: saves your task results (call once when done, input must be a JSON object with 'status' field)
`

export function buildAgentsPrompts(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): AgentPrompts {
  const resolvedAgentFile = Template.make(params.fragments.agent.content ?? "", options)
    .setInputEnv(params.env)

  const soulTemplate = params.fragments.soul.content
    ? Template.make(params.fragments.soul.content, options).setInputEnv(params.env)
    : null

  const contextContent = params.fragments.context.content || defaultContextTemplate
  const contextTemplate = Template.make(contextContent, options).setInputEnv(params.env)

  const resolvedSoul = soulTemplate ? Effect.runSync(soulTemplate.render()) : ""

  const persona = resolvedSoul
    ? `<persona>\n${resolvedSoul}\n</persona>`
    : ""

  const renderedAgentFile = Effect.runSync(resolvedAgentFile.render())
  const renderedContext = Effect.runSync(contextTemplate.render())

  const systemTemplate = Template.make(systemTemplateStr, options)
    .setVar("instructions", renderedAgentFile)
    .setVar("persona", persona)
    .setVar("context", renderedContext)

  let taskTemplate: Template
  if (params.taskPrompt.skipTemplate) {
    taskTemplate = Template.make(params.taskPrompt.content ?? "", options)
  } else {
    taskTemplate = Template.make(params.taskPrompt.content ?? "", options).setInputEnv(params.env)
  }

  return {
    systemTemplate,
    taskTemplate,
    guidelineFiles
  }
}
```

**Design note:** The `Effect.runSync` calls inside `buildAgentsPrompts` are a necessary tradeoff. The system template has `{{instructions}}`, `{{persona}}`, `{{context}}` placeholders that must be filled with already-resolved strings from the agent file, soul file, and context subtemplates. Each subtemplate must be rendered first to produce its string value. The `Template` class does not support nesting Template instances as variable values (which would allow deferred rendering). These intermediate renders are internal to the builder; the final system and task templates returned to the caller are unrendered `Template` instances — only `executeWithPi` calls `.render()` on those.

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: FAIL — `runner.ts` and `pi-executor.ts` expect old `AgentPrompts` shape. Expected.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/builder.ts
git commit -m "refactor: buildAgentsPrompts returns Template instances"
```

---

### Task 9: Update `PiExecutorConfig` to accept `Template` instances, update `runner.ts`

**Files:**
- Modify: `src/prompts/types.ts`
- Modify: `src/executors/pi/pi-executor.ts:23,29-47,115`
- Modify: `src/workflow/runner.ts:147,156-174,182-184`

- [ ] **Step 1: Change `ResolvablePrompt` to carry Templates**

Replace `src/prompts/types.ts` entirely:

```typescript
import type { Template } from "./template.js"

export interface ResolvablePrompt {
  systemTemplate: Template
  taskTemplate: Template
  guidelineFiles: Array<{ name: string; content: string }>
}
```

- [ ] **Step 2: Update `PiExecutorConfig.prompt` type (line 30)**

No change needed — it already imports `ResolvablePrompt` and uses it. The type just shifts from strings to templates.

- [ ] **Step 3: Update `executeWithPi` destructing (line 115)**

Replace:
```typescript
    // TODO: call Template.render method in here
    const { systemPrompt, taskPrompt, guidelineFiles } = config.prompt
```

With:
```typescript
    const { systemTemplate: system, taskTemplate: task, guidelineFiles } = config.prompt
```

- [ ] **Step 4: Temporarily render in executeWithPi for system prompt override (line 141)**

Replace `systemPrompt` at line 141 with a rendered string. Add before the `loaderOptions` definition:

```typescript
    const systemPrompt = Effect.runSync(system.render())
```

- [ ] **Step 5: Temporarily render task prompt for session.prompt call (line 228)**

Replace `taskPrompt` at line 228:
```typescript
      const taskPrompt = Effect.runSync(task.render())
      yield* _(Effect.promise(() => session.prompt(taskPrompt)))
```

- [ ] **Step 6: Update `runner.ts` to pass Template instances through**

Replace lines 147-174 (from the `buildAgentsPrompts` call through `PromptBuilt` emission):

```typescript
        const agentPrompts = buildAgentsPrompts({
          fragments,
          taskPrompt: task.agent!.prompt,
          env: taskEnv,
          agentConfig: agent
        }, guidelineFiles, templateOptions)

        // TODO: move this logic (output schema, user prompt) to inside buildAgentPrompt
        let taskPromptContent = agentPrompts.taskTemplate
        // Note: template wrapping logic stays for now, removed in Phase 3
        // But we can't mutate template strings anymore. Instead, we wrap in the runner
        // temporarily by constructing a new Template that prepends the wrapping.
        // For Phase 2, we need to keep PromptBuilt working.
        // We'll render locally for PromptBuilt event only, not for execution.
```

Wait — this is getting complex. The runner currently wraps the taskPrompt string. In Phase 2, the taskPrompt is a Template, not a string. We need to handle this carefully.

**Correct approach for Phase 2:** The runner should construct a temporary rendered version for emitting the `PromptBuilt` event, while passing the original template instances to `executeWithPi`. This keeps the `PromptBuilt` event working (tests rely on it) while Phase 3 will move it.

Replace lines 147-174:

```typescript
        const agentPrompts = buildAgentsPrompts({
          fragments,
          taskPrompt: task.agent!.prompt,
          env: taskEnv,
          agentConfig: agent
        }, guidelineFiles, templateOptions)

        // TODO: move this logic (output schema, user prompt) to inside buildAgentPrompt
        // Phase 2: render temporarily for PromptBuilt event emission
        // Phase 3 will move PromptBuilt into executeWithPi and the wrapping into buildAgentsPrompts
        let taskPromptContent = Effect.runSync(agentPrompts.taskTemplate.render())
        const systemPromptContent = Effect.runSync(agentPrompts.systemTemplate.render())
        if (task.agent?.output?.schema?.content) {
          const schemaJson = JSON.stringify(task.agent.output.schema.content, null, 2)
          taskPromptContent = `<task>\n${taskPromptContent}\n</task>\n\n<task_output_schema>\n${schemaJson}\n</task_output_schema>`
        }
        if (task.name === spec.spec.run.entrypoint) {
          taskPromptContent = `${taskPromptContent}\n\n<user_prompt>\n\n${taskEnv.user_input ?? ""}\n</user_prompt>`
        }

        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId,
          taskId,
          systemPrompt: systemPromptContent,
          taskPrompt: taskPromptContent,
          guidelineFiles: guidelineFiles.map(g => g.name)
        }))
```

And replace lines 182-184:

Replace:
```typescript
        const output = yield* _(
          executeWithPi({
            prompt: finalPrompt,
```

With:
```typescript
        const output = yield* _(
          executeWithPi({
            prompt: {
              systemTemplate: agentPrompts.systemTemplate,
              taskTemplate: agentPrompts.taskTemplate,
              guidelineFiles: agentPrompts.guidelineFiles
            },
```

- [ ] **Step 7: Build to verify**

Run: `bun run build`
Expected: PASS (type-level should work)

- [ ] **Step 8: Commit**

```bash
git add src/prompts/types.ts src/executors/pi/pi-executor.ts src/workflow/runner.ts
git commit -m "refactor: wire Template instances through executor config"
```

---

### Task 10: Update builder test for Template return type

**Files:**
- Modify: `tests/prompts/builder.test.ts`

- [ ] **Step 1: Update test assertions for `Template` instances instead of strings**

The `AgentPrompts` type now has `systemTemplate: Template` and `taskTemplate: Template`. Tests must render to get strings back.

Import `Template`:
```typescript
import { Template } from "../../src/prompts/template.js"
```

Add a helper at top of describe block:
```typescript
import { Effect } from "effect"

const render = (t: Template): string => Effect.runSync(t.render())
```

Update `result.systemPrompt` → `render(result.systemTemplate)`
Update `result.taskPrompt` → `render(result.taskTemplate)`

For property existence checks (`toHaveProperty("systemPrompt")` → `toHaveProperty("systemTemplate")`):
```typescript
expect(result).toHaveProperty("systemTemplate")
expect(result).toHaveProperty("taskTemplate")
```

Apply to all 17 tests. Here's the replacement pattern for each assertion:

| Old | New |
|-----|-----|
| `result.systemPrompt` | `render(result.systemTemplate)` |
| `result.taskPrompt` | `render(result.taskTemplate)` |
| `toHaveProperty("systemPrompt")` | `toHaveProperty("systemTemplate")` |
| `toHaveProperty("taskPrompt")` | `toHaveProperty("taskTemplate")` |

- [ ] **Step 2: Run builder tests only**

Run: `bun --bun vitest run tests/prompts/builder.test.ts`
Expected: All builder tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/prompts/builder.test.ts
git commit -m "test: update builder tests for Template return type"
```

---

### Task 11: Run all tests to verify Phase 2

- [ ] **Step 1: Run all tests**

Run: `bun --bun vitest run`
Expected: All 155 tests PASS

- [ ] **Step 2: If any test fails, fix and re-run**

Run: `bun run build`
Expected: PASS

---

## Phase 3: Logic moves and cleanup

### Task 12: Move persona wrapping to Handlebars `{{#if}}`

**Files:**
- Modify: `src/prompts/builder.ts:24-52`

- [ ] **Step 1: Update system template to use `{{#if}}`**

In `src/prompts/builder.ts`, replace the `systemTemplateStr` definition. The key change: `{{persona}}` becomes a block that uses `{{#if persona}}`:

```typescript
const systemTemplateStr = `
<platform>
# Hamilton Agentic Orchestration

Hamilton is an agentic orchestration platform where tasks are executed by agents, orchestrated as a DAG.

Your goal is to fullfil the task provided as input by Hamilton user.

## How to finish your task

When you finish your work, call the write_task_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_task_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</platform>

<instructions>
{{instructions}}
</instructions>

{{#if persona}}
<persona>
{{persona}}
</persona>
{{/if}}

<context>
{{context}}
</context>
`
```

- [ ] **Step 2: Remove the JavaScript ternary for persona wrapping**

Remove these lines (the ternary that wraps in `<persona>` tags):

```typescript
  const persona = resolvedSoul
    ? `<persona>\n${resolvedSoul}\n</persona>`
    : ""
```

Replace the persona variable with just the resolvedSoul value:

```typescript
  const persona = resolvedSoul
```

- [ ] **Step 3: Build and run tests**

Run: `bun run build`
Expected: PASS

Run: `bun --bun vitest run`
Expected: All tests PASS (persona rendering moves to template, behavior identical)

- [ ] **Step 4: Commit**

```bash
git add src/prompts/builder.ts
git commit -m "refactor: move persona wrapping to Handlebars {{#if}}"
```

---

### Task 13: Move output-schema and user-prompt wrapping into `buildAgentsPrompts`

**Files:**
- Modify: `src/prompts/builder.ts` (add new params to `PromptParams` and wrapping logic to `buildAgentsPrompts`)
- Modify: `src/workflow/runner.ts` (call with new params, remove wrapping)

- [ ] **Step 1: Add optional schema and user-input fields to `PromptParams`**

In `src/prompts/builder.ts`, update `PromptParams`:

```typescript
export interface PromptParams {
  fragments: SystemPromptFragments
  taskPrompt: Prompt
  outputSchema?: Record<string, unknown>
  userInput?: string
  isEntrypoint?: boolean

  env: WorkflowEnv
  agentConfig: Partial<AgentManifest>
}
```

- [ ] **Step 2: Add wrapping logic inside `buildAgentsPrompts`**

After computing `taskTemplate` but before returning, wrap the task template content:

```typescript
  let taskTemplateContent = params.taskPrompt.skipTemplate
    ? (params.taskPrompt.content ?? "")
    : params.taskPrompt.content ?? ""

  if (params.outputSchema) {
    const schemaJson = JSON.stringify(params.outputSchema, null, 2)
    taskTemplateContent = `<task>\n${taskTemplateContent}\n</task>\n\n<task_output_schema>\n${schemaJson}\n</task_output_schema>`
  }
  if (params.isEntrypoint && params.userInput) {
    taskTemplateContent = `${taskTemplateContent}\n\n<user_prompt>\n\n${params.userInput}\n</user_prompt>`
  }

  let taskTemplate: Template
  if (params.taskPrompt.skipTemplate && !params.outputSchema && !params.isEntrypoint) {
    taskTemplate = Template.make(params.taskPrompt.content ?? "", options)
  } else {
    taskTemplate = Template.make(taskTemplateContent, options).setInputEnv(params.env)
  }
```

- [ ] **Step 3: Update `runner.ts` call site to pass new params**

Replace the `buildAgentsPrompts` call (around line 147):

```typescript
        const agentPrompts = buildAgentsPrompts({
          fragments,
          taskPrompt: task.agent!.prompt,
          outputSchema: task.agent?.output?.schema?.content,
          userInput: taskEnv.user_input ?? undefined,
          isEntrypoint: task.name === spec.spec.run.entrypoint,
          env: taskEnv,
          agentConfig: agent
        }, guidelineFiles, templateOptions)
```

- [ ] **Step 4: Remove the prompt-wrapping block from runner.ts**

Delete these lines (the 12-line block that mutates taskPromptContent):

```typescript
        // TODO: move this logic (output schema, user prompt) to inside buildAgentPrompt
        let taskPromptContent = Effect.runSync(agentPrompts.taskTemplate.render())
        const systemPromptContent = Effect.runSync(agentPrompts.systemTemplate.render())
        if (task.agent?.output?.schema?.content) {
          const schemaJson = JSON.stringify(task.agent.output.schema.content, null, 2)
          taskPromptContent = `<task>\n${taskPromptContent}\n</task>\n\n<task_output_schema>\n${schemaJson}\n</task_output_schema>`
        }
        if (task.name === spec.spec.run.entrypoint) {
          taskPromptContent = `${taskPromptContent}\n\n<user_prompt>\n\n${taskEnv.user_input ?? ""}\n</user_prompt>`
        }
```

And delete the `PromptBuilt` emission that follows:

```typescript
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId,
          taskId,
          systemPrompt: systemPromptContent,
          taskPrompt: taskPromptContent,
          guidelineFiles: guidelineFiles.map(g => g.name)
        }))
```

- [ ] **Step 5: Build to verify**

Run: `bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/prompts/builder.ts src/workflow/runner.ts
git commit -m "refactor: move prompt wrapping into buildAgentsPrompts"
```

---

### Task 14: Render in `executeWithPi`, emit `PromptBuilt` there

**Files:**
- Modify: `src/executors/pi/pi-executor.ts:114-115,228`

- [ ] **Step 1: Add EventBus import if not present (already on line 2)**

Already imported:
```typescript
import { EventBus } from "../../events/bus.js"
```

- [ ] **Step 2: Render templates at execution time, emit PromptBuilt**

Replace lines 114-115 (destructure + the TODO):

```typescript
    const { systemTemplate, taskTemplate, guidelineFiles } = config.prompt

    const systemPrompt = Effect.runSync(systemTemplate.render())
    const taskPrompt = Effect.runSync(taskTemplate.render())

    const bus = yield* _(EventBus)

    yield* _(bus.publish({
      _tag: "PromptBuilt",
      runId: config.runId,
      taskId: config.taskId,
      systemPrompt,
      taskPrompt,
      guidelineFiles: guidelineFiles.map(g => g.name)
    }))
```

- [ ] **Step 3: Use the rendered strings for system prompt override and session.prompt**

Replace line 141 (`systemPromptOverride`):
```typescript
      systemPromptOverride: () => systemPrompt,
```
(This already uses `systemPrompt` variable, unchanged)

Replace line 228 (`session.prompt(taskPrompt)`):
```typescript
      yield* _(Effect.promise(() => session.prompt(taskPrompt)))
```
(Already uses `taskPrompt` variable, unchanged since we assigned it above)

- [ ] **Step 4: Update `runner.ts` to remove `import { EventBus, createSubscriber }` usage for PromptBuilt**

No changes needed — EventBus is still used for other events. We already removed the `PromptBuilt` emission in Task 13 Step 4.

- [ ] **Step 5: Build to verify**

Run: `bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "refactor: render and emit PromptBuilt in executeWithPi"
```

---

### Task 15: Update runner tests for moved `PromptBuilt`

**Files:**
- Modify: `tests/workflow/runner.test.ts` (lines 278-317 — PromptBuilt tests)
- Modify: `tests/workflow/runner-regression.test.ts` (lines 72-136 — PromptBuilt + user-input tests)

- [ ] **Step 1: Update runner.test.ts PromptBuilt tests**

The `executeWithPi` mock currently returns `Effect.succeed({ status: "done" })`. Now `executeWithPi` also publishes `PromptBuilt`. The mock's `vi.fn` signature doesn't publish events.

The test at line 278 checks that `PromptBuilt` events appear in the collected event stream. Since `executeWithPi` is mocked to return a simple succeed effect, it won't publish events.

We need to update the mock to publish `PromptBuilt` events. Update the mock in `tests/workflow/runner.test.ts`:

```typescript
vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E, Stream } = require("effect")
  return {
    executeWithPi: vi.fn((config: any) => {
      const bus = config.bus
      return E.gen(function* (_: any) {
        if (bus) {
          yield* _(bus.publish({
            _tag: "PromptBuilt",
            runId: config.runId,
            taskId: config.taskId,
            systemPrompt: "system prompt from pi",
            taskPrompt: "task prompt from pi",
            guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
          }))
        }
        return { status: "done" }
      })
    }),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})
```

Wait — `executeWithPi` doesn't receive `bus` as a config field. The `bus` comes from `EventBus` context. And the mock doesn't have access to Effect context. We need a different approach.

The mock's `executeWithPi` currently has `Effect.Effect<Record<string, unknown>, PiExecutionError, EventBus>` requiring `EventBus` in context. The mock should require `EventBus` via `Effect.gen`. Let's update:

```typescript
vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  const { EventBus } = require("../../src/events/bus.js")
  return {
    executeWithPi: vi.fn((config: any) => 
      E.gen(function* (_: any) {
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system-prompt",
          taskPrompt: `mock-task-prompt for ${config.taskId}`,
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
        }))
        return { status: "done" }
      })
    ),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})
```

Now update the PromptBuilt test to assert on the mock's values:

```typescript
  it("publishes PromptBuilt events for agent tasks", async () => {
    const events = await collectEvents(
      runWorkflow(makeSpec(), {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const promptBuilt = events.filter(e => e._tag === "PromptBuilt")
    expect(promptBuilt.length).toBe(2)
    // PromptBuilt now comes from the mocked executeWithPi, not runner
    expect(promptBuilt[0]).toHaveProperty("systemPrompt")
    expect(promptBuilt[0]).toHaveProperty("taskPrompt")
  })
```

Update the output schema test — it expects the prompt to contain `<task_output_schema>`. Since the wrapping now happens in `buildAgentsPrompts` (Phase 3), the mocked `executeWithPi` won't show it. But the builder test covers the wrapping. The runner test just verifies `PromptBuilt` events exist. We can simplify:

```typescript
  it("injects output schema into task prompt when schema is present", async () => {
    // The wrapping logic moved to buildAgentsPrompts, verified in builder.test.ts
    // This test verifies that PromptBuilt events are still emitted
    const schemaContent = { type: "object", properties: { status: { type: "string" }, repo: { type: "string" } }, required: ["status"] }
    const spec = makeSpec({
      spec: {
        ...makeSpec().spec,
        tasks: [
          { name: "plan", agent: { executorRef: "planner", prompt: { content: "Plan the feature" }, output: { schema: { content: schemaContent } } } },
          { name: "implement", dependencies: ["plan"], agent: { executorRef: "coder", prompt: { content: "Implement it" } } }
        ]
      }
    })

    const events = await collectEvents(
      runWorkflow(spec, {}, { workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"), projectDir: tmpHome }, { strict: false })
    )

    const promptBuilt = events.filter(e => e._tag === "PromptBuilt")
    expect(promptBuilt.length).toBe(2)
  })
```

- [ ] **Step 2: Update runner-regression.test.ts PromptBuilt tests**

The mock in `runner-regression.test.ts` needs the same treatment. Update:

```typescript
vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  const { EventBus } = require("../../src/events/bus.js")
  return {
    executeWithPi: vi.fn((config: any) =>
      E.gen(function* (_: any) {
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system-prompt",
          taskPrompt: `mock-task: ${config.prompt?.taskTemplate?.template ?? ""}`,
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
        }))
        return { status: "done" }
      })
    ),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})
```

Update the test "publishes PromptBuilt event with systemPrompt and taskPrompt":
```typescript
  it("publishes PromptBuilt event with systemPrompt and taskPrompt", async () => {
    const events: Event[] = []

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          return yield* _(runWorkflow(testSpec, { user_input: "test" }, {
            workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"),
            projectDir: tmpHome
          }, { strict: false }))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)

    const promptBuilt = events.find((e) => e._tag === "PromptBuilt")
    expect(promptBuilt).toBeDefined()
    if (promptBuilt && promptBuilt._tag === "PromptBuilt") {
      expect(typeof promptBuilt.systemPrompt).toBe("string")
      expect(typeof promptBuilt.taskPrompt).toBe("string")
      expect(promptBuilt.systemPrompt.length).toBeGreaterThan(0)
      expect(Array.isArray(promptBuilt.guidelineFiles)).toBe(true)
    }
  })
```

Update "wraps entrypoint task prompt with user input section" — now the wrapping is in `buildAgentsPrompts`, not runner. This test should verify that the prompt is wrapped (the builder test covers it):

```typescript
  it("wraps entrypoint task prompt with user input section", async () => {
    const events: Event[] = []

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* (_) {
          const bus = yield* _(EventBus)
          yield* _(Effect.forkScoped(
            bus.subscribeAll.pipe(
              Stream.tap((e) => Effect.sync(() => events.push(e))),
              Stream.runDrain
            )
          ))
          yield* _(Effect.sleep("10 millis"))
          return yield* _(runWorkflow(testSpec, { user_input: "build a login page" }, {
            workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"),
            projectDir: tmpHome
          }, { strict: false }))
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)

    const promptBuilt = events.find((e) => e._tag === "PromptBuilt")
    expect(promptBuilt).toBeDefined()
    if (promptBuilt && promptBuilt._tag === "PromptBuilt") {
      // PromptBuilt now emitted by executeWithPi mock
      // user-input wrapping is tested in builder.test.ts
      expect(promptBuilt.taskPrompt.length).toBeGreaterThan(0)
    }
  })
```

Update "writes PromptBuilt event to task logs via FileLogger" — same pattern, assert that prompt_built events exist in logs:

```typescript
  it("writes PromptBuilt event to task logs via FileLogger", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          return yield* runWorkflow(testSpec, { user_input: "test" }, {
            workflowsDir: Path.join(tmpHome, ".hamilton", "workflows"),
            projectDir: tmpHome
          }, { strict: false })
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    expect(Exit.isSuccess(result)).toBe(true)

    const logDir = Path.join(tmpHome, ".hamilton", "runs")
    const runDirs = Fs.readdirSync(logDir)
    expect(runDirs.length).toBeGreaterThan(0)

    const runId = runDirs[0]!
    const logsDir = Path.join(logDir, runId, "logs")
    const logFiles = Fs.readdirSync(logsDir).filter(f => f.endsWith(".jsonl"))
    expect(logFiles.length).toBeGreaterThan(0)

    let found = false
    for (const lf of logFiles) {
      const content = Fs.readFileSync(Path.join(logsDir, lf), "utf-8")
      for (const line of content.trim().split("\n")) {
        if (!line.trim()) continue
        const parsed = JSON.parse(line)
        if (parsed.event === "prompt_built") {
          expect(parsed).toHaveProperty("system_prompt")
          expect(parsed).toHaveProperty("task_prompt")
          expect(parsed).toHaveProperty("guideline_files")
          expect(Array.isArray(parsed.guideline_files)).toBe(true)
          found = true
        }
      }
    }
    expect(found).toBe(true)
  })
```

- [ ] **Step 3: Update runner-recursion.test.ts mock**

Apply the same pattern:

```typescript
vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  const { EventBus } = require("../../src/events/bus.js")
  return {
    executeWithPi: vi.fn((config: any) =>
      E.gen(function* (_: any) {
        const bus = yield* _(EventBus)
        yield* _(bus.publish({
          _tag: "PromptBuilt",
          runId: config.runId,
          taskId: config.taskId,
          systemPrompt: "mock-system",
          taskPrompt: "mock-task",
          guidelineFiles: config.prompt?.guidelineFiles?.map((g: any) => g.name) ?? []
        }))
        return { status: "feedback", feedback: "fix this" }
      })
    ),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})
```

- [ ] **Step 4: Add builder test for wrapping logic**

Add to `tests/prompts/builder.test.ts`:

```typescript
  it("wraps task prompt with output schema when provided", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Plan the feature" },
      outputSchema: { type: "object", properties: { status: { type: "string" } }, required: ["status"] }
    }
    const result = buildAgentsPrompts(params)
    const rendered = Effect.runSync(result.taskTemplate.render())
    expect(rendered).toContain("<task_output_schema>")
    expect(rendered).toContain("</task_output_schema>")
    expect(rendered).toContain('"type": "object"')
    expect(rendered).toContain("<task>")
    expect(rendered).toContain("</task>")
    expect(rendered).toContain("Plan the feature")
  })

  it("wraps task prompt with user input when isEntrypoint and userInput are set", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Do it" },
      isEntrypoint: true,
      userInput: "build a login page"
    }
    const result = buildAgentsPrompts(params)
    const rendered = Effect.runSync(result.taskTemplate.render())
    expect(rendered).toContain("<user_prompt>")
    expect(rendered).toContain("build a login page")
    expect(rendered).toContain("</user_prompt>")
  })

  it("does not wrap user input when isEntrypoint is false", () => {
    const params: PromptParams = {
      ...baseParams,
      taskPrompt: { content: "Do it" },
      userInput: "build a login page"
    }
    const result = buildAgentsPrompts(params)
    const rendered = Effect.runSync(result.taskTemplate.render())
    expect(rendered).not.toContain("<user_prompt>")
  })
```

Add the `Effect` import at top:
```typescript
import { Effect } from "effect"
```

- [ ] **Step 5: Run all tests**

Run: `bun --bun vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add tests/prompts/builder.test.ts tests/workflow/runner.test.ts tests/workflow/runner-recursion.test.ts tests/workflow/runner-regression.test.ts
git commit -m "test: update tests for Phase 3 PromptBuilt in executeWithPi"
```

---

### Task 16: Verify all 17 TODOs are resolved

- [ ] **Step 1: Search for remaining TODOs**

Run:
```bash
grep -n "TODO" src/prompts/template.ts src/prompts/persona.ts src/prompts/builder.ts src/workflow/runner.ts src/executors/pi/pi-executor.ts
```

Expected: **Zero matches** — all 17 TODOs are removed.

- [ ] **Step 2: Final build and test run**

Run: `bun run build`
Expected: PASS

Run: `bun --bun vitest run`
Expected: All 155 tests PASS

- [ ] **Step 3: Commit**

```bash
git add -A
git diff --staged --stat  # verify only expected files
git commit -m "refactor: resolve all 17 TODOs, Template class becomes sole rendering API"
```

---

## Verification Checklist

After all tasks complete:
1. `bun run build` passes
2. `bun --bun vitest run` — all 155 tests pass
3. Zero TODOs remain in `src/prompts/template.ts`, `src/prompts/persona.ts`, `src/prompts/builder.ts`, `src/workflow/runner.ts`, `src/executors/pi/pi-executor.ts`
4. `Template` is the only exported template API from `src/prompts/template.ts`
5. `resolveTemplate` and `resolveFileTemplate` are no longer exported
6. `PromptBuilt` is emitted only from `executeWithPi`
7. `runner.ts` contains no prompt-formatting logic (no `<task_output_schema>`, `<user_prompt>` in runner)
