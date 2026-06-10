# Guidelines Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename "instructions" to "guidelines", add YAML-based guideline manifests with tool-call interception rules, and wire guidelines into the workflow runner and Pi executor.

**Architecture:** Guidelines are K8S-style YAML manifests (`guideline.yml`) in `~/.hamilton/guidelines/<name>/`. A loader parses them, returning instruction markdown files (extension-matched, injected as workspace files) and rule definitions (regex patterns matched against tool call input). A single `tool_call` listener evaluates all rules and blocks violating tool calls, injecting the rule reason as a system message. Instruction files continue to flow through the prompt builder; rules flow through a new Pi extension registered at executor time.

**Tech Stack:** TypeScript, bun, Effect-TS 3.21.3, Pi SDK 0.78.1, @effect/schema, vitest, yaml

---

### Task 1: Types and paths infrastructure

**Files:**
- Create: `src/guidelines/types.ts`
- Modify: `src/paths.ts:54-56`
- Modify: `src/paths.ts:79-94`

- [ ] **Step 1: Write types file**

Create `src/guidelines/types.ts`:

```typescript
export interface GuidelineRule {
  name: string
  toolNames: string[]
  target: "command" | "path" | "input"
  pattern: string
  reason: string
}

export interface CompiledRule extends GuidelineRule {
  compiledPattern: RegExp
}

export interface GuidelineInstructions {
  extensions: string[]
  files: string[]
}

export interface GuidelineSpec {
  instructions?: GuidelineInstructions
  rules?: GuidelineRule[]
}

export interface LoadedGuideline {
  name: string
  instructions: Array<{ name: string; content: string }> | null
  rules: CompiledRule[] | null
}

export interface RuleMatch {
  ruleName: string
  reason: string
  matchedValue: string
}
```

- [ ] **Step 2: Rename `instructionDir()` to `guidelinesDir()` in paths**

In `src/paths.ts`, replace the `instructionDir` function:

```typescript
export function guidelinesDir(): string {
  return Path.join(hamiltonHome(), "guidelines")
}
```

- [ ] **Step 3: Add `guidelinesDir()` to `ensureHamiltonHome()`**

In `src/paths.ts`, inside `ensureHamiltonHome()`, replace `instructionDir()` with `guidelinesDir()`:

```typescript
export function ensureHamiltonHome(): void {
  const dirs = [
    hamiltonHome(),
    agentsDir(),
    workflowsDir(),
    runsDir(),
    Path.join(hamiltonHome(), "executors", "pi", "agent"),
    guidelinesDir(),
    skillsDir()
  ]
  for (const dir of dirs) {
    if (!Fs.existsSync(dir)) {
      Fs.mkdirSync(dir, { recursive: true })
    }
  }
}
```

- [ ] **Step 4: Run build to verify no breakage yet**

```bash
bun run build
```
Expected: PASS (nothing imports the new types or paths yet)

- [ ] **Step 5: Commit**

```bash
git add src/guidelines/types.ts src/paths.ts
git commit -m "feat: add guideline types and rename instructionDir to guidelinesDir"
```

---

### Task 2: Guideline spec schema

**Files:**
- Modify: `src/schemas.ts:10,17-21,23-28,163-169`

- [ ] **Step 1: Add Guideline metadata schema and update KindSchema**

In `src/schemas.ts`, change line 10:

```typescript
const KindSchema = Schema.Literal("Agent", "Workflow", "Guideline")
```

Add after line 21:

```typescript
const GuidelineMetadataSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String)
})
```

Update `ManifestEnvelopeSchema` metadata union (line 27):

```typescript
const ManifestEnvelopeSchema = Schema.Struct({
  apiVersion: ApiVersionSchema,
  kind: KindSchema,
  metadata: Schema.Union(AgentMetadataSchema, WorkflowMetadataSchema, GuidelineMetadataSchema)
})
```

- [ ] **Step 2: Add GuidelineSpecSchema**

Add after the `WorkflowSpecSchema` (before `parseManifest`):

