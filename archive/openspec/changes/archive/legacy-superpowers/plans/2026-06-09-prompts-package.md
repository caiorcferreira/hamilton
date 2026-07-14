# Prompts Package Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract prompt-related code from `src/agent/` and `src/workflow/context.ts` into a dedicated `src/prompts/` package, and unify the executor's prompt interface around a `ResolvablePrompt` type.

**Architecture:** Five focused modules move into `src/prompts/`: template rendering, persona resolution, instruction loading, prompt building, and types. The `PiExecutorConfig` replaces its three prompt fields with a single `prompt: ResolvablePrompt`. All import paths across the codebase update accordingly. Three files are deleted from `src/agent/`.

**Tech Stack:** TypeScript, Effect-TS, vitest, `yaml` package

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/prompts/template.ts` | Create | `resolveTemplate()`, `resolveDottedPath()` |
| `src/prompts/types.ts` | Create | `ResolvablePrompt` type |
| `src/prompts/persona.ts` | Create | `resolvePersona()`, `Persona`, `PersonaNotFoundError` |
| `src/prompts/instructions.ts` | Create | `loadInstructionFiles()`, `parseFrontmatter()`, `scanExtensions()` |
| `src/prompts/builder.ts` | Create | `buildAgentPrompt()`, `PromptParams`, `BuiltPrompt` |
| `src/workflow/context.ts` | Modify | Remove `resolveTemplate`, `resolveDottedPath`; keep `Context`, `mergeContext`, `buildAutoContext` |
| `src/executors/pi/pi-executor.ts` | Modify | Replace `systemPrompt`/`taskPrompt`/`instructionFiles` with `prompt: ResolvablePrompt` |
| `src/workflow/runner.ts` | Modify | Update imports, construct `ResolvablePrompt` for executor |
| `src/mcp/server.ts` | Modify | Update `resolvePersona` import path |
| `src/agent/activity.ts` | Delete | Replaced by `src/prompts/builder.ts` |
| `src/agent/persona.ts` | Delete | Replaced by `src/prompts/persona.ts` |
| `src/agent/instructions.ts` | Delete | Replaced by `src/prompts/instructions.ts` |
| `tests/prompts/template.test.ts` | Create | Tests for `resolveTemplate`, `resolveDottedPath` |
| `tests/prompts/builder.test.ts` | Create | Relocated from `tests/agent/activity.test.ts` |
| `tests/prompts/persona.test.ts` | Create | Relocated from `tests/agent/persona.test.ts` |
| `tests/prompts/instructions.test.ts` | Create | Relocated from `tests/agent/instructions.test.ts` |
| `tests/workflow/context.test.ts` | Modify | Remove `resolveTemplate`, `resolveDottedPath` tests |
| `tests/workflow/deterministic-activities.test.ts` | Modify | Update `resolvePersona` import path |
| `tests/agent/activity.test.ts` | Delete | Replaced by `tests/prompts/builder.test.ts` |
| `tests/agent/persona.test.ts` | Delete | Replaced by `tests/prompts/persona.test.ts` |
| `tests/agent/instructions.test.ts` | Delete | Replaced by `tests/prompts/instructions.test.ts` |

---

### Task 1: Create `src/prompts/template.ts`

**Files:**
- Create: `src/prompts/template.ts`
- Create: `tests/prompts/template.test.ts`

- [ ] **Step 1: Create the module**

Create `src/prompts/template.ts`:

```ts
import type { Context } from "../workflow/context.js"

export function resolveDottedPath(context: Context, path: string): unknown {
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

export function resolveTemplate(template: string, context: Context): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
    const value = resolveDottedPath(context, key)
    if (value === undefined) return match
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}
```

- [ ] **Step 2: Create the test file**

Create `tests/prompts/template.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { resolveDottedPath, resolveTemplate } from "../../src/prompts/template.js"

