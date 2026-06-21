# Change Artifacts Directory & Curator Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.hamilton/changes/<change-id>/` directory with a curator agent that resolves change-ids from user prompts, and have agents write plan.md and progress.md into the change directory.

**Architecture:** New `src/curator/` module with curator persona/prompt constants and a `determineChangeId()` Effect that calls `executeWithPi`. New `src/observability/change-dir.ts` for change directory I/O. Runner hooks the curator pre-workflow, creates the change dir, and seeds `WorkflowEnv.change_dir`. Agents receive `{{inputs.change_dir}}` via Handlebars and write plan.md / progress.md themselves.

**Tech Stack:** TypeScript, Effect-TS (`Effect.gen`, `Effect.try`, `Data.TaggedError`), `node:fs`, `bun:sqlite` (unused here)

---

### File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/paths.ts` | Add `changeDir()`, `nextIdFile()`, `changeMetadataFile()` path helpers |
| Create | `src/observability/change-dir.ts` | `readNextId`, `writeNextId`, `ensureChangeDir`, `writeWorkflowMetadata`, `ChangeDirError` |
| Create | `tests/observability/change-dir.test.ts` | Tests for change-dir module |
| Create | `src/curator/change-id.ts` | Curator persona, prompt, `determineChangeId()`, `CuratorError` |
| Create | `tests/curator/change-id.test.ts` | Tests for curator module |
| Modify | `src/workflow/env.ts` | Add `change_dir` field to `WorkflowEnv` |
| Modify | `src/workflow/runner.ts` | Hook curator + change dir creation pre-workflow, inject `change_dir` into env |
| Modify | `bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md` | Add plan.md writing instruction |
| Modify | `bundle/workflows/feature-dev/agents/developer/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/feature-dev/agents/tester/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/agents/verifier/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/agents/setup/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/agents/do/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/agents/pr/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/bug-fix/agents/triager/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/bug-fix/agents/investigator/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/bug-fix/agents/fixer/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/do/agents/doer/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/quarantine-broken-tests/agents/qa-verifier/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/quarantine-broken-tests/agents/quarantiner/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/scaffold/agents/scaffolder/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/security-audit/agents/scanner/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/security-audit/agents/sec-fixer/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/security-audit/agents/sec-tester/INSTRUCTIONS.md` | Add progress.md writing instruction |
| Modify | `bundle/workflows/security-audit/agents/prioritizer/INSTRUCTIONS.md` | Add progress.md writing instruction |

---

### Task 1: Add change-dir path helpers to `src/paths.ts`

**Files:**
- Modify: `src/paths.ts`

- [ ] **Step 1: Add path helper functions**

Add these three exports at the end of `src/paths.ts`, before `ensureHamiltonHome`:

```typescript
export function changeDir(changeId: string): string {
  return Path.join(process.cwd(), ".hamilton", "changes", changeId)
}

export function nextIdFile(): string {
  return Path.join(process.cwd(), ".hamilton", "changes", "next-id.txt")
}

export function changeMetadataFile(changeId: string): string {
  return Path.join(changeDir(changeId), "workflow.metadata.json")
}
```

- [ ] **Step 2: Verify build compiles**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/paths.ts
git commit -m "feat: add change-dir path helpers to paths module"
```

---

### Task 2: Create `src/observability/change-dir.ts`

**Files:**
- Create: `src/observability/change-dir.ts`
- Create: `tests/observability/change-dir.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/observability/change-dir.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  readNextId,
  writeNextId,
  ensureChangeDir,
  writeWorkflowMetadata
} from "../../src/observability/change-dir.js"