```typescript
const GuidelineRuleSchema = Schema.Struct({
  name: Schema.String,
  toolNames: Schema.Array(Schema.String),
  target: Schema.Literal("command", "path", "input"),
  pattern: Schema.String,
  reason: Schema.String
})

const GuidelineInstructionsSchema = Schema.Struct({
  extensions: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String)
})

export const GuidelineSpecSchema = Schema.Struct({
  apiVersion: Schema.Literal("dag.hamilton.io/v1alpha1"),
  kind: Schema.Literal("Guideline"),
  metadata: GuidelineMetadataSchema,
  spec: Schema.Struct({
    instructions: Schema.optional(GuidelineInstructionsSchema),
    rules: Schema.optional(Schema.Array(GuidelineRuleSchema))
  })
})
```

- [ ] **Step 3: Update `parseManifest` to handle Guideline kind**

In `src/schemas.ts`, update `parseManifest` function:

```typescript
export function parseManifest(raw: unknown): any {
  const envelope = Schema.decodeUnknownSync(ManifestEnvelopeSchema)(raw)
  if (envelope.kind === "Agent") {
    return Schema.decodeUnknownSync(AgentManifestSchema)(raw)
  }
  if (envelope.kind === "Guideline") {
    return Schema.decodeUnknownSync(GuidelineSpecSchema)(raw)
  }
  return Schema.decodeUnknownSync(WorkflowSpecSchema)(raw)
}
```

- [ ] **Step 4: Run build**

```bash
bun run build
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts
git commit -m "feat: add GuidelineSpecSchema to manifest validation"
```

---

### Task 3: Guideline loader

**Files:**
- Create: `src/guidelines/loader.ts`
- Create: `tests/guidelines/loader.test.ts`

- [ ] **Step 1: Write the failing loader test**

Create `tests/guidelines/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadGuidelines } from "../../src/guidelines/loader.js"

describe("loadGuidelines", () => {
  let tmpHome: string
  let tmpProject: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guide-home-"))
    tmpProject = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guide-proj-"))
    process.env.HOME = tmpHome
    vi.stubEnv("HOME", tmpHome)
  })

  afterEach(() => {
    process.env.HOME = originalHome
    vi.unstubAllEnvs()
    Fs.rmSync(tmpHome, { recursive: true, force: true })
    Fs.rmSync(tmpProject, { recursive: true, force: true })
  })

  function writeGuideline(name: string, yml: string) {
    const dir = Path.join(tmpHome, ".hamilton", "guidelines", name)
    Fs.mkdirSync(dir, { recursive: true })
    Fs.writeFileSync(Path.join(dir, "guideline.yml"), yml)
    return dir
  }

  it("returns empty array when guidelines dir does not exist", async () => {
    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("returns empty array for empty guidelines directory", async () => {
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "guidelines"), { recursive: true })
    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("loads a guideline with rules only", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm in this repo."
    ].join("\n"))

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].name).toBe("js-standards")
      expect(exit.value[0].instructions).toBeNull()
      expect(exit.value[0].rules).toHaveLength(1)
      expect(exit.value[0].rules![0].name).toBe("no-npm")
      expect(exit.value[0].rules![0].compiledPattern).toBeInstanceOf(RegExp)
    }
  })

  it("loads a guideline with instructions matching project extensions", async () => {
    const dir = writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts", ".js"]',
      "    files:",
      "    - code-style.md"
    ].join("\n"))
    Fs.writeFileSync(Path.join(dir, "code-style.md"), "Use const over let.")

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "console.log('hi')")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toHaveLength(1)
      expect(exit.value[0].instructions![0].name).toBe("js-standards")
      expect(exit.value[0].instructions![0].content).toBe("Use const over let.")
    }
  })

  it("skips instructions when no project extensions overlap", async () => {
    const dir = writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts", ".js"]',
      "    files:",
      "    - code-style.md"
    ].join("\n"))
    Fs.writeFileSync(Path.join(dir, "code-style.md"), "Use const over let.")

    Fs.writeFileSync(Path.join(tmpProject, "main.py"), "print('hi')")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toBeNull()
    }
  })

  it("always loads rules regardless of project extensions", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts", ".js"]',
      "    files:",
      "    - code-style.md",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "main.py"), "print('hi')")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toBeNull()
      expect(exit.value[0].rules).toHaveLength(1)
    }
  })

  it("skips directory without guideline.yml silently", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm."
    ].join("\n"))

    const emptyDir = Path.join(tmpHome, ".hamilton", "guidelines", "empty")
    Fs.mkdirSync(emptyDir, { recursive: true })

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].name).toBe("js-standards")
    }
  })

  it("skips guideline with invalid YAML", async () => {
    writeGuideline("bad", "not: [valid: yaml")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("skips rule with invalid regex", async () => {
    writeGuideline("bad-regex", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: bad-regex",
      "spec:",
      "  rules:",
      "  - name: broken",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "[invalid"',
      "    reason: bad pattern"
    ].join("\n"))

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].rules).toBeNull()
    }
  })

  it("loads multiple guidelines", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm."
    ].join("\n"))

    writeGuideline("py-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: py-standards",
      "spec:",
      "  rules:",
      "  - name: no-pip",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^pip"',
      "    reason: Use uv instead."
    ].join("\n"))

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2)
    }
  })

  it("skips node_modules, .git, dist, build, .hamilton when scanning extensions", async () => {
    const dir = writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts"]',
      "    files:",
      "    - code-style.md"
    ].join("\n"))
    Fs.writeFileSync(Path.join(dir, "code-style.md"), "Use const.")

    const nmDir = Path.join(tmpProject, "node_modules")
    Fs.mkdirSync(nmDir, { recursive: true })
    Fs.writeFileSync(Path.join(nmDir, "dep.ts"), "ts in node_modules")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toBeNull()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/guidelines/loader.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Write the loader implementation**

Create `src/guidelines/loader.ts`:

```typescript
import { Effect, Data } from "effect"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { parseManifest } from "../schemas.js"
import type { GuidelineSpec, LoadedGuideline, CompiledRule, GuidelineRule } from "./types.js"

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".hamilton"])

