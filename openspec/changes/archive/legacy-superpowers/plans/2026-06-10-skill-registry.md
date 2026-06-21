# Skill Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a skill registry that loads skills from `~/.hamilton/skills/*/SKILL.md`, resolves agent-declared skill names to `SkillEntry` objects, and wires them into Pi's `DefaultResourceLoader.skillsOverride`.

**Architecture:** Standalone `src/skills/registry.ts` module (mirrors `agent-registry.ts` pattern). Runner loads registry once at startup, resolves skill names per agent, passes `SkillEntry[] | null` to Pi executor. Executor configures `DefaultResourceLoader` with `skillsOverride` or `noSkills: true`.

**Tech Stack:** TypeScript, Effect-TS (`Data.TaggedError`), `yaml` package for frontmatter parsing, `node:fs`/`node:path`, `@earendil-works/pi-coding-agent` (`Skill`, `ResourceDiagnostic`, `createSyntheticSourceInfo`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/skills/registry.ts` | Create | `SkillEntry` type, 4 error types, `loadSkillRegistry()`, `resolveSkills()` |
| `tests/skills/registry.test.ts` | Create | All registry + resolve tests |
| `src/paths.ts` | Modify | Add `skillsDir()`, update `ensureHamiltonHome()` |
| `src/executors/pi/pi-executor.ts` | Modify | Change `settings.skills` type to `SkillEntry[]`, wire `skillsOverride`/`noSkills` |
| `src/workflow/runner.ts` | Modify | Load registry once, resolve skills, pass `SkillEntry[]` to executor |
| `src/cli/commands/init.ts` | Modify | Add `copySkillManifests()` |
| `manifest/skills/` | Create | Empty directory for bundled skills |
| `tests/paths.test.ts` | Modify | Add `skillsDir()` test |

---

### Task 1: Add `skillsDir()` path and empty `manifest/skills/` directory

**Files:**
- Modify: `src/paths.ts`
- Create: `manifest/skills/.gitkeep`
- Modify: `tests/paths.test.ts`

- [ ] **Step 1: Write test for `skillsDir()`**

```typescript
it("skillsDir returns path under hamilton home", () => {
  const result = skillsDir()
  expect(result).toBe(Path.join(hamiltonHome(), "skills"))
})
```

Add this test inside the existing `describe("paths", ...)` block in `tests/paths.test.ts`. Import `skillsDir` at the top of the test file alongside the other path imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/paths.test.ts`
Expected: FAIL — `skillsDir` is not exported from `src/paths.js`

- [ ] **Step 3: Implement `skillsDir()` and update `ensureHamiltonHome()`**

In `src/paths.ts`, add:

```typescript
export function skillsDir(): string {
  return Path.join(hamiltonHome(), "skills")
}
```

Add `skillsDir()` to the `dirs` array in `ensureHamiltonHome()`, right after `instructionDir()`:

```typescript
const dirs = [
  hamiltonHome(),
  agentsDir(),
  workflowsDir(),
  runsDir(),
  Path.join(hamiltonHome(), "executors", "pi", "agent"),
  instructionDir(),
  skillsDir()
]
```

- [ ] **Step 4: Create empty `manifest/skills/` directory**

Create `manifest/skills/.gitkeep` as an empty file so git tracks the directory.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun --bun vitest run tests/paths.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/paths.ts tests/paths.test.ts manifest/skills/.gitkeep
git commit -m "feat: add skillsDir path and manifest/skills directory"
```

---

### Task 2: Implement skill registry with `loadSkillRegistry` and `resolveSkills`

**Files:**
- Create: `src/skills/registry.ts`
- Create: `tests/skills/registry.test.ts`

- [ ] **Step 1: Write failing tests for `loadSkillRegistry`**

Create `tests/skills/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  loadSkillRegistry,
  resolveSkills,
  SkillNameMismatchError,
  SkillMissingDescriptionError,
  DuplicateSkillError,
  SkillNotFoundError
} from "../../src/skills/registry.js"