describe("change directory management", () => {
  let tmpCwd: string
  const originalCwd = process.cwd

  beforeEach(() => {
    tmpCwd = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-changedir-"))
    process.cwd = () => tmpCwd
  })

  afterEach(() => {
    process.cwd = originalCwd
    Fs.rmSync(tmpCwd, { recursive: true, force: true })
  })

  it("readNextId returns 0 when next-id.txt does not exist", async () => {
    const exit = await Effect.runPromiseExit(readNextId)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(0)
    }
  })

  it("readNextId reads existing value", async () => {
    const dir = Path.join(tmpCwd, ".hamilton", "changes")
    Fs.mkdirSync(dir, { recursive: true })
    Fs.writeFileSync(Path.join(dir, "next-id.txt"), "042")

    const exit = await Effect.runPromiseExit(readNextId)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(42)
    }
  })

  it("readNextId returns 0 when next-id.txt is empty", async () => {
    const dir = Path.join(tmpCwd, ".hamilton", "changes")
    Fs.mkdirSync(dir, { recursive: true })
    Fs.writeFileSync(Path.join(dir, "next-id.txt"), "  \n  ")

    const exit = await Effect.runPromiseExit(readNextId)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(0)
    }
  })

  it("writeNextId writes value to next-id.txt", async () => {
    await Effect.runPromise(writeNextId(43))

    const path = Path.join(tmpCwd, ".hamilton", "changes", "next-id.txt")
    expect(Fs.existsSync(path)).toBe(true)
    expect(Fs.readFileSync(path, "utf-8").trim()).toBe("43")
  })

  it("writeNextId creates parent directories", async () => {
    await Effect.runPromise(writeNextId(1))

    const path = Path.join(tmpCwd, ".hamilton", "changes", "next-id.txt")
    expect(Fs.existsSync(path)).toBe(true)
  })

  it("ensureChangeDir creates the change directory", async () => {
    const exit = await Effect.runPromiseExit(ensureChangeDir("001-add-feature"))
    expect(Exit.isSuccess(exit)).toBe(true)

    const dir = Path.join(tmpCwd, ".hamilton", "changes", "001-add-feature")
    expect(Fs.existsSync(dir)).toBe(true)
    expect(Fs.statSync(dir).isDirectory()).toBe(true)
  })

  it("writeWorkflowMetadata writes metadata.json", async () => {
    Fs.mkdirSync(Path.join(tmpCwd, ".hamilton", "changes", "001-feat"), { recursive: true })

    const metadata = {
      workflow_id: "feature-dev-aB3xY",
      change_id: "001-feat",
      tasks: ["plan", "implement"],
      input_prompt: "Add feature",
      hamilton_version: "0.1.0",
      created_at: "2026-06-21T00:00:00.000Z",
      variants: ["worktree"]
    }

    const exit = await Effect.runPromiseExit(writeWorkflowMetadata("001-feat", metadata))
    expect(Exit.isSuccess(exit)).toBe(true)

    const path = Path.join(tmpCwd, ".hamilton", "changes", "001-feat", "workflow.metadata.json")
    expect(Fs.existsSync(path)).toBe(true)
    const content = JSON.parse(Fs.readFileSync(path, "utf-8"))
    expect(content).toEqual(metadata)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/observability/change-dir.test.ts`
Expected: FAIL — module not found or functions not exported

- [ ] **Step 3: Implement `src/observability/change-dir.ts`**

```typescript
import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import { changeDir, nextIdFile, changeMetadataFile } from "../paths.js"

export class ChangeDirError extends Data.TaggedError("ChangeDirError")<{
  message: string
}> {}

export function readNextId(): Effect.Effect<number, ChangeDirError> {
  return Effect.try({
    try: () => {
      const file = nextIdFile()
      if (!Fs.existsSync(file)) return 0
      const raw = Fs.readFileSync(file, "utf-8").trim()
      if (raw === "") return 0
      const num = parseInt(raw, 10)
      return Number.isNaN(num) ? 0 : num
    },
    catch: (e) => new ChangeDirError({ message: `Failed to read next-id: ${String(e)}` })
  })
}

export function writeNextId(id: number): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const file = nextIdFile()
      Fs.mkdirSync(changeDir("."), { recursive: true })
      Fs.writeFileSync(file, String(id), "utf-8")
    },
    catch: (e) => new ChangeDirError({ message: `Failed to write next-id: ${String(e)}` })
  })
}