export class GuidelineParseError extends Data.TaggedError("GuidelineParseError")<{
  guideline: string
  message: string
}> {}

export class GuidelineMissingFileError extends Data.TaggedError("GuidelineMissingFileError")<{
  guideline: string
  file: string
}> {}

export class GuidelineInvalidRegexError extends Data.TaggedError("GuidelineInvalidRegexError")<{
  guideline: string
  ruleName: string
  pattern: string
}> {}

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
  } catch {}
  return Array.from(extensions)
}

function compileRules(rules: GuidelineRule[] | undefined, guidelineName: string): Effect.Effect<CompiledRule[] | null, GuidelineInvalidRegexError> {
  if (!rules || rules.length === 0) return Effect.succeed(null)

  return Effect.gen(function* (_) {
    const compiled: CompiledRule[] = []
    for (const rule of rules) {
      try {
        const compiledPattern = new RegExp(rule.pattern)
        compiled.push({ ...rule, compiledPattern })
      } catch {
        yield* _(Effect.logWarning(`Invalid regex in guideline "${guidelineName}" rule "${rule.name}": ${rule.pattern}`))
      }
    }
    return compiled.length > 0 ? compiled : null
  })
}

function loadSingleGuideline(
  baseDir: string,
  guidelineName: string,
  projectExtensions: Set<string>
): Effect.Effect<LoadedGuideline | null, GuidelineParseError | GuidelineMissingFileError | GuidelineInvalidRegexError> {
  return Effect.gen(function* (_) {
    const dirPath = Path.join(baseDir, guidelineName)
    const ymlPath = Path.join(dirPath, "guideline.yml")

    if (!Fs.existsSync(ymlPath)) return null

    let raw: string
    try {
      raw = Fs.readFileSync(ymlPath, "utf-8")
    } catch {
      return null
    }

    let manifest: GuidelineSpec
    try {
      const parsed = Yaml.parse(raw)
      manifest = parseManifest(parsed) as GuidelineSpec
    } catch (e) {
      yield* _(Effect.logWarning(`Failed to parse guideline "${guidelineName}": ${String(e)}`))
      return null
    }

    let instructions: Array<{ name: string; content: string }> | null = null

    if (manifest.spec.instructions) {
      const guidelineExts = manifest.spec.instructions.extensions
      const matches = guidelineExts.some((ext: string) => projectExtensions.has(ext))

      if (matches) {
        const files: Array<{ name: string; content: string }> = []
        for (const file of manifest.spec.instructions.files) {
          const filePath = Path.join(dirPath, file)
          try {
            const content = Fs.readFileSync(filePath, "utf-8")
            files.push({ name: manifest.metadata.name, content })
          } catch {
            yield* _(Effect.logWarning(`Missing instruction file "${file}" in guideline "${guidelineName}"`))
          }
        }
        if (files.length > 0) instructions = files
      }
    }

    const rules = yield* _(compileRules(manifest.spec.rules, guidelineName))

    return { name: manifest.metadata.name, instructions, rules }
  })
}