describe("skill-registry", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-skill-registry-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeSkill(
    skillDir: string,
    name: string,
    description: string,
    extra?: string
  ) {
    Fs.mkdirSync(skillDir, { recursive: true })
    const content = extra
      ? `---\nname: ${name}\ndescription: ${description}\n---\n${extra}`
      : `---\nname: ${name}\ndescription: ${description}\n---\n`
    Fs.writeFileSync(Path.join(skillDir, "SKILL.md"), content)
  }

  describe("loadSkillRegistry", () => {
    it("loads valid skills keyed by name", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      writeSkill(Path.join(skillsRoot, "coding"), "coding", "Write code")
      writeSkill(Path.join(skillsRoot, "review"), "review", "Review code")

      const registry = loadSkillRegistry(skillsRoot)

      expect(registry.size).toBe(2)
      expect(registry.get("coding")!.name).toBe("coding")
      expect(registry.get("coding")!.description).toBe("Write code")
      expect(registry.get("review")!.name).toBe("review")
    })

    it("returns empty map when skills dir does not exist", () => {
      const registry = loadSkillRegistry(Path.join(tmpDir, "nonexistent"))
      expect(registry.size).toBe(0)
    })

    it("throws SkillNameMismatchError when folder name != frontmatter name", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      writeSkill(Path.join(skillsRoot, "coding"), "debugging", "Debug things")

      expect(() => loadSkillRegistry(skillsRoot)).toThrow()
      try {
        loadSkillRegistry(skillsRoot)
      } catch (e) {
        expect(e).toBeInstanceOf(SkillNameMismatchError)
        expect((e as SkillNameMismatchError).dirName).toBe("coding")
        expect((e as SkillNameMismatchError).frontmatterName).toBe("debugging")
      }
    })

    it("throws SkillMissingDescriptionError when description is empty", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      const skillDir = Path.join(skillsRoot, "coding")
      Fs.mkdirSync(skillDir, { recursive: true })
      Fs.writeFileSync(Path.join(skillDir, "SKILL.md"), "---\nname: coding\ndescription:\n---\n")

      expect(() => loadSkillRegistry(skillsRoot)).toThrow()
      try {
        loadSkillRegistry(skillsRoot)
      } catch (e) {
        expect(e).toBeInstanceOf(SkillMissingDescriptionError)
      }
    })

    it("throws DuplicateSkillError when two skills share a name", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      writeSkill(Path.join(skillsRoot, "coding-a"), "coding", "Write code A")
      writeSkill(Path.join(skillsRoot, "coding-b"), "coding", "Write code B")

      expect(() => loadSkillRegistry(skillsRoot)).toThrow()
      try {
        loadSkillRegistry(skillsRoot)
      } catch (e) {
        expect(e).toBeInstanceOf(DuplicateSkillError)
        expect((e as DuplicateSkillError).name).toBe("coding")
      }
    })

    it("uses folder name when frontmatter name is omitted", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      const skillDir = Path.join(skillsRoot, "coding")
      Fs.mkdirSync(skillDir, { recursive: true })
      Fs.writeFileSync(Path.join(skillDir, "SKILL.md"), "---\ndescription: Write code\n---\n")

      const registry = loadSkillRegistry(skillsRoot)

      expect(registry.get("coding")!.name).toBe("coding")
    })

    it("skips directories without SKILL.md", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      Fs.mkdirSync(Path.join(skillsRoot, "no-skill-here"), { recursive: true })

      const registry = loadSkillRegistry(skillsRoot)
      expect(registry.size).toBe(0)
    })
  })

  describe("resolveSkills", () => {
    it("returns matching entries for declared skill names", () => {
      const registry = new Map([
        ["coding", { name: "coding", description: "Write code", filePath: "/a/SKILL.md", baseDir: "/a" }],
        ["review", { name: "review", description: "Review code", filePath: "/b/SKILL.md", baseDir: "/b" }]
      ]) as any

      const result = resolveSkills(["coding"], registry)
      expect(result!.length).toBe(1)
      expect(result![0].name).toBe("coding")
    })

    it("throws SkillNotFoundError with available names when skill not found", () => {
      const registry = new Map([
        ["coding", { name: "coding", description: "Write code", filePath: "/a/SKILL.md", baseDir: "/a" }]
      ]) as any

      expect(() => resolveSkills(["unknown"], registry)).toThrow()
      try {
        resolveSkills(["unknown"], registry)
      } catch (e) {
        expect(e).toBeInstanceOf(SkillNotFoundError)
        expect((e as SkillNotFoundError).name).toBe("unknown")
        expect((e as SkillNotFoundError).available).toEqual(["coding"])
      }
    })

    it("returns null when skills is null", () => {
      const registry = new Map()
      const result = resolveSkills(null, registry)
      expect(result).toBeNull()
    })

    it("returns null when skills is empty array", () => {
      const registry = new Map()
      const result = resolveSkills([], registry)
      expect(result).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/skills/registry.test.ts`
Expected: FAIL — module `../../src/skills/registry.js` not found

- [ ] **Step 3: Implement `src/skills/registry.ts`**

```typescript
import { Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"

export interface SkillEntry {
  name: string
  description: string
  filePath: string
  baseDir: string
}

export class SkillNameMismatchError extends Data.TaggedError("SkillNameMismatchError")<{
  dirName: string
  frontmatterName: string
  path: string
}> {}

export class SkillMissingDescriptionError extends Data.TaggedError("SkillMissingDescriptionError")<{
  path: string
}> {}

export class DuplicateSkillError extends Data.TaggedError("DuplicateSkillError")<{
  name: string
  paths: string[]
}> {}

export class SkillNotFoundError extends Data.TaggedError("SkillNotFoundError")<{
  name: string
  available: string[]
}> {}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return null
  try {
    return Yaml.parse(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}

export function loadSkillRegistry(skillsDir: string): Map<string, SkillEntry> {
  if (!Fs.existsSync(skillsDir)) return new Map()

  let entries: Fs.Dirent[]
  try {
    entries = Fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return new Map()
  }

  const registry = new Map<string, SkillEntry>()
  const nameToPaths = new Map<string, string[]>()

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = Path.join(skillsDir, entry.name)
    const skillFile = Path.join(skillPath, "SKILL.md")
    if (!Fs.existsSync(skillFile)) continue

    const content = Fs.readFileSync(skillFile, "utf-8")
    const frontmatter = parseFrontmatter(content)

    const description = typeof frontmatter?.description === "string"
      ? frontmatter.description.trim()
      : ""

    if (!description) {
      throw new SkillMissingDescriptionError({ path: skillFile })
    }

    const frontmatterName = typeof frontmatter?.name === "string"
      ? frontmatter.name.trim()
      : ""
    const name = frontmatterName || entry.name

    if (frontmatterName && frontmatterName !== entry.name) {
      throw new SkillNameMismatchError({
        dirName: entry.name,
        frontmatterName,
        path: skillFile
      })
    }

    const existing = nameToPaths.get(name)
    if (existing) {
      throw new DuplicateSkillError({
        name,
        paths: [...existing, skillPath]
      })
    }
    nameToPaths.set(name, [skillPath])

    registry.set(name, {
      name,
      description,
      filePath: skillFile,
      baseDir: skillPath
    })
  }

  return registry
}

export function resolveSkills(
  agentSkills: string[] | null,
  registry: Map<string, SkillEntry>
): SkillEntry[] | null {
  if (!agentSkills || agentSkills.length === 0) return null

  const resolved: SkillEntry[] = []
  for (const name of agentSkills) {
    const entry = registry.get(name)
    if (!entry) {
      throw new SkillNotFoundError({
        name,
        available: Array.from(registry.keys())
      })
    }
    resolved.push(entry)
  }
  return resolved
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/skills/registry.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run full test suite**

Run: `bun --bun vitest run`
Expected: All existing tests still pass + new registry tests pass

- [ ] **Step 6: Commit**

```bash
git add src/skills/registry.ts tests/skills/registry.test.ts
git commit -m "feat: add skill registry with loadSkillRegistry and resolveSkills"
```

---

### Task 3: Wire skill registry into `runner.ts`

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Add imports to `runner.ts`**

Add these imports at the top of `src/workflow/runner.ts`, after the existing imports:

```typescript
import { loadSkillRegistry, resolveSkills } from "../skills/registry.js"
import { skillsDir } from "../paths.js"
```

- [ ] **Step 2: Load registry once before task loop**

In `runWorkflow`, after `const instructionFiles = yield* _(loadInstructionFiles(process.cwd()))` (line 69), add:

```typescript
const skillRegistry = loadSkillRegistry(skillsDir())
```

- [ ] **Step 3: Resolve skills per agent and pass to executor**

In `executeSingleTask`, after the `const resolved = resolveAgentDefaults(...)` line (line 122), replace the old `skills: resolved.skills` in the `settings` object passed to `executeWithPi`:

Change from:
```typescript
settings: {
  skills: resolved.skills,
  thinking: undefined,
  tools: undefined,
  retryOnTransient: undefined,
  compactionEnabled: undefined
}
```

To:
```typescript
settings: {
  skills: resolveSkills(resolved.skills, skillRegistry),
  thinking: undefined,
  tools: undefined,
  retryOnTransient: undefined,
  compactionEnabled: undefined
}
```

- [ ] **Step 4: Run build to verify compilation**

Run: `bun run build`
Expected: No errors (the `SkillEntry` type will match what `pi-executor.ts` expects after Task 4 changes it; until then, type mismatch is expected at the `executeWithPi` call)

Actually — since `pi-executor.ts` still expects `string[] | null` at this point, the build will fail. We need to update `pi-executor.ts` first. Let's adjust: do Tasks 3 and 4 as a combined step.

- [ ] **Step 5: Move to Task 4 before running build**

We'll update `pi-executor.ts` in the next task, then verify both together.

---

### Task 4: Wire `skillsOverride` into `pi-executor.ts`

**Files:**
- Modify: `src/executors/pi/pi-executor.ts`

- [ ] **Step 1: Update `PiExecutorConfig.settings.skills` type**

In `src/executors/pi/pi-executor.ts`, change the `skills` field in the `settings` interface from:

```typescript
skills?: string[] | null
```

To:

```typescript
skills?: import("../skills/registry.js").SkillEntry[] | null
```

- [ ] **Step 2: Add Pi SDK imports for skill wiring**

Add these imports to the existing import from `@earendil-works/pi-coding-agent` (line 4-11). Add `type Skill`, `type ResourceDiagnostic`, and `createSyntheticSourceInfo` to the named imports:

```typescript
import {
  AuthStorage,
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent"
import type { Skill, ResourceDiagnostic } from "@earendil-works/pi-coding-agent"
```

- [ ] **Step 3: Build `skillsOverride` or `noSkills` in `DefaultResourceLoader` construction**

Replace the current `DefaultResourceLoader` construction (lines 112-124):

```typescript
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  systemPromptOverride: () => systemPrompt,
  agentsFilesOverride: (current: any) => ({
    agentsFiles: [
      ...(current?.agentsFiles ?? []),
      ...instructionFiles.map((f: {name: string; content: string}) => ({ path: f.name, content: f.content }))
    ]
  }),
  extensionFactories,
  settingsManager
})
```

With:

```typescript
const resolvedSkills = config.settings?.skills ?? null
const loaderOptions: any = {
  cwd,
  agentDir,
  systemPromptOverride: () => systemPrompt,
  agentsFilesOverride: (current: any) => ({
    agentsFiles: [
      ...(current?.agentsFiles ?? []),
      ...instructionFiles.map((f: {name: string; content: string}) => ({ path: f.name, content: f.content }))
    ]
  }),
  extensionFactories,
  settingsManager
}

if (!resolvedSkills || resolvedSkills.length === 0) {
  loaderOptions.noSkills = true
} else {
  loaderOptions.skillsOverride = (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
    const skills: Skill[] = resolvedSkills.map((entry) => ({
      name: entry.name,
      description: entry.description,
      filePath: entry.filePath,
      baseDir: entry.baseDir,
      sourceInfo: createSyntheticSourceInfo(entry.filePath, {
        source: "hamilton",
        scope: "user" as const,
        origin: "package" as const,
        baseDir: entry.baseDir
      }),
      disableModelInvocation: false
    }))
    return { skills, diagnostics: base.diagnostics }
  }
}

const loader = new DefaultResourceLoader(loaderOptions)
```

- [ ] **Step 4: Run build**

Run: `bun run build`
Expected: PASS — no type errors

- [ ] **Step 5: Run full test suite**

Run: `bun --bun vitest run`
Expected: All tests pass (existing tests + new registry tests)

- [ ] **Step 6: Commit**

```bash
git add src/workflow/runner.ts src/executors/pi/pi-executor.ts
git commit -m "feat: wire skill registry into runner and pi-executor"
```

---

### Task 5: Add `copySkillManifests()` to `hamilton init`

**Files:**
- Modify: `src/cli/commands/init.ts`

- [ ] **Step 1: Add `copySkillManifests()` function**

In `src/cli/commands/init.ts`, add a `skillsDir` import to the existing import from `../../paths.js`:

```typescript
import { ensureHamiltonHome, agentsDir, settingsPath, skillsDir } from "../../paths.js"
```

Then add the `copySkillManifests` function after `copySharedAgents` (after line 85):

```typescript
function copySkillManifests(options?: { force?: boolean }): Effect.Effect<void, InitError> {
  return Effect.gen(function* () {
    const manifestDir = Path.join(PROJECT_ROOT, "manifest", "skills")
    if (!Fs.existsSync(manifestDir)) return

    const destSkills = skillsDir()

    yield* Effect.try({
      try: () => Fs.cpSync(manifestDir, destSkills, { recursive: true, force: true }),
      catch: (e) =>
        new InitError({ message: `Failed to copy skill manifests: ${String(e)}` })
    })
  })
}
```

- [ ] **Step 2: Call `copySkillManifests` in `initHamilton`**

In the `initHamilton` function, after `yield* copySharedAgents(options)` (line 200), add:

```typescript
yield* copySkillManifests(options)
```

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `bun --bun vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/init.ts
git commit -m "feat: add copySkillManifests to hamilton init"
```

---

### Task 6: Add `skillsDir` test and final verification

**Files:**
- Modify: `tests/paths.test.ts`
- Verify: `tests/skills/registry.test.ts`

- [ ] **Step 1: Verify `skillsDir` test passes**

We added the `skillsDir` test in Task 1. Confirm it still passes:

Run: `bun --bun vitest run tests/paths.test.ts`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`
Expected: All 155+ existing tests pass + 8 new registry tests + 1 new paths test

- [ ] **Step 3: Run build as final gate**

Run: `bun run build`
Expected: PASS — zero type errors

- [ ] **Step 4: Commit any remaining changes**

If any test adjustments were needed, commit them:

```bash
git add -A
git commit -m "test: verify skill registry integration"
```