export function ensureChangeDir(changeId: string): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const dir = changeDir(changeId)
      if (Fs.existsSync(dir)) {
        return new ChangeDirError({ message: `Change directory already exists: ${changeId}` })
      }
      Fs.mkdirSync(dir, { recursive: true })
    },
    catch: (e) => {
      if (e instanceof ChangeDirError) throw e
      return new ChangeDirError({ message: `Failed to create change directory: ${String(e)}` })
    }
  })
}

export function writeWorkflowMetadata(
  changeId: string,
  metadata: Record<string, unknown>
): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const file = changeMetadataFile(changeId)
      Fs.writeFileSync(file, JSON.stringify(metadata, null, 2), "utf-8")
    },
    catch: (e) => new ChangeDirError({ message: `Failed to write metadata: ${String(e)}` })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/observability/change-dir.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `bun --bun vitest run`
Expected: PASS (all existing tests still pass)

- [ ] **Step 6: Commit**

```bash
git add src/observability/change-dir.ts tests/observability/change-dir.test.ts
git commit -m "feat: add change directory management module"
```

---

### Task 3: Create `src/curator/change-id.ts`

**Files:**
- Create: `src/curator/change-id.ts`
- Create: `tests/curator/change-id.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/curator/change-id.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { Effect, Exit } from "effect"
import { determineChangeId, makeCuratorPrompt, CURATOR_SYSTEM_PROMPT } from "../../src/curator/change-id.js"

vi.mock("../../src/executors/pi/pi-executor.js", () => {
  const { Effect: E } = require("effect")
  return {
    executeWithPi: vi.fn(() => E.succeed({ change_id: "fix-login-timeout" })),
    PiExecutionError: class PiExecutionError extends Error {}
  }
})

vi.mock("../../src/agent/config.js", () => ({
  resolveAgentDefaults: vi.fn(() => ({ model: "glm-5.1", skills: [] })),
  loadModelAliases: vi.fn(() => ({})),
  resolveModelAlias: vi.fn((model: string, _aliases: unknown) => model)
}))

vi.mock("../../src/prompts/persona.js", () => ({
  resolvePersona: vi.fn(() => Effect.succeed({ agent: "curator", soul: undefined })),
  PersonaNotFoundError: class PersonaNotFoundError extends Error {}
}))

vi.mock("../../src/paths.js", () => ({
  piAgentDir: () => "/fake/agent",
  taskOutputFile: () => "/fake/output.json"
}))

describe("curator change-id", () => {
  it("makeCuratorPrompt wraps the user prompt", () => {
    const result = makeCuratorPrompt("Add dark mode toggle")
    expect(result).toContain("Add dark mode toggle")
    expect(result).toContain("kebab-case title")
  })

  it("CURATOR_SYSTEM_PROMPT is non-empty", () => {
    expect(CURATOR_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })

  it("determineChangeId returns resolved change-id title", async () => {
    const result = await Effect.runPromise(
      determineChangeId("Add dark mode toggle to settings", "feature-dev-aB3xY")
    )
    expect(result).toBe("fix-login-timeout")
  })

  it("falls back to untitled-timestamp on parse failure", async () => {
    vi.mocked(require("../../src/executors/pi/pi-executor.js").executeWithPi)
      .mockReturnValueOnce(Effect.succeed(null))

    const result = await Effect.runPromise(
      determineChangeId("Some request", "run-abc12")
    )
    expect(result).toContain("untitled-")
  })

  it("falls back to untitled-timestamp on missing change_id field", async () => {
    vi.mocked(require("../../src/executors/pi/pi-executor.js").executeWithPi)
      .mockReturnValueOnce(Effect.succeed({ other: "data" }))

    const result = await Effect.runPromise(
      determineChangeId("Some request", "run-abc12")
    )
    expect(result).toContain("untitled-")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run tests/curator/change-id.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/curator/change-id.ts`**