export function loadGuidelines(
  baseDir: string,
  projectDir: string
): Effect.Effect<Array<LoadedGuideline>, never> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(baseDir)) return []

    let entries: Fs.Dirent[]
    try {
      entries = Fs.readdirSync(baseDir, { withFileTypes: true })
    } catch {
      return []
    }

    const projectExtensions = new Set(scanExtensions(projectDir))

    const results: LoadedGuideline[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const loaded = yield* _(
        loadSingleGuideline(baseDir, entry.name, projectExtensions).pipe(
          Effect.catchAll((e) => {
            return Effect.gen(function* (_) {
              yield* _(Effect.logWarning(`Skipping guideline "${entry.name}": ${e.message ?? String(e)}`))
              return null
            })
          })
        )
      )

      if (loaded) {
        results.push(loaded)
      }
    }

    return results
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/guidelines/loader.test.ts
```
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/guidelines/loader.ts tests/guidelines/loader.test.ts
git commit -m "feat: add guideline loader with extension scanning and YAML parsing"
```

---

### Task 4: Rule engine

**Files:**
- Create: `src/guidelines/rule-engine.ts`
- Create: `tests/guidelines/rule-engine.test.ts`

- [ ] **Step 1: Write the failing rule engine test**

Create `tests/guidelines/rule-engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { evaluateToolCall } from "../../src/guidelines/rule-engine.js"
import type { CompiledRule, RuleMatch } from "../../src/guidelines/types.js"

function rule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    name: "no-npm",
    toolNames: ["bash"],
    target: "command",
    pattern: "^npm",
    reason: "Use pnpm.",
    compiledPattern: new RegExp(overrides.pattern ?? "^npm"),
    ...overrides
  }
}

describe("evaluateToolCall", () => {
  it("matches command target", () => {
    const matches = evaluateToolCall(
      [rule()],
      "bash",
      { command: "npm install" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].ruleName).toBe("no-npm")
    expect(matches[0].reason).toBe("Use pnpm.")
    expect(matches[0].matchedValue).toBe("npm install")
  })

  it("matches path target via filePath", () => {
    const pathRule = rule({
      name: "no-lock",
      toolNames: ["read"],
      target: "path",
      pattern: "package-lock\\.json",
      reason: "Do not read lock files.",
      compiledPattern: new RegExp("package-lock\\.json")
    })
    const matches = evaluateToolCall(
      [pathRule],
      "read",
      { filePath: "/proj/package-lock.json" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedValue).toBe("/proj/package-lock.json")
  })

  it("matches path target via path key", () => {
    const pathRule = rule({
      name: "no-ls-root",
      toolNames: ["ls"],
      target: "path",
      pattern: "^/$",
      reason: "Do not list root.",
      compiledPattern: new RegExp("^/$")
    })
    const matches = evaluateToolCall(
      [pathRule],
      "ls",
      { path: "/" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedValue).toBe("/")
  })

  it("matches input target (JSON.stringify)", () => {
    const inputRule = rule({
      name: "no-secret",
      toolNames: ["write"],
      target: "input",
      pattern: "SECRET",
      reason: "Do not write secrets.",
      compiledPattern: new RegExp("SECRET")
    })
    const matches = evaluateToolCall(
      [inputRule],
      "write",
      { filePath: "/tmp/x", content: "contains SECRET_KEY" }
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedValue).toContain("SECRET_KEY")
  })

  it("returns empty when toolName not in toolNames", () => {
    const matches = evaluateToolCall(
      [rule()],
      "read",
      { command: "npm install" }
    )
    expect(matches).toEqual([])
  })

  it("returns empty when target key absent from input", () => {
    const matches = evaluateToolCall(
      [rule()],
      "bash",
      { something: "else" }
    )
    expect(matches).toEqual([])
  })

  it("returns empty when regex does not match", () => {
    const matches = evaluateToolCall(
      [rule()],
      "bash",
      { command: "pnpm install" }
    )
    expect(matches).toEqual([])
  })

  it("matches multiple rules on same tool call", () => {
    const rules: CompiledRule[] = [
      rule(),
      { ...rule(), name: "no-npx", compiledPattern: new RegExp("^npx"), reason: "Use pnpm dlx." }
    ]
    const matches = evaluateToolCall(rules, "bash", { command: "npx tsc" })
    expect(matches).toHaveLength(2)
    expect(matches[0].ruleName).toBe("no-npm")
    expect(matches[1].ruleName).toBe("no-npx")
  })

  it("handles empty rules array", () => {
    const matches = evaluateToolCall([], "bash", { command: "npm install" })
    expect(matches).toEqual([])
  })

  it("only evaluates rules for the matching tool", () => {
    const bashRule = rule()
    const writeRule = rule({
      name: "no-secret",
      toolNames: ["write"],
      target: "input",
      pattern: "SECRET",
      reason: "no.",
      compiledPattern: new RegExp("SECRET")
    })
    const matches = evaluateToolCall([bashRule, writeRule], "bash", { command: "npm install" })
    expect(matches).toHaveLength(1)
    expect(matches[0].ruleName).toBe("no-npm")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/guidelines/rule-engine.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Write the rule engine implementation**

Create `src/guidelines/rule-engine.ts`:

```typescript
import type { CompiledRule, RuleMatch } from "./types.js"