describe("resolveDottedPath", () => {
  it("resolves a simple path", () => {
    const ctx = { plan: { outputs: { user_stories: ["a", "b"] } } }
    expect(resolveDottedPath(ctx, "plan.outputs.user_stories")).toEqual(["a", "b"])
  })

  it("resolves tasks.plan.outputs", () => {
    const ctx = { tasks: { plan: { outputs: { status: "done" } } } }
    expect(resolveDottedPath(ctx, "tasks.plan.outputs.status")).toBe("done")
  })

  it("resolves agents.planner", () => {
    const ctx = { agents: { planner: { role: "analysis" } } }
    expect(resolveDottedPath(ctx, "agents.planner.role")).toBe("analysis")
  })

  it("resolves vars.user_story", () => {
    const ctx = { vars: { user_story: { id: "US-001", title: "Foo" } } }
    expect(resolveDottedPath(ctx, "vars.user_story.id")).toBe("US-001")
  })

  it("returns undefined for missing path", () => {
    const ctx = { plan: { outputs: {} } }
    expect(resolveDottedPath(ctx, "plan.outputs.nonexistent")).toBeUndefined()
  })

  it("returns first-level key", () => {
    const ctx = { key: "value" }
    expect(resolveDottedPath(ctx, "key")).toBe("value")
  })
})