```typescript
import { Data, Effect } from "effect"
import { executeWithPi } from "../executors/pi/pi-executor.js"
import { EventBus } from "../events/bus.js"

export class CuratorError extends Data.TaggedError("CuratorError")<{
  message: string
}> {}

export const CURATOR_SYSTEM_PROMPT = `You are the Hamilton curator agent. Your sole responsibility is to determine a change ID title from a user's request.

Given a user prompt describing a software change, extract a concise, kebab-case title (max 5 words) that summarizes the intent.

Rules:
- Use kebab-case (lowercase, hyphens between words)
- Keep it short — 1 to 5 words maximum
- Do NOT include a sequential number, prefix, or suffix
- Extract the core action or feature: "add-dark-mode", "fix-login-timeout", "refactor-auth-module"
- If the request is too vague, use a reasonable generic name like "untitled-change"

Return your answer via write_task_output.`

export function makeCuratorPrompt(userPrompt: string): string {
  return `Given this user request, what is a good kebab-case title for this change? Return exactly the title portion (no sequential number, no prefix).

Request: ${userPrompt}`
}

export function determineChangeId(
  userPrompt: string,
  runId: string
): Effect.Effect<string, CuratorError, EventBus> {
  return Effect.gen(function* (_) {
    const taskPrompt = makeCuratorPrompt(userPrompt)
    const taskId = `curator-${runId}`

    const result = yield* _(
      Effect.either(
        executeWithPi({
          prompt: {
            systemPrompt: CURATOR_SYSTEM_PROMPT,
            taskPrompt
          },
          taskId,
          agentId: "curator",
          runId,
          timeoutSeconds: 30,
          model: undefined,
          settings: {
            thinking: "off",
            retryOnTransient: false,
            compactionEnabled: false
          }
        })
      )
    )

    if (result._tag === "Left") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      return `untitled-${timestamp}`
    }

    const output = result.right
    const title = typeof output === "object" && output !== null
      ? String((output as Record<string, unknown>).change_id ?? "")
      : ""

    if (title === "" || title === "undefined" || title === "null") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      return `untitled-${timestamp}`
    }

    return title
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run tests/curator/change-id.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `bun --bun vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/curator/change-id.ts tests/curator/change-id.test.ts
git commit -m "feat: add curator agent for change-id resolution"
```

---

### Task 4: Add `change_dir` to `WorkflowEnv`

**Files:**
- Modify: `src/workflow/env.ts`

- [ ] **Step 1: Add `change_dir` field**

In `src/workflow/env.ts`, add `change_dir` to the interface:

```typescript
export interface WorkflowEnv {
  cwd?: string
  user_input?: string
  run_id?: string
  progress_file?: string
  progress?: string
  change_dir?: string
  tasks?: Record<string, { outputs: Record<string, unknown> }>
  parameters?: Record<string, unknown>
  [key: string]: unknown
}
```

- [ ] **Step 2: Run build to verify no type errors**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/workflow/env.ts
git commit -m "feat: add change_dir to WorkflowEnv interface"
```

---

### Task 5: Hook curator + change dir into the runner

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Add imports**

Add to the existing imports at the top of `src/workflow/runner.ts`:

At line 1, add `import { VERSION } from "../index.js"` after the existing Effect import:

```typescript
import { Effect, Schedule, Duration, Scope } from "effect"
import { VERSION } from "../index.js"
```

After the existing `# observability` imports block (line 23), add:

```typescript
import { readNextId, writeNextId, ensureChangeDir, writeWorkflowMetadata } from "../observability/change-dir.js"
import { determineChangeId } from "../curator/change-id.js"
```

- [ ] **Step 2: Add curator + change dir logic into the runner body**

In the `runWorkflow` function, after the `yield* _(bus.publish({ _tag: "WorkflowStarted", runId }))` line (line 83) and before the `if (fileEnabled)` block (line 85), insert the curator + change dir creation logic:

```typescript
    yield* _(bus.publish({ _tag: "WorkflowStarted", runId, source: "runner" }))

    let changeDir: string | null = null
    yield* _(Effect.gen(function* () {
      const nextId = yield* _(readNextId)
      const paddedId = String(nextId + 1).padStart(3, "0")

      const title = yield* _(determineChangeId(
        initialParameters.user_input ?? "untitled-change",
        runId
      ))

      const changeId = `${paddedId}-${title}`
      yield* _(ensureChangeDir(changeId))
      changeDir = changeId

      const sortedTaskNames = sortedTasks.map(t => t.name)

      yield* _(writeWorkflowMetadata(changeId, {
        workflow_id: runId,
        change_id: changeId,
        tasks: sortedTaskNames,
        input_prompt: initialParameters.user_input ?? "",
        hamilton_version: VERSION,
        created_at: new Date().toISOString(),
        variants: spec.spec.variants?.supported ?? []
      }))

      yield* _(writeNextId(nextId + 1))
    }))
```

- [ ] **Step 3: Inject `change_dir` into `workflowEnv`**

In the `workflowEnv` constant definition (around line 114), add `change_dir`:

```typescript
    const workflowEnv: WorkflowEnv = {
      ...initialParameters,
      tasks: {},
      run_id: runId,
      progress_file: progressFilePath,
      progress: progressContent,
      change_dir: changeDir ?? undefined
    }
```

- [ ] **Step 4: Run build to verify no type errors**

Run: `bun run build`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `bun --bun vitest run`
Expected: PASS (existing tests still pass)

- [ ] **Step 6: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "feat: hook curator and change-dir creation into workflow runner"
```

---

### Task 6: Update planner agent INSTRUCTIONS.md for plan.md writing

**Files:**
- Modify: `bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md`

- [ ] **Step 1: Add plan.md writing instruction**

In `bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md`, replace the `## Output` section (lines 116-129) with:

```markdown
## Output

Before writing your JSON task output, you MUST write the full plan as a markdown file:

1. Write the plan to `{{inputs.change_dir}}/plan.md` — use the markdown format from this document (header, file structure, tasks with steps). Include ALL task details — no placeholders. This is the canonical record of the plan for this change.

2. After writing plan.md, call `write_step_output` with this JSON:

```json
{
  "status": "done",
  "feature_name": "...",
  "architecture": "...",
  "tech_stack": "...",
  "tasks": [ {...} ]
}
```
```

- [ ] **Step 2: Verify the file reads correctly**

Check that the modified file still has all sections through `## Self-Review` and the new `## Output` section replaces the old one.

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md
git commit -m "feat: add plan.md writing instruction to planner agent"
```

---

### Task 7: Add progress.md writing to all agents

**Files:**
- Modify: `bundle/workflows/feature-dev/agents/developer/INSTRUCTIONS.md`
- Modify: `bundle/workflows/feature-dev/agents/tester/INSTRUCTIONS.md`
- Modify: `bundle/agents/verifier/INSTRUCTIONS.md`
- Modify: `bundle/agents/setup/INSTRUCTIONS.md`
- Modify: `bundle/agents/do/INSTRUCTIONS.md`
- Modify: `bundle/agents/pr/INSTRUCTIONS.md`
- Modify: `bundle/workflows/bug-fix/agents/triager/INSTRUCTIONS.md`
- Modify: `bundle/workflows/bug-fix/agents/investigator/INSTRUCTIONS.md`
- Modify: `bundle/workflows/bug-fix/agents/fixer/INSTRUCTIONS.md`
- Modify: `bundle/workflows/do/agents/doer/INSTRUCTIONS.md`
- Modify: `bundle/workflows/quarantine-broken-tests/agents/qa-verifier/INSTRUCTIONS.md`
- Modify: `bundle/workflows/quarantine-broken-tests/agents/quarantiner/INSTRUCTIONS.md`
- Modify: `bundle/workflows/scaffold/agents/scaffolder/INSTRUCTIONS.md`
- Modify: `bundle/workflows/security-audit/agents/scanner/INSTRUCTIONS.md`
- Modify: `bundle/workflows/security-audit/agents/sec-fixer/INSTRUCTIONS.md`
- Modify: `bundle/workflows/security-audit/agents/sec-tester/INSTRUCTIONS.md`
- Modify: `bundle/workflows/security-audit/agents/prioritizer/INSTRUCTIONS.md`

For each agent INSTRUCTIONS.md file, add a `## Progress` section. The exact placement depends on the file's structure:

- For agents that have an `## Output` / `## Result` section: add the `## Progress` section **just before** the `## Result` section.
- For agents that end with `## Result`: add `## Progress` directly before `## Result`.
- For all others: add `## Progress` at the end of the file.

The identical `## Progress` section for every agent:

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`. Write a timestamped section describing what you accomplished:

```markdown
## {{current_timestamp_iso}} — {{your_agent_role}} ({{model_used}})

- Specific change or action you took
- Another change or action
- Files created or modified (list paths)

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

- [ ] **Step 1: Update developer agent**

In `bundle/workflows/feature-dev/agents/developer/INSTRUCTIONS.md`, insert the `## Progress` section just before `## Result (Expected Output)` (around line 98):

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`. Write a timestamped section describing what you accomplished:

```markdown
## {{current_timestamp_iso}} — developer ({{model_used}})

- Implemented {{story_id}}: {{story_title}}
- Files created: list paths
- Files modified: list paths
- Tests added: list paths

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

- [ ] **Step 2: Commit developer agent**

```bash
git add bundle/workflows/feature-dev/agents/developer/INSTRUCTIONS.md
git commit -m "feat: add progress.md writing to developer agent"
```

- [ ] **Step 3: Update verifier agent (shared)**

In `bundle/agents/verifier/INSTRUCTIONS.md`, insert the `## Progress` section just before `### Result` (around line 90):

```markdown
### Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`:

```markdown
## {{current_timestamp_iso}} — verifier ({{model_used}})

- Verified changes on branch {{branch}}
- Test results: {{passed_or_failed}}
- Issues found: {{issues_or_none}}

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

- [ ] **Step 4: Commit verifier agent**

```bash
git add bundle/agents/verifier/INSTRUCTIONS.md
git commit -m "feat: add progress.md writing to verifier agent"
```

- [ ] **Step 5: Update tester agent**

In `bundle/workflows/feature-dev/agents/tester/INSTRUCTIONS.md`, insert the `## Progress` section just before `## Result` (around line 64):

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`:

```markdown
## {{current_timestamp_iso}} — tester ({{model_used}})

- Ran full test suite: {{result}}
- Integration tests: {{result}}
- E2E tests: {{result}}
- Cross-cutting checks: {{result}}

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

- [ ] **Step 6: Commit tester agent**

```bash
git add bundle/workflows/feature-dev/agents/tester/INSTRUCTIONS.md
git commit -m "feat: add progress.md writing to tester agent"
```

- [ ] **Step 7: Update setup agent (shared)**

In `bundle/agents/setup/INSTRUCTIONS.md`, insert the `## Progress` section just before `## Result` (around line 53):

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`:

```markdown
## {{current_timestamp_iso}} — setup ({{model_used}})

- Branch created: {{branch_name}}
- Build command: {{build_cmd}}
- Test command: {{test_cmd}}
- Baseline: {{baseline_status}}

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

- [ ] **Step 8: Commit setup agent**

```bash
git add bundle/agents/setup/INSTRUCTIONS.md
git commit -m "feat: add progress.md writing to setup agent"
```

- [ ] **Step 9: Update do agent (shared)**

In `bundle/agents/do/INSTRUCTIONS.md`, insert the `## Progress` section just before `## Result` (around line 21):

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`:

```markdown
## {{current_timestamp_iso}} — doer ({{model_used}})

- Task: {{summary_of_what_was_done}}
- Files changed: {{list_of_files}}

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

- [ ] **Step 10: Commit do agent**