export function evaluateToolCall(
  rules: CompiledRule[],
  toolName: string,
  toolInput: Record<string, unknown>
): RuleMatch[] {
  const matches: RuleMatch[] = []

  for (const rule of rules) {
    if (!rule.toolNames.includes(toolName)) continue

    let targetValue: string | undefined

    switch (rule.target) {
      case "command":
        targetValue = typeof toolInput.command === "string" ? toolInput.command : undefined
        break
      case "path":
        targetValue = typeof toolInput.filePath === "string"
          ? toolInput.filePath
          : typeof toolInput.path === "string"
            ? toolInput.path
            : undefined
        break
      case "input":
        targetValue = JSON.stringify(toolInput)
        break
    }

    if (targetValue === undefined) continue

    if (rule.compiledPattern.test(targetValue)) {
      matches.push({
        ruleName: rule.name,
        reason: rule.reason,
        matchedValue: targetValue
      })
    }
  }

  return matches
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/guidelines/rule-engine.test.ts
```
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/guidelines/rule-engine.ts tests/guidelines/rule-engine.test.ts
git commit -m "feat: add rule engine for evaluating tool calls against guidelines"
```

---

### Task 5: Guideline Pi extension

**Files:**
- Create: `src/executors/pi/guideline-extension.ts`
- Create: `tests/executors/pi/guideline-extension.test.ts`

- [ ] **Step 1: Write the failing extension test**

Create `tests/executors/pi/guideline-extension.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createGuidelineExtension } from "../../src/executors/pi/guideline-extension.js"
import type { CompiledRule } from "../../src/guidelines/types.js"

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    name: "no-npm",
    toolNames: ["bash"],
    target: "command",
    pattern: "^npm",
    reason: "Use pnpm.",
    compiledPattern: new RegExp(overrides.pattern ?? "^npm"),
    ...overrides
  }
}

describe("createGuidelineExtension", () => {
  it("returns a no-op factory when rules array is empty", () => {
    const ext = createGuidelineExtension([])
    const api = {
      addEventListener: vi.fn()
    }
    ext(api)
    expect(api.addEventListener).not.toHaveBeenCalled()
  })

  it("registers a tool_call listener when rules are present", () => {
    const ext = createGuidelineExtension([makeRule()])
    const api = {
      addEventListener: vi.fn()
    }
    ext(api)
    expect(api.addEventListener).toHaveBeenCalledWith("tool_call", expect.any(Function))
  })

  it("blocks tool call and injects reason when rule matches", () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "bash" },
      args: { command: "npm install" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).toHaveBeenCalled()
    expect(addMessage).toHaveBeenCalledWith({ role: "system", content: "Use pnpm." })
  })

  it("does not block when no rule matches", () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "bash" },
      args: { command: "pnpm install" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).not.toHaveBeenCalled()
    expect(addMessage).not.toHaveBeenCalled()
  })

  it("does not block when tool does not match any rule toolNames", () => {
    const ext = createGuidelineExtension([makeRule()])
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "read" },
      args: { filePath: "/tmp/x" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).not.toHaveBeenCalled()
    expect(addMessage).not.toHaveBeenCalled()
  })

  it("injects multiple reasons when multiple rules match", () => {
    const rules: CompiledRule[] = [
      makeRule(),
      { ...makeRule(), name: "no-npx", compiledPattern: new RegExp("^npx"), reason: "Use pnpm dlx." }
    ]
    const ext = createGuidelineExtension(rules)
    let handler: Function = () => {}
    const addMessage = vi.fn()
    const api = {
      addEventListener: (_evt: string, h: Function) => { handler = h }
    }
    ext(api)

    const evt = {
      toolCall: { name: "bash" },
      args: { command: "npx tsc" },
      preventDefault: vi.fn(),
      api: { conversation: { addMessage } }
    }

    handler(evt)

    expect(evt.preventDefault).toHaveBeenCalled()
    expect(addMessage).toHaveBeenCalledTimes(2)
    expect(addMessage).toHaveBeenCalledWith({ role: "system", content: "Use pnpm." })
    expect(addMessage).toHaveBeenCalledWith({ role: "system", content: "Use pnpm dlx." })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun --bun vitest run tests/executors/pi/guideline-extension.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Write the guideline extension implementation**

Create `src/executors/pi/guideline-extension.ts`:

```typescript
import { evaluateToolCall } from "../../guidelines/rule-engine.js"
import type { CompiledRule } from "../../guidelines/types.js"

interface ToolCallEvent {
  toolCall: { name: string }
  args?: Record<string, unknown>
  preventDefault: () => void
  api: {
    conversation: {
      addMessage: (msg: { role: string; content: string }) => void
    }
  }
}

interface PiExtensionApi {
  addEventListener(event: string, handler: (evt: ToolCallEvent) => void): void
}

export function createGuidelineExtension(
  rules: CompiledRule[]
): (pi: unknown) => void {
  if (rules.length === 0) {
    return () => {}
  }

  return (pi: unknown) => {
    const api = pi as PiExtensionApi | null
    if (!api || typeof api.addEventListener !== "function") return

    api.addEventListener("tool_call", (evt: ToolCallEvent) => {
      const input = evt.args ?? {}
      const matches = evaluateToolCall(rules, evt.toolCall.name, input)

      if (matches.length > 0) {
        evt.preventDefault()
        for (const match of matches) {
          evt.api.conversation.addMessage({
            role: "system",
            content: match.reason
          })
        }
      }
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun --bun vitest run tests/executors/pi/guideline-extension.test.ts
```
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/executors/pi/guideline-extension.ts tests/executors/pi/guideline-extension.test.ts
git commit -m "feat: add guideline Pi extension for tool call interception"
```

---

### Task 6: Rename instructionFiles to guidelineFiles

**Files:**
- Modify: `src/prompts/types.ts`
- Modify: `src/prompts/builder.ts`

- [ ] **Step 1: Rename in types.ts**

In `src/prompts/types.ts`, change `instructionFiles` to `guidelineFiles`:

```typescript
export interface ResolvablePrompt {
  systemPrompt: string
  taskPrompt: string
  guidelineFiles: Array<{ name: string; content: string }>
}
```

- [ ] **Step 2: Rename in builder.ts**

In `src/prompts/builder.ts`, change `instructionFiles` to `guidelineFiles` in both the interface and function:

Line 17:
```typescript
  guidelineFiles: Array<{ name: string; content: string }>
```

Lines 20-22 (change parameter name and default):
```typescript
export function buildAgentPrompt(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = []
): BuiltPrompt {
```

Line 64:
```typescript
    guidelineFiles
```

- [ ] **Step 3: Run build to verify**

```bash
bun run build
```
Expected: FAIL (runner.ts and pi-executor.ts still reference old names — expected, will fix in Task 7)

- [ ] **Step 4: Commit**

```bash
git add src/prompts/types.ts src/prompts/builder.ts
git commit -m "refactor: rename instructionFiles to guidelineFiles"
```

---

### Task 7: Wire guidelines into runner and pi-executor

**Files:**
- Modify: `src/workflow/runner.ts`
- Modify: `src/executors/pi/pi-executor.ts`

- [ ] **Step 1: Update runner.ts**

In `src/workflow/runner.ts`:

Change line 23 (import):
```typescript
import { loadGuidelines } from "../guidelines/loader.js"
```
Remove the old import (line 23 currently: `import { loadInstructionFiles } from "../prompts/instructions.js"`).

Add import after line 25:
```typescript
import { guidelinesDir } from "../paths.js"
```

Change lines 71 (replaces `loadInstructionFiles` call with `loadGuidelines`):

```typescript
    const loadedGuidelines = yield* _(loadGuidelines(guidelinesDir(), process.cwd()))

    const guidelineFiles: Array<{ name: string; content: string }> = []
    const allRules: import("../guidelines/types.js").CompiledRule[] = []

    for (const g of loadedGuidelines) {
      if (g.instructions) {
        for (const inst of g.instructions) {
          guidelineFiles.push(inst)
        }
      }
      if (g.rules) {
        for (const rule of g.rules) {
          allRules.push(rule)
        }
      }
    }
```

Change line 115 (replace `instructionFiles` reference with `guidelineFiles`):
```typescript
        }, guidelineFiles)
```

Change lines 131-148 (pass `rules` to executor config):

After `outputSchema: outputSchema?.content,` add:
```typescript
            rules: allRules.length > 0 ? allRules : undefined,
```

The full config object should now be:
```typescript
        const output = yield* _(
          executeWithPi({
            prompt,
            stepId: taskId,
            agentId: agent.metadata.name,
            runId,
            timeoutSeconds,
            model,
            outputSchema: outputSchema?.content,
            rules: allRules.length > 0 ? allRules : undefined,
            settings: {
              skills: resolveSkills(resolved.skills, skillRegistry),
              thinking: undefined,
              tools: undefined,
              retryOnTransient: undefined,
              compactionEnabled: undefined
            }
          }).pipe(
```

- [ ] **Step 2: Update pi-executor.ts**

In `src/executors/pi/pi-executor.ts`:

Add import after line 22:
```typescript
import { createGuidelineExtension } from "./guideline-extension.js"
import type { CompiledRule } from "../../guidelines/types.js"
```

Add `rules` field to `PiExecutorConfig` interface (after `outputSchema` on line 41):
```typescript
  rules?: CompiledRule[]
```

Change line 109 (rename destructured field):
```typescript
    const { systemPrompt, taskPrompt, guidelineFiles } = config.prompt
```

Change line 122 (rename field in agentsFilesOverride):
```typescript
          ...guidelineFiles.map((f: {name: string; content: string}) => ({ path: f.name, content: f.content }))
```

After the `buildExtensions` call (line 112), register the guideline extension if rules are present. Add after line 112:
```typescript
    if (config.rules && config.rules.length > 0) {
      extensionFactories.push(createGuidelineExtension(config.rules) as ExtensionFactory)
    }
```

You need to import `ExtensionFactory` from `./extensions.js`. Update the import on line 21:
```typescript
import { buildExtensions, readExtensionSettings, type ExtensionFactory } from "./extensions.js"
```

- [ ] **Step 3: Run build**

```bash
bun run build
```
Expected: PASS (all renames connected, no old instruction references remain)

- [ ] **Step 4: Run all existing tests**

```bash
bun --bun vitest run
```
Expected: Some tests may fail (the old instructions.test.ts references deleted code — handle in Task 9)

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts src/executors/pi/pi-executor.ts
git commit -m "feat: wire guidelines loader into runner and pi-executor"
```

---

### Task 8: Init command — guidelines directory

**Files:**
- Modify: `src/cli/commands/init.ts`
- Create: `manifest/guidelines/.gitkeep`

- [ ] **Step 1: Create manifest/guidelines/.gitkeep**

```bash
mkdir -p manifest/guidelines
touch manifest/guidelines/.gitkeep
```

- [ ] **Step 2: Add copyGuidelinesManifests function to init.ts**

In `src/cli/commands/init.ts`, add a new import for `guidelinesDir` after line 7:
```typescript
import { ensureHamiltonHome, agentsDir, settingsPath, skillsDir, guidelinesDir } from "../../paths.js"
```

Add the `copyGuidelineManifests` function after `copySkillManifests` (line 100):

```typescript
function copyGuidelineManifests(options?: { force?: boolean }): Effect.Effect<void, InitError> {
  return Effect.gen(function* () {
    const manifestDir = Path.join(PROJECT_ROOT, "manifest", "guidelines")
    if (!Fs.existsSync(manifestDir)) return

    const destGuidelines = guidelinesDir()

    yield* Effect.try({
      try: () => Fs.cpSync(manifestDir, destGuidelines, { recursive: true, force: true }),
      catch: (e) =>
        new InitError({ message: `Failed to copy guideline manifests: ${String(e)}` })
    })
  })
}
```

- [ ] **Step 3: Call copyGuidelineManifests in initHamilton**

In the `initHamilton` function body (line 202), add after `yield* copySkillManifests(options)`:

```typescript
    yield* copyGuidelineManifests(options)
```

- [ ] **Step 4: Run build**

```bash
bun run build
```
Expected: PASS

- [ ] **Step 5: Verify init command works**

```bash
export TMP_HOME=$(mktemp -d)
HOME=$TMP_HOME bun run dist/cli/main.js init --force
ls $TMP_HOME/.hamilton/guidelines/
```
Expected: guidelines directory exists (may be empty since no bundled guidelines)

```bash
rm -rf $TMP_HOME
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/init.ts manifest/guidelines/.gitkeep
git commit -m "feat: add guidelines directory creation and manifest copy to init"
```

---

### Task 9: Cleanup — delete old instructions files and update ROADMAP

**Files:**
- Delete: `src/prompts/instructions.ts`
- Delete: `tests/prompts/instructions.test.ts`
- Delete: `docs/agent-instructions.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Delete old instruction files**

```bash
rm src/prompts/instructions.ts
rm tests/prompts/instructions.test.ts
rm docs/agent-instructions.md
```

- [ ] **Step 2: Update ROADMAP.md**

In `ROADMAP.md`, delete line 13 (under `## Next Up`):
```
- [ ] Extend instructions to support similar feature as [coding-preferences](https://github.com/spences10/my-pi/blob/main/packages/pi-coding-preferences/README.md)
```

And add a new completed entry under `## Completed`, at the top of the list (after `## Completed`):
```
- [x] Refactor instructions to guidelines with rule-based tool call interception
```

- [ ] **Step 3: Run build**

```bash
bun run build
```
Expected: PASS (no more references to deleted files)

- [ ] **Step 4: Run full test suite**

```bash
bun --bun vitest run
```
Expected: PASS (all existing tests pass, no instruction tests to fail)

- [ ] **Step 5: Commit**

```bash
git add -u src/prompts/instructions.ts tests/prompts/instructions.test.ts docs/agent-instructions.md ROADMAP.md
git commit -m "refactor: remove old instructions files and update ROADMAP"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun --bun vitest run
```
Expected: All tests PASS

- [ ] **Step 2: Run build**

```bash
bun run build
```
Expected: PASS

- [ ] **Step 3: Verify test count**

```bash
bun --bun vitest run 2>&1 | grep -E "Tests|Files"
```
Expected: Tests should include the new guideline tests (10 loader + 10 rule-engine + 6 extension = 26 new tests)

- [ ] **Step 4: Commit any remaining changes**

```bash
git status
```
If clean, no commit needed. Otherwise commit remaining.
