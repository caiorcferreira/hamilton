# Templating with Handlebars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 23-line regex templating in `src/prompts/template.ts` with Handlebars, adding conditionals (`{{#if}}`) and loops (`{{#each}}`) while preserving full backward compatibility.

**Architecture:** Handlebars replaces the regex resolver inside `resolveTemplate()`. A `TemplateOptions { strict }` object flows from settings → CLI → runner → builder → resolver. A new config module reads `templating.strict` from `~/.hamilton/settings.yaml`. The loader gains support for `.hbs` file extension alongside existing `.md` files.

**Tech Stack:** handlebars 4.7.9 (pinned), Effect-TS, bun, vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `package.json` | Add `handlebars` dependency |
| `src/prompts/template.ts` | Handlebars instance, `resolveTemplate`, `resolveFileTemplate`, `TemplateOptions`, error types |
| `src/prompts/config.ts` (new) | Read `templating.strict` from `settings.yaml` |
| `src/prompts/builder.ts` | Accept `TemplateOptions`, pass full env to Handlebars |
| `src/workflow/loader.ts` | Accept `.hbs` files in `prompt.file` (like existing `.md` support) |
| `src/workflow/runner.ts` | Thread `TemplateOptions` from config to builder |
| `src/cli/commands/run.ts` | Load template config, pass to runner |
| `src/cli/commands/resume.ts` | Same |
| `tests/prompts/template.test.ts` | Full rewrite: substitution, conditionals, loops, errors, file resolution |
| `tests/prompts/builder.test.ts` | Update calls to pass `TemplateOptions` |

---

### Task 1: Install handlebars dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add handlebars to package.json**

```json
"handlebars": "4.7.9",
```

Add it alphabetically to the `dependencies` block (after `go-duration-js` and before `nanoid`).

- [ ] **Step 2: Run bun install**

```bash
bun install
```

Expected: installs handlebars, updates `bun.lock`.

- [ ] **Step 3: Verify handlebars is importable**

```bash
bun -e "import Handlebars from 'handlebars'; console.log(Handlebars.VERSION)"
```

Expected: prints `4.7.9`.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add handlebars 4.7.9"
```

---

### Task 2: Rewrite template.ts — core Handlebars engine

**Files:**
- Modify: `src/prompts/template.ts`
- Test: `tests/prompts/template.test.ts`

- [ ] **Step 1: Write the failing test for basic substitution**

Replace the entire content of `tests/prompts/template.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { resolveTemplate, TemplateOptions } from "../../src/prompts/template.js"

const lenient: TemplateOptions = { strict: false }
const strict: TemplateOptions = { strict: true }