```bash
git add bundle/agents/do/INSTRUCTIONS.md
git commit -m "feat: add progress.md writing to do agent"
```

- [ ] **Step 11: Update pr agent (shared)**

In `bundle/agents/pr/INSTRUCTIONS.md`, insert the `## Progress` section just before `## Result` (around line 55):

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`:

```markdown
## {{current_timestamp_iso}} — pr ({{model_used}})

- PR created: {{pr_url}}
- Branch pushed: {{branch_name}}

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

- [ ] **Step 12: Commit pr agent**

```bash
git add bundle/agents/pr/INSTRUCTIONS.md
git commit -m "feat: add progress.md writing to pr agent"
```

- [ ] **Step 13: Apply `## Progress` section to remaining 11 agents**

Apply the generic `## Progress` section from the task header to each of these files, inserting it just before their `## Result` / `## Output` section (or at the end if no such section exists):

- `bundle/workflows/bug-fix/agents/triager/INSTRUCTIONS.md`
- `bundle/workflows/bug-fix/agents/investigator/INSTRUCTIONS.md`
- `bundle/workflows/bug-fix/agents/fixer/INSTRUCTIONS.md`
- `bundle/workflows/do/agents/doer/INSTRUCTIONS.md`
- `bundle/workflows/quarantine-broken-tests/agents/qa-verifier/INSTRUCTIONS.md`
- `bundle/workflows/quarantine-broken-tests/agents/quarantiner/INSTRUCTIONS.md`
- `bundle/workflows/scaffold/agents/scaffolder/INSTRUCTIONS.md`
- `bundle/workflows/security-audit/agents/scanner/INSTRUCTIONS.md`
- `bundle/workflows/security-audit/agents/sec-fixer/INSTRUCTIONS.md`
- `bundle/workflows/security-audit/agents/sec-tester/INSTRUCTIONS.md`
- `bundle/workflows/security-audit/agents/prioritizer/INSTRUCTIONS.md`

For each use the generic template:

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`:

```markdown
## {{current_timestamp_iso}} — <agent-role> ({{model_used}})

- What you accomplished
- Files changed

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---

```

Then append your entry.
```

Replace `<agent-role>` with the agent's role name (triager, investigator, fixer, doer, qa-verifier, quarantiner, scaffolder, scanner, sec-fixer, sec-tester, prioritizer).

- [ ] **Step 14: Commit remaining agents**

```bash
git add bundle/workflows/bug-fix/agents/triager/INSTRUCTIONS.md \
        bundle/workflows/bug-fix/agents/investigator/INSTRUCTIONS.md \
        bundle/workflows/bug-fix/agents/fixer/INSTRUCTIONS.md \
        bundle/workflows/do/agents/doer/INSTRUCTIONS.md \
        bundle/workflows/quarantine-broken-tests/agents/qa-verifier/INSTRUCTIONS.md \
        bundle/workflows/quarantine-broken-tests/agents/quarantiner/INSTRUCTIONS.md \
        bundle/workflows/scaffold/agents/scaffolder/INSTRUCTIONS.md \
        bundle/workflows/security-audit/agents/scanner/INSTRUCTIONS.md \
        bundle/workflows/security-audit/agents/sec-fixer/INSTRUCTIONS.md \
        bundle/workflows/security-audit/agents/sec-tester/INSTRUCTIONS.md \
        bundle/workflows/security-audit/agents/prioritizer/INSTRUCTIONS.md
git commit -m "feat: add progress.md writing to all remaining workflow agents"
```

- [ ] **Step 15: Run full test suite to confirm no regressions**

Run: `bun --bun vitest run`
Expected: PASS (all 155+ tests pass, INSTRUCTIONS.md changes don't affect code)

---

### Task 8: Run build and full test suite for final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun --bun vitest run`
Expected: PASS (all tests)

- [ ] **Step 3: Verify change-dir module works end-to-end**

Run: `bun --bun vitest run tests/observability/change-dir.test.ts tests/curator/change-id.test.ts`
Expected: PASS (all 11 new tests)