describe("resolveTemplate", () => {
  it("replaces {{key}} with context values", () => {
    expect(resolveTemplate("Hello {{name}}!", { name: "world" })).toBe("Hello world!")
  })

  it("keeps unreplaced templates intact", () => {
    expect(resolveTemplate("Hello {{name}}!", {})).toBe("Hello {{name}}!")
  })

  it("replaces multiple templates", () => {
    expect(resolveTemplate("{{a}} and {{b}}", { a: "1", b: "2" })).toBe("1 and 2")
  })

  it("stringifies non-string values", () => {
    expect(resolveTemplate("Items: {{items}}", { items: [1, 2, 3] })).toBe("Items: [1,2,3]")
  })

  it("stringifies objects", () => {
    expect(resolveTemplate("Context: {{ctx}}", { ctx: { plan: { status: "done" } } }))
      .toBe('Context: {"plan":{"status":"done"}}')
  })

  it("resolves dotted-path placeholders", () => {
    const ctx = {
      tasks: {
        setup: { outputs: { repo: "/tmp/repo", branch: "feature/x", build_cmd: "npm run build" } },
        plan: { outputs: { stories_json: [{ id: "US-001" }] } }
      }
    }
    expect(resolveTemplate("REPO: {{tasks.setup.outputs.repo}}", ctx)).toBe("REPO: /tmp/repo")
    expect(resolveTemplate("BRANCH: {{tasks.setup.outputs.branch}}", ctx)).toBe("BRANCH: feature/x")
    expect(resolveTemplate("BUILD: {{tasks.setup.outputs.build_cmd}}", ctx)).toBe("BUILD: npm run build")
    expect(resolveTemplate("STORIES: {{tasks.plan.outputs.stories_json}}", ctx))
      .toBe('STORIES: [{"id":"US-001"}]')
  })

  it("resolves vars from forEach vars", () => {
    const ctx = { vars: { current_story: { id: "US-001", title: "Add feature" } } }
    expect(resolveTemplate("STORY: {{vars.current_story}}", ctx))
      .toBe('STORY: {"id":"US-001","title":"Add feature"}')
    expect(resolveTemplate("ID: {{vars.current_story.id}}", ctx)).toBe("ID: US-001")
    expect(resolveTemplate("TITLE: {{vars.current_story.title}}", ctx)).toBe("TITLE: Add feature")
  })

  it("resolves multi-level dotted path", () => {
    const ctx = { tasks: { setup: { outputs: { repo: { url: "github.com/x" } } } } }
    expect(resolveTemplate("URL: {{tasks.setup.outputs.repo.url}}", ctx)).toBe("URL: github.com/x")
  })

  it("keeps unreplaced template with dotted path intact", () => {
    expect(resolveTemplate("MISSING: {{tasks.nonexistent.field}}", {})).toBe("MISSING: {{tasks.nonexistent.field}}")
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `bun --bun vitest run tests/prompts/template.test.ts`
Expected: All 16 tests pass

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: Exit 0

- [ ] **Step 5: Commit**

```bash
git add src/prompts/template.ts tests/prompts/template.test.ts
git commit -m "feat: create prompts/template module with resolveTemplate and resolveDottedPath"
```

---

### Task 2: Create `src/prompts/types.ts`

**Files:**
- Create: `src/prompts/types.ts`

- [ ] **Step 1: Create the module**

Create `src/prompts/types.ts`:

```ts
export interface ResolvablePrompt {
  systemPrompt: string
  taskPrompt: string
  instructionFiles: Array<{ name: string; content: string }>
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build`

- [ ] **Step 3: Commit**

```bash
git add src/prompts/types.ts
git commit -m "feat: add ResolvablePrompt type to prompts package"
```

---

### Task 3: Create `src/prompts/persona.ts`

**Files:**
- Create: `src/prompts/persona.ts`
- Create: `tests/prompts/persona.test.ts`

- [ ] **Step 1: Create the module**

Create `src/prompts/persona.ts` (identical logic to `src/agent/persona.ts`, just moved):

```ts
import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { SystemPromptPaths } from "../types.js"

export interface Persona {
  agent: string
  soul: string
  identity: string
}

export class PersonaNotFoundError extends Data.TaggedError("PersonaNotFoundError")<{
  agentPath: string
}> {}

function tryReadOptional(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

export function resolvePersona(
  paths: SystemPromptPaths,
  workflowDir: string
): Effect.Effect<Persona, PersonaNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(workflowDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.agent), "utf-8"),
        catch: () => new PersonaNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = tryReadOptional(resolvePath(paths.soul))
    const identity = tryReadOptional(resolvePath(paths.identity))

    return { agent, soul, identity }
  })
}
```

- [ ] **Step 2: Create the test file**

Create `tests/prompts/persona.test.ts` (identical logic to `tests/agent/persona.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { resolvePersona, PersonaNotFoundError } from "../../src/prompts/persona.js"

describe("resolvePersona", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-persona-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("resolves persona from paths", async () => {
    Fs.writeFileSync(Path.join(tmpDir, "agent.md"), "agent instructions")
    Fs.writeFileSync(Path.join(tmpDir, "soul.md"), "soul content")
    Fs.writeFileSync(Path.join(tmpDir, "identity.md"), "identity content")

    const paths = {
      agent: "agent.md",
      soul: "soul.md",
      identity: "identity.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, tmpDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent).toBe("agent instructions")
      expect(exit.value.soul).toBe("soul content")
      expect(exit.value.identity).toBe("identity content")
    }
  })

  it("returns empty string for missing soul and identity files", async () => {
    Fs.writeFileSync(Path.join(tmpDir, "agent.md"), "agent instructions")

    const paths = {
      agent: "agent.md",
      soul: "no-soul.md",
      identity: "no-identity.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, tmpDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent).toBe("agent instructions")
      expect(exit.value.soul).toBe("")
      expect(exit.value.identity).toBe("")
    }
  })

  it("fails with PersonaNotFoundError for missing agent file", async () => {
    const paths = {
      agent: "nonexistent.md",
      soul: "soul.md",
      identity: "identity.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, tmpDir))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("resolves shared agent through symlink", async () => {
    const sharedAgentsDir = Path.join(tmpDir, "agents")
    Fs.mkdirSync(Path.join(sharedAgentsDir, "setup"), { recursive: true })
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "AGENTS.md"), "shared setup agent")
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "SOUL.md"), "shared setup soul")
    Fs.writeFileSync(Path.join(sharedAgentsDir, "setup", "IDENTITY.md"), "shared setup identity")

    const workflowDir = Path.join(tmpDir, "workflows", "test-wf")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.symlinkSync(sharedAgentsDir, Path.join(sharedDir, "agents"), "dir")

    const paths = {
      agent: "shared/agents/setup/AGENTS.md",
      soul: "shared/agents/setup/SOUL.md",
      identity: "shared/agents/setup/IDENTITY.md"
    }

    const exit = await Effect.runPromiseExit(resolvePersona(paths, workflowDir))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.agent).toBe("shared setup agent")
      expect(exit.value.soul).toBe("shared setup soul")
      expect(exit.value.identity).toBe("shared setup identity")
    }
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun --bun vitest run tests/prompts/persona.test.ts`
Expected: All 4 tests pass

- [ ] **Step 4: Verify build**

Run: `bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/prompts/persona.ts tests/prompts/persona.test.ts
git commit -m "feat: create prompts/persona module"
```

---

### Task 4: Create `src/prompts/instructions.ts`

**Files:**
- Create: `src/prompts/instructions.ts`
- Create: `tests/prompts/instructions.test.ts`

- [ ] **Step 1: Create the module**

Create `src/prompts/instructions.ts` (identical logic to `src/agent/instructions.ts`):

```ts
import { Effect } from "effect"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { instructionDir } from "../paths.js"

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".hamilton"])

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return null
  try {
    const frontmatter = Yaml.parse(match[1]) as Record<string, unknown>
    return { frontmatter, body: match[2] }
  } catch {
    return null
  }
}

function scanExtensions(cwd: string): string[] {
  const extensions = new Set<string>()
  try {
    const entries = Fs.readdirSync(cwd, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
      if (entry.isDirectory()) {
        for (const ext of scanExtensions(Path.join(cwd, entry.name))) {
          extensions.add(ext)
        }
      } else if (entry.isFile()) {
        const ext = Path.extname(entry.name)
        if (ext) extensions.add(ext)
      }
    }
  } catch {
  }
  return Array.from(extensions)
}

export function loadInstructionFiles(cwd: string): Effect.Effect<Array<{name: string; content: string}>, never> {
  return Effect.sync(() => {
    const dir = instructionDir()
    if (!Fs.existsSync(dir)) return []

    const projectExtensions = new Set(scanExtensions(cwd))
    if (projectExtensions.size === 0) return []

    const results: Array<{name: string; content: string}> = []
    let entries: Fs.Dirent[]
    try {
      entries = Fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const filePath = Path.join(dir, entry.name)
      let raw: string
      try {
        raw = Fs.readFileSync(filePath, "utf-8")
      } catch {
        continue
      }
      const parsed = parseFrontmatter(raw)
      if (!parsed) continue

      const name = parsed.frontmatter.name as string | undefined
      const extensions = parsed.frontmatter.extensions as string[] | undefined
      if (!name || !Array.isArray(extensions)) continue

      const matches = extensions.some((ext) => projectExtensions.has(ext))
      if (matches) {
        results.push({ name, content: parsed.body })
      }
    }

    return results
  })
}
```

- [ ] **Step 2: Create the test file**

Create `tests/prompts/instructions.test.ts` (identical logic to `tests/agent/instructions.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadInstructionFiles } from "../../src/prompts/instructions.js"

describe("loadInstructionFiles", () => {
  let tmpHome: string
  let tmpProject: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-instr-home-"))
    tmpProject = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-instr-proj-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
    Fs.rmSync(tmpProject, { recursive: true, force: true })
  })

  it("returns empty array when instruction dir does not exist", async () => {
    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("returns empty array when project has no matching extensions", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\", \".tsx\"]",
      "---",
      "TypeScript conventions here."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "readme.txt"), "hello")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("loads matching instruction file when extension matches", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\", \".tsx\"]",
      "---",
      "TypeScript conventions here."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "console.log('hi')")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].name).toBe("TypeScript")
      expect(exit.value[0].content).toContain("TypeScript conventions here.")
    }
  })

  it("loads multiple matching instruction files", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\", \".tsx\"]",
      "---",
      "TS content."
    ].join("\n"))
    Fs.writeFileSync(Path.join(instrDir, "python.md"), [
      "---",
      "name: Python",
      "extensions: [\".py\"]",
      "---",
      "Python content."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "ts")
    Fs.writeFileSync(Path.join(tmpProject, "main.py"), "py")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2)
    }
  })

  it("skips instruction files with invalid or missing frontmatter", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "bad.md"), "no frontmatter here")

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "ts")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("skips node_modules, .git, dist, build directories", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\"]",
      "---",
      "TS content."
    ].join("\n"))

    const nmDir = Path.join(tmpProject, "node_modules")
    Fs.mkdirSync(nmDir, { recursive: true })
    Fs.writeFileSync(Path.join(nmDir, "dep.ts"), "ts in node_modules")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("scans nested directories for extensions", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\"]",
      "---",
      "TS content."
    ].join("\n"))

    const srcDir = Path.join(tmpProject, "src")
    Fs.mkdirSync(srcDir, { recursive: true })
    Fs.writeFileSync(Path.join(srcDir, "main.ts"), "ts")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
    }
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun --bun vitest run tests/prompts/instructions.test.ts`
Expected: All 7 tests pass

- [ ] **Step 4: Verify build**

Run: `bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/prompts/instructions.ts tests/prompts/instructions.test.ts
git commit -m "feat: create prompts/instructions module"
```

---

### Task 5: Create `src/prompts/builder.ts`

**Files:**
- Create: `src/prompts/builder.ts`
- Create: `tests/prompts/builder.test.ts`

- [ ] **Step 1: Create the module**

Create `src/prompts/builder.ts`:

```ts
import type { Prompt, WorkflowAgent } from "../types.js"
import type { Context } from "../workflow/context.js"
import { resolveTemplate } from "./template.js"

export interface PromptParams {
  agentFile: string
  soulFile: string
  identityFile: string
  prompt: Prompt
  context: Context
  agentConfig: Partial<WorkflowAgent>
}

export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
  instructionFiles: Array<{ name: string; content: string }>
}

export function buildAgentPrompt(
  params: PromptParams,
  instructionFiles: Array<{ name: string; content: string }> = []
): BuiltPrompt {
  const systemParts: string[] = []

  if (params.identityFile) {
    systemParts.push(`<identity>\n${params.identityFile}\n</identity>`)
  }

  if (params.soulFile) {
    systemParts.push(`<style>\n${params.soulFile}\n</style>`)
  }

  if (Object.keys(params.context).length > 0) {
    const contextJson = JSON.stringify(params.context, null, 2)
    systemParts.push(`<context>\n${contextJson}\n</context>`)
  }

  systemParts.push(`<harness>
# Hamilton Workflow

You are executing a task within a Hamilton workflow. A workflow is a sequence of tasks
that pass context between them. Your job is to complete one task and save your result.

### How to finish your task

When you have completed your work, call the write_step_output tool with a JSON object
containing your results. The object MUST include a "status" field (string) indicating
your completion state. Other fields are freeform and will be passed as context to
subsequent tasks.

IMPORTANT:
- You MUST call write_step_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
</harness>`)

  systemParts.push(`<agent>${params.agentFile}</agent>`)

  const resolvedInput = resolveTemplate(params.prompt.content ?? "", params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: resolvedInput,
    instructionFiles
  }
}
```

- [ ] **Step 2: Create the test file**

Create `tests/prompts/builder.test.ts` (adapted from `tests/agent/activity.test.ts`):

```ts
import { describe, it, expect } from "vitest"
import {
  buildAgentPrompt,
  PromptParams
} from "../../src/prompts/builder.js"

describe("buildAgentPrompt", () => {
  const baseParams: PromptParams = {
    agentFile: "You are a coder.",
    soulFile: "",
    identityFile: "",
    prompt: { content: "Fix the bug" },
    context: {},
    agentConfig: {}
  }

  it("returns systemPrompt and taskPrompt", () => {
    const params: PromptParams = {
      agentFile: "You are a coder.",
      identityFile: "Senior Developer",
      soulFile: "Concise and direct",
      prompt: { content: "Fix the bug" },
      context: {},
      agentConfig: { name: "coder", role: "coding" }
    }
    const result = buildAgentPrompt(params)
    expect(result).toHaveProperty("systemPrompt")
    expect(result).toHaveProperty("taskPrompt")
    expect(result.systemPrompt).toContain("<identity>\nSenior Developer\n</identity>")
    expect(result.systemPrompt).toContain("<style>\nConcise and direct\n</style>")
    expect(result.systemPrompt).toContain("<agent>You are a coder.</agent>")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("resolves template expressions in the task prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Fix bug in {{repo}}" },
      context: { repo: "hamilton" }
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain("Fix bug in hamilton")
  })

  it("resolves non-string template values as JSON", () => {
    const params: PromptParams = {
      ...baseParams,
      prompt: { content: "Stories: {{stories_json}}" },
      context: { stories_json: [{ id: "US-001", title: "Add thing" }] }
    }
    const result = buildAgentPrompt(params)
    expect(result.taskPrompt).toContain('Stories: [{"id":"US-001","title":"Add thing"}]')
  })

  it("includes context as JSON in the system prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      context: { branch: "main", status: "approved" }
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain("<context>")
    expect(result.systemPrompt).toContain('"branch": "main"')
    expect(result.systemPrompt).toContain('"status": "approved"')
  })

  it("includes structured context as JSON in the system prompt", () => {
    const params: PromptParams = {
      ...baseParams,
      context: { stories_json: [{ id: "1", title: "Story" }] }
    }
    const result = buildAgentPrompt(params)
    expect(result.systemPrompt).toContain('"stories_json"')
    expect(result.systemPrompt).toContain('"Story"')
  })

  it("omits identity and style sections when empty", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).not.toContain("<identity>")
    expect(result.systemPrompt).not.toContain("<style>")
    expect(result.taskPrompt).toContain("Fix the bug")
  })

  it("uses task terminology in harness", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.systemPrompt).toContain("task within a Hamilton workflow")
    expect(result.systemPrompt).toContain("finish your task")
  })

  it("passes instructionFiles through to BuiltPrompt", () => {
    const instructions = [{ name: "typescript", content: "Use strict mode" }]
    const result = buildAgentPrompt(baseParams, instructions)
    expect(result.instructionFiles).toEqual(instructions)
  })

  it("defaults instructionFiles to empty array", () => {
    const result = buildAgentPrompt(baseParams)
    expect(result.instructionFiles).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun --bun vitest run tests/prompts/builder.test.ts`
Expected: All 9 tests pass (7 existing + 2 new for instructionFiles)

- [ ] **Step 4: Verify build**

Run: `bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/prompts/builder.ts tests/prompts/builder.test.ts
git commit -m "feat: create prompts/builder module with BuiltPrompt including instructionFiles"
```

---

### Task 6: Update `PiExecutorConfig` to use `ResolvablePrompt`

**Files:**
- Modify: `src/executors/pi/pi-executor.ts`

- [ ] **Step 1: Add import and change the config interface**

In `src/executors/pi/pi-executor.ts`:

Add after line 20 (`import { stepOutputFile } from "../../paths.js"`):
```ts
import type { ResolvablePrompt } from "../../prompts/types.js"
```

Change `PiExecutorConfig` from:
```ts
export interface PiExecutorConfig {
  systemPrompt: string
  taskPrompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  cwd?: string
  extensions?: Array<unknown>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[] | null
    retryOnTransient?: boolean
    compactionEnabled?: boolean
  }
  outputSchema?: Record<string, unknown>
  instructionFiles?: Array<{name: string; content: string}>
}
```
to:
```ts
export interface PiExecutorConfig {
  prompt: ResolvablePrompt
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  cwd?: string
  extensions?: Array<unknown>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[] | null
    retryOnTransient?: boolean
    compactionEnabled?: boolean
  }
  outputSchema?: Record<string, unknown>
}
```

- [ ] **Step 2: Update executor body to destructure from config.prompt**

In `executeWithPi()`, after `const thinkingLevel = mapThinkingLevel(config.settings?.thinking)` (line 106), add:

```ts
    const { systemPrompt, taskPrompt, instructionFiles } = config.prompt
```

Change line 114 from:
```ts
      systemPromptOverride: () => config.systemPrompt,
```
to:
```ts
      systemPromptOverride: () => systemPrompt,
```

Change lines 116-119 from:
```ts
      agentsFilesOverride: (current: any) => ({
        agentsFiles: [
          ...(current?.agentsFiles ?? []),
          ...(config.instructionFiles ?? []).map((f: {name: string; content: string}) => ({ path: f.name, content: f.content }))
        ]
      }),
```
to:
```ts
      agentsFilesOverride: (current: any) => ({
        agentsFiles: [
          ...(current?.agentsFiles ?? []),
          ...instructionFiles.map((f: {name: string; content: string}) => ({ path: f.name, content: f.content }))
        ]
      }),
```

Change line 187 from:
```ts
      yield* _(Effect.promise(() => session.prompt(config.taskPrompt)))
```
to:
```ts
      yield* _(Effect.promise(() => session.prompt(taskPrompt)))
```

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: Build will fail in runner.ts (expected — we fix that in Task 7)

- [ ] **Step 4: Commit**

```bash
git add src/executors/pi/pi-executor.ts
git commit -m "refactor: PiExecutorConfig uses ResolvablePrompt instead of separate fields"
```

---

### Task 7: Update runner.ts imports and executor call

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Replace imports**

Change line 3 from:
```ts
import { buildAgentPrompt } from "../agent/activity.js"
```
to:
```ts
import { buildAgentPrompt } from "../prompts/builder.js"
```

Change line 5 from:
```ts
import { resolvePersona } from "../agent/persona.js"
```
to:
```ts
import { resolvePersona } from "../prompts/persona.js"
```

Change line 23 from:
```ts
import { loadInstructionFiles } from "../agent/instructions.js"
```
to:
```ts
import { loadInstructionFiles } from "../prompts/instructions.js"
```

- [ ] **Step 2: Update buildAgentPrompt call and executeWithPi call**

In `executeSingleTask`, change the `buildAgentPrompt` call (lines 108-115) from:
```ts
        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          identityFile: persona.identity,
          prompt: task.agent!.prompt,
          context: taskContext,
          agentConfig: agent
        })
```
to:
```ts
        const prompt = buildAgentPrompt({
          agentFile: persona.agent,
          soulFile: persona.soul,
          identityFile: persona.identity,
          prompt: task.agent!.prompt,
          context: taskContext,
          agentConfig: agent
        }, instructionFiles)
```

Change the `executeWithPi` call (lines 130-146) from:
```ts
        const output = yield* _(
          executeWithPi({
            systemPrompt: prompt.systemPrompt,
            taskPrompt: prompt.taskPrompt,
            stepId: taskId,
            agentId: agent.name,
            runId,
            timeoutSeconds,
            model: resolved.model,
            outputSchema: outputSchema?.content,
            instructionFiles,
            settings: {
```
to:
```ts
        const output = yield* _(
          executeWithPi({
            prompt,
            stepId: taskId,
            agentId: agent.name,
            runId,
            timeoutSeconds,
            model: resolved.model,
            outputSchema: outputSchema?.content,
            settings: {
```

No `instructionFiles` in the settings block — it's now inside `prompt`.

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: Exit 0

- [ ] **Step 4: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "refactor: update runner to use prompts package and ResolvablePrompt"
```

---

### Task 8: Update all remaining importers

**Files:**
- Modify: `src/mcp/server.ts:6`
- Modify: `src/workflow/context.ts`
- Modify: `tests/workflow/deterministic-activities.test.ts:7`

- [ ] **Step 1: Update `src/mcp/server.ts`**

Change line 6 from:
```ts
import { resolvePersona } from "../agent/persona.js"
```
to:
```ts
import { resolvePersona } from "../prompts/persona.js"
```

- [ ] **Step 2: Update `src/workflow/context.ts`**

Remove `resolveDottedPath` and `resolveTemplate` functions (lines 5-22), leaving only:

```ts
import type { WorkflowTask } from "../types.js"

export type Context = Record<string, unknown>

export function mergeContext(existing: Context, incoming: Context): Context {
  return { ...existing, ...incoming }
}

export function buildAutoContext(
  task: WorkflowTask,
  allOutputs: Context,
  vars: Context
): Context {
  if (task.context) {
    const result: Context = {}
    for (const field of task.context.fields) {
      const ref = field.valueFrom.ref
      if (ref.startsWith("vars.")) {
        result[field.name] = resolveDottedPath({ vars }, ref)
      } else {
        result[field.name] = resolveDottedPath(allOutputs, ref)
      }
    }
    return result
  }
  return { ...allOutputs, ...vars }
}
```

Wait — `buildAutoContext` uses `resolveDottedPath`. It needs to import it from the prompts package now. Add at the top:

```ts
import { resolveDottedPath } from "../prompts/template.js"
```

So the full file becomes:

```ts
import type { WorkflowTask } from "../types.js"
import { resolveDottedPath } from "../prompts/template.js"

export type Context = Record<string, unknown>

export function mergeContext(existing: Context, incoming: Context): Context {
  return { ...existing, ...incoming }
}

export function buildAutoContext(
  task: WorkflowTask,
  allOutputs: Context,
  vars: Context
): Context {
  if (task.context) {
    const result: Context = {}
    for (const field of task.context.fields) {
      const ref = field.valueFrom.ref
      if (ref.startsWith("vars.")) {
        result[field.name] = resolveDottedPath({ vars }, ref)
      } else {
        result[field.name] = resolveDottedPath(allOutputs, ref)
      }
    }
    return result
  }
  return { ...allOutputs, ...vars }
}
```

- [ ] **Step 3: Update `tests/workflow/deterministic-activities.test.ts`**

Change line 7 from:
```ts
import { resolvePersona } from "../../src/agent/persona.js"
```
to:
```ts
import { resolvePersona } from "../../src/prompts/persona.js"
```

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: Exit 0

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/workflow/context.ts tests/workflow/deterministic-activities.test.ts
git commit -m "refactor: update remaining imports to use prompts package"
```

---

### Task 9: Update `tests/workflow/context.test.ts`

**Files:**
- Modify: `tests/workflow/context.test.ts`

- [ ] **Step 1: Remove resolveDottedPath and resolveTemplate tests**

Remove the entire `describe("resolveDottedPath", ...)` block (lines 5-35) and both `describe("resolveTemplate", ...)` blocks (lines 37-93). Also remove `resolveDottedPath` and `resolveTemplate` from the import on line 2.

The import line becomes:
```ts
import { mergeContext, buildAutoContext } from "../../src/workflow/context.js"
```

- [ ] **Step 2: Run remaining context tests**

Run: `bun --bun vitest run tests/workflow/context.test.ts`
Expected: 5 tests pass (mergeContext: 3 + buildAutoContext: 2... wait, buildAutoContext has 4 tests. Re-check: mergeContext 3 + buildAutoContext 4 = 7 remaining tests)

- [ ] **Step 3: Commit**

```bash
git add tests/workflow/context.test.ts
git commit -m "refactor: remove resolveTemplate/resolveDottedPath tests from context test"
```

---

### Task 10: Delete old files

**Files:**
- Delete: `src/agent/activity.ts`
- Delete: `src/agent/persona.ts`
- Delete: `src/agent/instructions.ts`
- Delete: `tests/agent/activity.test.ts`
- Delete: `tests/agent/persona.test.ts`
- Delete: `tests/agent/instructions.test.ts`

- [ ] **Step 1: Verify no remaining imports reference the old paths**

Run: `grep -rn 'from.*agent/activity\|from.*agent/persona\|from.*agent/instructions' src/ tests/`
Expected: No output (all references updated in prior tasks)

- [ ] **Step 2: Delete the files**

```bash
rm src/agent/activity.ts src/agent/persona.ts src/agent/instructions.ts
rm tests/agent/activity.test.ts tests/agent/persona.test.ts tests/agent/instructions.test.ts
```

- [ ] **Step 3: Verify build and full test suite**

Run: `bun run build && bun --bun vitest run`
Expected: Build exit 0, all tests pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete old agent/activity, agent/persona, agent/instructions and their tests"
```

---

### Task 11: Final verification

**Files:**
- (none — verification only)

- [ ] **Step 1: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All tests pass (should be same count as before refactor — no tests added/removed, just moved)

- [ ] **Step 2: Verify build**

```bash
bun run build
```

Expected: Exit 0

- [ ] **Step 3: Verify no stale imports**

```bash
grep -rn 'from.*agent/activity\|from.*agent/persona\|from.*agent/instructions' src/ tests/ || echo "CLEAN"
```

Expected: "CLEAN"