describe("resolveTemplate", () => {
  it("replaces {{name}} with context value", () => {
    expect(resolveTemplate("Hello {{name}}!", { name: "world" }, lenient)).toBe("Hello world!")
  })

  it("replaces multiple variables", () => {
    expect(resolveTemplate("{{a}} and {{b}}", { a: "1", b: "2" }, lenient)).toBe("1 and 2")
  })

  it("resolves dotted paths via inputs namespace", () => {
    const ctx = {
      inputs: {
        tasks: { setup: { outputs: { repo: "/tmp/repo", branch: "feat/x" } } },
        cwd: "/home/project",
        parameters: { current_task: { title: "Add login" } }
      }
    }
    expect(resolveTemplate("REPO: {{inputs.tasks.setup.outputs.repo}}", ctx, lenient)).toBe("REPO: /tmp/repo")
    expect(resolveTemplate("BRANCH: {{inputs.tasks.setup.outputs.branch}}", ctx, lenient)).toBe("BRANCH: feat/x")
    expect(resolveTemplate("DIR: {{inputs.cwd}}", ctx, lenient)).toBe("DIR: /home/project")
  })

  it("resolves dotted paths on top-level context (no inputs prefix)", () => {
    const ctx = {
      tasks: { setup: { outputs: { repo: "/tmp/repo" } } }
    }
    expect(resolveTemplate("REPO: {{tasks.setup.outputs.repo}}", ctx, lenient)).toBe("REPO: /tmp/repo")
  })

  it("stringifies non-string values as JSON", () => {
    expect(resolveTemplate("Items: {{items}}", { items: [1, 2, 3] }, lenient)).toBe("Items: [1,2,3]")
    expect(resolveTemplate("Context: {{ctx}}", { ctx: { a: 1 } }, lenient)).toBe('Context: {"a":1}')
  })

  it("writes true/false/0 as-is (not via JSON.stringify)", () => {
    expect(resolveTemplate("Bool: {{flag}}, Zero: {{num}}", { flag: true, num: 0 }, lenient)).toBe("Bool: true, Zero: 0")
  })

  it("writes null/undefined as empty string", () => {
    expect(resolveTemplate("X{{missing}}Y", {}, lenient)).toBe("XY")
  })

  it("renders missing variables as empty string in lenient mode", () => {
    expect(resolveTemplate("Hello {{name}}!", {}, lenient)).toBe("Hello !")
  })

  it("passes through text with no placeholders unchanged", () => {
    expect(resolveTemplate("plain text", { name: "x" }, lenient)).toBe("plain text")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/prompts/template.test.ts
```

Expected: FAIL — `resolveTemplate` still uses regex, `TemplateOptions` doesn't exist.

- [ ] **Step 3: Rewrite src/prompts/template.ts**

Replace entire content. Keep `resolveDottedPath` (used by `arguments.ts`). Replace the regex `resolveTemplate` with Handlebars. Remove `resolveInputsTemplate` (absorbed by builder). Add `resolveFileTemplate` and error types.

```ts
import { Data, Effect } from "effect"
import Handlebars from "handlebars"
import * as Fs from "node:fs"

export interface TemplateOptions {
  strict: boolean
}

export class MissingVariableError extends Data.TaggedError("MissingVariableError")<{
  variable: string
  template: string
}> { }

export class TemplateSyntaxError extends Data.TaggedError("TemplateSyntaxError")<{
  message: string
}> { }

export class TemplateFileError extends Data.TaggedError("TemplateFileError")<{
  filePath: string
  message: string
}> { }

export type TemplateError = MissingVariableError | TemplateSyntaxError | TemplateFileError

export function resolveDottedPath(context: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = context
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function createHandlebars(): typeof Handlebars {
  return Handlebars.create()
}

export function resolveTemplate(
  template: string,
  context: Record<string, unknown>,
  options: TemplateOptions
): string {
  if (!template.includes("{{")) return template

  try {
    const hbs = createHandlebars()
    const compiled = hbs.compile(template, { noEscape: true })

    if (options.strict) {
      const referenced = scanTemplatePaths(template)
      for (const path of referenced) {
        const value = resolveDottedPath(context, path)
        if (value === undefined) {
          throw new MissingVariableError({ variable: path, template: template.slice(0, 100) })
        }
      }
    }

    return compiled(context)
  } catch (e) {
    if (e instanceof MissingVariableError) throw e
    throw new TemplateSyntaxError({ message: String(e) })
  }
}

function scanTemplatePaths(template: string): string[] {
  const paths = new Set<string>()
  for (const m of template.matchAll(/\{\{(?!\#|\/)([\w.]+)\}\}/g)) {
    paths.add(m[1])
  }
  return [...paths]
}

export function resolveFileTemplate(
  filePath: string,
  context: Record<string, unknown>,
  options: TemplateOptions
): Effect.Effect<string, TemplateError> {
  return Effect.try({
    try: () => {
      if (!Fs.existsSync(filePath)) {
        throw new TemplateFileError({ filePath, message: "File not found" })
      }
      const content = Fs.readFileSync(filePath, "utf-8")
      return resolveTemplate(content, context, options)
    },
    catch: (e) => {
      if (e instanceof MissingVariableError || e instanceof TemplateSyntaxError || e instanceof TemplateFileError) {
        return e
      }
      return new TemplateFileError({ filePath, message: String(e) })
    }
  })
}
```

- [ ] **Step 4: Run test to verify basic substitution tests pass**

```bash
bun --bun vitest run tests/prompts/template.test.ts
```

Expected: all substitution tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/template.ts tests/prompts/template.test.ts
git commit -m "feat: replace regex resolver with Handlebars engine"
```

---

### Task 3: Add conditional tests and implementation

**Files:**
- Modify: `tests/prompts/template.test.ts`

- [ ] **Step 1: Add conditional tests**

Append to the `describe("resolveTemplate", () => ...)` block, after the last test:

```ts
describe("conditionals", () => {
  it("renders {{#if}} block when value is truthy", () => {
    expect(resolveTemplate("{{#if active}}YES{{/if}}", { active: true }, lenient)).toBe("YES")
  })

  it("skips {{#if}} block when value is falsy", () => {
    expect(resolveTemplate("{{#if active}}YES{{/if}}", { active: false }, lenient)).toBe("")
  })

  it("renders {{#if}}...{{else}}...{{/if}} truthy branch", () => {
    expect(resolveTemplate("{{#if flag}}YES{{else}}NO{{/if}}", { flag: true }, lenient)).toBe("YES")
  })

  it("renders {{#if}}...{{else}}...{{/if}} falsy branch", () => {
    expect(resolveTemplate("{{#if flag}}YES{{else}}NO{{/if}}", { flag: false }, lenient)).toBe("NO")
  })

  it("treats non-empty string as truthy", () => {
    expect(resolveTemplate("{{#if name}}has name{{/if}}", { name: "Alice" }, lenient)).toBe("has name")
  })

  it("treats empty string as falsy", () => {
    expect(resolveTemplate("{{#if name}}has name{{/if}}", { name: "" }, lenient)).toBe("")
  })

  it("treats non-empty array as truthy", () => {
    expect(resolveTemplate("{{#if items}}has items{{/if}}", { items: [1] }, lenient)).toBe("has items")
  })

  it("treats empty array as falsy", () => {
    expect(resolveTemplate("{{#if items}}has items{{/if}}", { items: [] }, lenient)).toBe("")
  })

  it("treats 0 as falsy", () => {
    expect(resolveTemplate("{{#if count}}nonzero{{/if}}", { count: 0 }, lenient)).toBe("")
  })

  it("{{#unless}} renders when falsy", () => {
    expect(resolveTemplate("{{#unless done}}pending{{/unless}}", { done: false }, lenient)).toBe("pending")
  })

  it("{{#unless}} skips when truthy", () => {
    expect(resolveTemplate("{{#unless done}}pending{{/unless}}", { done: true }, lenient)).toBe("")
  })

  it("nested conditionals", () => {
    const t = "{{#if outer}}{{#if inner}}both{{/if}}{{/if}}"
    expect(resolveTemplate(t, { outer: true, inner: true }, lenient)).toBe("both")
    expect(resolveTemplate(t, { outer: true, inner: false }, lenient)).toBe("")
    expect(resolveTemplate(t, { outer: false, inner: true }, lenient)).toBe("")
  })

  it("conditionals with dotted path values from inputs", () => {
    const ctx = { inputs: { tasks: { verify: { outputs: { passed: true } } } } }
    expect(resolveTemplate("{{#if inputs.tasks.verify.outputs.passed}}OK{{/if}}", ctx, lenient)).toBe("OK")
  })
})
```

- [ ] **Step 2: Run tests — all conditional tests should already pass (Handlebars built-in)**

```bash
bun --bun vitest run tests/prompts/template.test.ts
```

Expected: all 22 tests PASS (conditionals work natively in Handlebars).

- [ ] **Step 3: Commit**

```bash
git add tests/prompts/template.test.ts
git commit -m "test: add Handlebars conditional tests"
```

---

### Task 4: Add loop tests

**Files:**
- Modify: `tests/prompts/template.test.ts`

- [ ] **Step 1: Add loop tests**

Append after the conditionals describe block:

```ts
describe("loops", () => {
  it("{{#each}} iterates over array", () => {
    const ctx = { items: ["a", "b", "c"] }
    expect(resolveTemplate("{{#each items}}{{this}},{{/each}}", ctx, lenient)).toBe("a,b,c,")
  })

  it("{{#each}} with object access in body", () => {
    const ctx = { stories: [{ id: "1", title: "A" }, { id: "2", title: "B" }] }
    expect(resolveTemplate("{{#each stories}}{{id}}:{{title}};{{/each}}", ctx, lenient)).toBe("1:A;2:B;")
  })

  it("{{#each}} with @index", () => {
    const ctx = { items: ["x", "y"] }
    expect(resolveTemplate("{{#each items}}{{@index}}:{{this}};{{/each}}", ctx, lenient)).toBe("0:x;1:y;")
  })

  it("{{#each}} with @first and @last", () => {
    const ctx = { items: ["a", "b", "c"] }
    const t = "{{#each items}}{{#if @first}}START:{{/if}}{{this}}{{#unless @last}};{{/unless}}{{/each}}"
    expect(resolveTemplate(t, ctx, lenient)).toBe("START:a;b;c")
  })

  it("{{#each}} over empty array produces empty output", () => {
    expect(resolveTemplate("{{#each items}}x{{/each}}", { items: [] }, lenient)).toBe("")
  })

  it("{{#each}} over inputs.tasks via dotted path", () => {
    const ctx = {
      inputs: {
        tasks: {
          plan: { outputs: { tasks: [{ title: "A" }, { title: "B" }] } }
        }
      }
    }
    expect(resolveTemplate("{{#each inputs.tasks.plan.outputs.tasks}}- {{title}}\n{{/each}}", ctx, lenient)).toBe("- A\n- B\n")
  })

  it("{{#each}} over non-array produces empty output (lenient)", () => {
    expect(resolveTemplate("{{#each notAnArray}}x{{/each}}", {}, lenient)).toBe("")
  })
})
```

- [ ] **Step 2: Run tests**

```bash
bun --bun vitest run tests/prompts/template.test.ts
```

Expected: all 29 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/prompts/template.test.ts
git commit -m "test: add Handlebars loop tests"
```

---

### Task 5: Add strict/error tests

**Files:**
- Modify: `tests/prompts/template.test.ts`

- [ ] **Step 1: Add strict mode and error tests**

Append after loops describe block:

```ts
describe("strict mode", () => {
  it("throws MissingVariableError when variable is missing", () => {
    expect(() => resolveTemplate("Hello {{name}}!", {}, strict)).toThrow()
  })

  it("renders missing variables as empty string in lenient mode (dotted path)", () => {
    expect(resolveTemplate("MISSING: {{tasks.nonexistent.field}}", {}, lenient)).toBe("MISSING: ")
  })
})

describe("syntax errors", () => {
  it("throws TemplateSyntaxError for unclosed if", () => {
    expect(() => resolveTemplate("{{#if x}}open", {}, lenient)).toThrow()
  })

  it("throws TemplateSyntaxError for unclosed each", () => {
    expect(() => resolveTemplate("{{#each items}}open", {}, lenient)).toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
bun --bun vitest run tests/prompts/template.test.ts
```

Expected: all 33 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/prompts/template.test.ts
git commit -m "test: add strict mode and syntax error tests"
```

---

### Task 6: Add file template tests and resolveFileTemplate

**Files:**
- Modify: `tests/prompts/template.test.ts`

- [ ] **Step 1: Add resolveFileTemplate tests**

Append after the last describe block:

```ts
describe("resolveFileTemplate", () => {
  it("reads .hbs file and resolves placeholders", async () => {
    const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-template-test-"))
    const filePath = Path.join(tmp, "greet.hbs")
    Fs.writeFileSync(filePath, "Hello {{name}}!")
    try {
      const { resolveFileTemplate } = await import("../../src/prompts/template.js")
      const result = await Effect.runPromise(resolveFileTemplate(filePath, { name: "world" }, lenient))
      expect(result).toBe("Hello world!")
    } finally {
      Fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("reads .md file and resolves placeholders", async () => {
    const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-template-test-"))
    const filePath = Path.join(tmp, "prompt.md")
    Fs.writeFileSync(filePath, "# Task\nFix {{repo}}")
    try {
      const { resolveFileTemplate } = await import("../../src/prompts/template.js")
      const result = await Effect.runPromise(resolveFileTemplate(filePath, { repo: "foo" }, lenient))
      expect(result).toBe("# Task\nFix foo")
    } finally {
      Fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("fails with TemplateFileError for missing file", async () => {
    const { resolveFileTemplate, TemplateFileError } = await import("../../src/prompts/template.js")
    const result = await Effect.runPromiseExit(resolveFileTemplate("/nonexistent/path.hbs", {}, lenient))
    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

Add these imports at the top of the file (update the import block):

```ts
import { describe, it, expect } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Effect, Exit } from "effect"
import { resolveTemplate, TemplateOptions } from "../../src/prompts/template.js"
```

- [ ] **Step 2: Run tests**

```bash
bun --bun vitest run tests/prompts/template.test.ts
```

Expected: all 36 tests PASS (resolveFileTemplate is already implemented in task 2, these tests just verify it works).

- [ ] **Step 3: Commit**

```bash
git add tests/prompts/template.test.ts
git commit -m "test: add resolveFileTemplate tests"
```

---

### Task 7: Create template config loader

**Files:**
- Create: `src/prompts/config.ts`

- [ ] **Step 1: Create src/prompts/config.ts**

```ts
import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../paths.js"
import type { TemplateOptions } from "./template.js"

export function loadTemplateConfig(): Effect.Effect<TemplateOptions, Error> {
  return Effect.try({
    try: () => {
      const path = settingsPath()
      if (!Fs.existsSync(path)) return { strict: false }

      const content = Fs.readFileSync(path, "utf-8")
      const doc = Yaml.parse(content) as Record<string, unknown> | null
      if (!doc || typeof doc !== "object") return { strict: false }

      const templating = doc["templating"]
      if (!templating || typeof templating !== "object") return { strict: false }

      const strict = (templating as Record<string, unknown>)["strict"]
      return { strict: strict === true }
    },
    catch: () => new Error("Failed to load template config")
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/config.ts
git commit -m "feat: add template config loader (templating.strict from settings.yaml)"
```

---

### Task 8: Update builder.ts signature

**Files:**
- Modify: `src/prompts/builder.ts`
- Modify: `tests/prompts/builder.test.ts`

- [ ] **Step 1: Update buildAgentPrompt signature and body**

`src/prompts/builder.ts` — change the import at top, the function signature, and the template calls:

```ts
import type { Prompt, AgentManifest } from "../types.js"
import type { WorkflowEnv } from "../workflow/env.js"
import { resolveTemplate, type TemplateOptions } from "./template.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  prompt: Prompt
  env: WorkflowEnv
  contextTemplate?: string
  agentConfig: Partial<AgentManifest>
}

export interface BuiltPrompt {
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

const defaultContextTemplate = `## Inputs
{{inputs}}`

export function buildAgentPrompt(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): BuiltPrompt {
  const persona = params.soulFile
    ? `<persona>\n${params.soulFile}\n</persona>`
    : ""

  const template = params.contextTemplate || defaultContextTemplate
  const contextForTemplate = params.contextTemplate
    ? { inputs: params.env }
    : { inputs: JSON.stringify(params.env) }
  const renderedContext = resolveTemplate(template, contextForTemplate, options)

  const resolvedSystem = resolveTemplate(systemTemplate, {
    instructions: params.agentFile,
    persona,
    context: renderedContext,
  }, options)

  const resolvedInput = resolveTemplate(params.prompt.content ?? "", { inputs: params.env }, options)

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}
```

Key changes:
1. Import `TemplateOptions` from `./template.js`
2. `buildAgentPrompt` takes `options` as third parameter (default `{ strict: false }`)
3. Default context template wraps `params.env` with `JSON.stringify` so `{{inputs}}` renders as a JSON string (matches old behavior). Custom context templates pass `{ inputs: params.env }` for dotted-path access.
4. Task prompt keeps the `{ inputs: params.env }` wrapper for backward compat with `{{inputs.tasks.setup.outputs.repo}}` patterns
5. All three `resolveTemplate` calls pass `options`

- [ ] **Step 2: Verify existing builder tests still compile and pass**

First, check if existing tests reference `resolveInputsTemplate` — they don't, they only reference `buildAgentPrompt`. No test changes needed except adding the options parameter to calls.

The builder tests call `buildAgentPrompt(params)` without the third arg. With our default `{ strict: false }`, the existing calls continue to work. No test changes needed.

```bash
bun --bun vitest run tests/prompts/builder.test.ts
```

Expected: 11 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/builder.ts
git commit -m "refactor: pass TemplateOptions through buildAgentPrompt, resolve full env"
```

---

### Task 9: Update loader.ts for .hbs files

**Files:**
- Modify: `src/workflow/loader.ts`

- [ ] **Step 1: Add .hbs extension handling**

In `resolveWorkflowSpec`, the current code reads any file with `prompt.file` and stores content. No code change needed — the loader already handles arbitrary file extensions. The `.hbs` extension works identically to `.md` in the loader flow.

However, we should add validation: only `.hbs` and `.md` files (plus the existing any-file behavior for backward compat). Since this is a no-op change, skip to commit.

- [ ] **Step 2: Commit** (no code change needed — loader already reads any file)

```bash
git commit --allow-empty -m "docs: loader already supports .hbs via prompt.file (no code change)"
```

---

### Task 10: Update runner.ts — thread TemplateOptions

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Update imports and function signature**

In `src/workflow/runner.ts`, update the imports (line 3):

```ts
import { buildAgentPrompt } from "../prompts/builder.js"
import type { TemplateOptions } from "../prompts/template.js"
```

Update the `runWorkflow` function signature to accept `templateOptions`:

```ts
export function runWorkflow(
  spec: WorkflowSpec,
  initialParameters: WorkflowEnv,
  config: WorkflowRunnerConfig,
  templateOptions: TemplateOptions,
  existingRunId?: string
): Effect.Effect<WorkflowResult, Error, EventBus | Scope.Scope> {
```

Update the `buildAgentPrompt` call (line 143-150) to pass `templateOptions`:

```ts
const prompt = buildAgentPrompt({
  agentFile: persona.agent,
  soulFile: persona.soul,
  contextTemplate: persona.context,
  prompt: task.agent!.prompt,
  env: taskEnv,
  agentConfig: agent
}, guidelineFiles, templateOptions)
```

- [ ] **Step 2: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "refactor: thread TemplateOptions through runWorkflow"
```

---

### Task 11: Update run.ts — load template config

**Files:**
- Modify: `src/cli/commands/run.ts`

- [ ] **Step 1: Update imports and executeRun**

In `src/cli/commands/run.ts`, add the import:

```ts
import { loadTemplateConfig } from "../../prompts/config.js"
```

In `executeRun`, load the template config before calling `runWorkflow`:

```ts
export function executeRun(params: RunParams): Effect.Effect<RunResult, Error, EventBus | Scope.Scope> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new Error('Hamilton is not initialized. Run "hamilton init" first.')))
    }
    const wfDir = workflowsDir()
    const availableSlugs = yield* _(
      Effect.try({
        try: () => {
          if (!Fs.existsSync(wfDir)) return [] as string[]
          return Fs.readdirSync(wfDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        },
        catch: () => [] as string[]
      }).pipe(Effect.orElseSucceed(() => [] as string[]))
    )

    const activeVariants = params.variants
      ? params.variants.split(",").map(v => v.trim()).filter(v => v.length > 0)
      : []

    const sharedAgentsDir = Path.join(hamiltonHome(), "agents")
    const workflows = discoverWorkflows(wfDir)
    const resolvedSlug = resolveWorkflowSlug(params.workflowSlug, new Set(availableSlugs))
    const spec = yield* loadWorkflowSpec(wfDir, resolvedSlug, sharedAgentsDir, workflows, activeVariants)

    const templateOptions = yield* _(loadTemplateConfig())

    const result = yield* _(
      runWorkflow(spec, { user_input: params.prompt, cwd: process.cwd() }, {
        workflowsDir: wfDir
      }, templateOptions).pipe(
        Effect.tap((r) => Console.log(`\nRun folder: ${runDir(r.runId)}/`))
      )
    )

    return {
      runId: result.runId,
      status: result.status,
      taskResults: result.taskResults
    }
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/commands/run.ts
git commit -m "feat: load template config from settings.yaml in run command"
```

---

### Task 12: Update resume.ts — load template config

**Files:**
- Modify: `src/cli/commands/resume.ts`

- [ ] **Step 1: Update imports and resumeWorkflow**

In `src/cli/commands/resume.ts`, add the import:

```ts
import { loadTemplateConfig } from "../../prompts/config.js"
```

In `resumeWorkflow`, load template config before calling `runWorkflow` and pass it:

```ts
export function resumeWorkflow(runId: string): Effect.Effect<string, ResumeError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new ResumeError({
        runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const db = yield* _(openDb().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const run = getRunById(db, runId)
    if (!run) {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: "Run not found" })))
    }

    if (run.status !== "paused") {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: `Cannot resume run in state "${run.status}"` })))
    }

    const wfDir = Path.join(workflowsDir(), run.workflow_id)
    const ymlPath = Path.join(wfDir, "workflow.yml")
    if (!Fs.existsSync(ymlPath)) {
      db.close()
      return yield* _(Effect.fail(new ResumeError({ runId, message: `Workflow "${run.workflow_id}" not found on disk` })))
    }

    const contextJson = getWorkflowState(db, runId, "context")
    let context: Record<string, unknown> = {}
    if (contextJson) {
      try {
        context = JSON.parse(contextJson)
      } catch {
        context = {}
      }
    }
    context.cwd = process.cwd()
    db.close()

    const sharedAgentsDir = Path.join(hamiltonHome(), "agents")
    const wfBaseDir = workflowsDir()
    const workflowEntries: WorkflowDescriptor[] = Fs.existsSync(wfBaseDir)
      ? Fs.readdirSync(wfBaseDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => ({ name: e.name, dir: Path.join(wfBaseDir, e.name) }))
      : []

    const spec = yield* _(loadWorkflowSpec(wfBaseDir, run.workflow_id, sharedAgentsDir, workflowEntries).pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const templateOptions = yield* _(loadTemplateConfig().pipe(
      Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
    ))

    const result = yield* _(
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          return yield* runWorkflow(spec as unknown as WorkflowSpec, context, {
            workflowsDir: wfDir
          }, templateOptions, runId).pipe(
            Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
          )
        })
      ).pipe(Effect.provide(EventBusLive))
    )

    return `Resumed ${runId}. Status: ${result.status}`
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/commands/resume.ts
git commit -m "feat: load template config from settings.yaml in resume command"
```

---

### Task 13: Update builder tests for TemplateOptions

**Files:**
- Modify: `tests/prompts/builder.test.ts`

- [ ] **Step 1: Update builder tests**

The existing tests call `buildAgentPrompt(params)` or `buildAgentPrompt(params, instructions)` — both work with the new signature since `options` defaults to `{ strict: false }`. However, we should add one explicit test for the new signature:

Append to the test file before the closing `})` of the outer describe:

```ts
  it("passes TemplateOptions through to resolution", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Hello {{name}}" },
      env: { tasks: {}, name: "world" }
    }
    const result = buildAgentPrompt(params, [], { strict: false })
    expect(result.taskPrompt).toBe("Hello world")
  })

  it("defaults TemplateOptions to lenient when not provided", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Hello {{missing}}" },
      env: { tasks: {} }
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toBe("Hello ")
  })
```

- [ ] **Step 2: Run builder tests**

```bash
bun --bun vitest run tests/prompts/builder.test.ts
```

Expected: 13 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/prompts/builder.test.ts
git commit -m "test: add TemplateOptions tests for builder"
```

---

### Task 14: Build and run full test suite

**Files:** None (verification only)

- [ ] **Step 1: Build**

```bash
bun run build
```

Expected: build succeeds with no errors.

- [ ] **Step 2: Run full test suite**

```bash
bun --bun vitest run
```

Expected: all ~155 tests PASS.

- [ ] **Step 3: Commit** (no changes expected — verification only)

---

### Task 15: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark templating as done**

Find the line with `- [ ] Add full fledge templating` and change to `- [x] Add full fledge templating`. Move it from `## Next Up` to `## Completed` at the top of the completed section.

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark templating as complete in ROADMAP"
```
